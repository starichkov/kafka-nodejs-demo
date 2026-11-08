import { describe, test, expect } from '@jest/globals';
import { kafkaClient, uniqueId, ensureTopic } from './kafka-helpers.js';
import { consumeMessages } from '../src/consumer.js';
import { Partitioners } from 'kafkajs';

async function produce(topic, { key = null, value }) {
    const kafka = kafkaClient();
    await ensureTopic(kafka, topic);
    const producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });
    await producer.connect();
    await producer.send({ topic, messages: [{ key, value }] });
    await producer.disconnect();
}

describe('consumer with real Kafka (Testcontainers)', () => {
    test('consumeMessages consumes a produced message and can stop', async () => {
        const brokersString = process.env.KAFKA_BROKERS_DYNAMIC;
        const brokers = brokersString ? brokersString.split(',') : globalThis.__kafka_brokers__?.brokers;
        const topic = uniqueId('t');

        // Ensure topic exists before consuming to avoid "This server does not host this topic-partition"
        await ensureTopic(kafkaClient(), topic);

        let firstMessage;
        const { stop, runPromise } = await consumeMessages({
            brokers,
            topic,
            clientId: 'c',
            groupId: `g-${Date.now()}-${Math.random()}`,
            fromBeginning: true,
            eachMessage: async ({ topic, partition, message }) => {
                firstMessage = {
                    topic,
                    partition,
                    offset: message.offset,
                    timestamp: message.timestamp,
                    headers: message.headers,
                    key: message.key ? message.key.toString() : null,
                    value: message.value ? message.value.toString() : null,
                };
                // NOTE: do not stop here — let the handler finish cleanly
            },
        });

        await produce(topic, { key: 'k', value: 'v' });

        // wait until handler ran
        const got = await Promise.race([
            (async () => {
                while (!firstMessage) await new Promise((r) => setTimeout(r, 15));
                return firstMessage;
            })(),
            new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 15000)),
        ]);

        // NOW stop the consumer loop and await its promise
        await stop();
        await runPromise;

        expect(got).toMatchObject({ topic, partition: 0, key: 'k', value: 'v', headers: {} });
        expect(got.offset).toEqual(expect.any(String));
        expect(got.timestamp).toEqual(expect.any(String));
    }, 20_000);

    test('two consumers in one group share a multi-partition topic', async () => {
        const brokersString = process.env.KAFKA_BROKERS_DYNAMIC;
        const brokers = brokersString ? brokersString.split(',') : globalThis.__kafka_brokers__?.brokers;
        const topic = uniqueId('partitions');
        const groupId = uniqueId('shared-group');
        const kafka = kafkaClient();
        await ensureTopic(kafka, topic, 3);

        const received = [[], []];
        const consumers = await Promise.all(
            received.map((messages, index) =>
                consumeMessages({
                    brokers,
                    topic,
                    groupId,
                    clientId: `consumer-${index}`,
                    fromBeginning: true,
                    eachMessage: async ({ partition, message }) => {
                        messages.push({ partition, value: message.value.toString() });
                    },
                }),
            ),
        );

        await new Promise((resolve) => setTimeout(resolve, 1000));
        const producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });
        await producer.connect();
        await producer.send({
            topic,
            messages: [0, 1, 2].map((partition) => ({ partition, value: `partition-${partition}` })),
        });
        await producer.disconnect();

        await new Promise((resolve, reject) => {
            const deadline = Date.now() + 15_000;
            const check = () => {
                if (received.flat().length === 3) return resolve();
                if (Date.now() >= deadline) return reject(new Error('Timed out waiting for all partitions'));
                setTimeout(check, 25);
            };
            check();
        });

        await Promise.all(consumers.map(({ stop }) => stop()));
        await Promise.all(consumers.map(({ runPromise }) => runPromise));

        expect(received.filter((messages) => messages.length > 0)).toHaveLength(2);
        expect(
            received
                .flat()
                .map(({ partition }) => partition)
                .sort(),
        ).toEqual([0, 1, 2]);
    }, 30_000);

    test('retries a failing record and routes it to a dead-letter topic', async () => {
        const brokersString = process.env.KAFKA_BROKERS_DYNAMIC;
        const brokers = brokersString ? brokersString.split(',') : globalThis.__kafka_brokers__?.brokers;
        const topic = uniqueId('failures');
        const deadLetterTopic = uniqueId('dead-letter');
        const kafka = kafkaClient();
        await ensureTopic(kafka, topic);
        await ensureTopic(kafka, deadLetterTopic);

        let deadLetterMessage;
        const deadLetterConsumer = await consumeMessages({
            brokers,
            topic: deadLetterTopic,
            groupId: uniqueId('dlq-group'),
            clientId: 'dlq-consumer',
            fromBeginning: true,
            eachMessage: async ({ message }) => {
                deadLetterMessage = {
                    key: message.key?.toString(),
                    value: message.value?.toString(),
                    headers: Object.fromEntries(
                        Object.entries(message.headers).map(([name, value]) => [name, value?.toString()]),
                    ),
                };
            },
        });
        const sourceConsumer = await consumeMessages({
            brokers,
            topic,
            groupId: uniqueId('source-group'),
            clientId: 'source-consumer',
            fromBeginning: true,
            failOnValue: 'permanent-failure',
            maxRetries: 2,
            retryBackoffMs: 10,
            deadLetterTopic,
        });

        await produce(topic, { key: 'failed-key', value: 'permanent-failure' });

        const deadline = Date.now() + 15_000;
        while (!deadLetterMessage && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));

        await sourceConsumer.stop();
        await deadLetterConsumer.stop();
        await Promise.all([sourceConsumer.runPromise, deadLetterConsumer.runPromise]);

        expect(deadLetterMessage).toEqual({
            key: 'failed-key',
            value: 'permanent-failure',
            headers: expect.objectContaining({
                'original-topic': topic,
                'original-partition': '0',
                'original-offset': '0',
                'retry-count': '2',
                error: expect.stringContaining('Intentional failure'),
            }),
        });
    }, 30_000);
});

describe('consumeMessages error handling', () => {
    test('throws error when brokers is null', async () => {
        await expect(
            consumeMessages({
                brokers: null,
                topic: 'test-topic',
            }),
        ).rejects.toThrow('brokers is required');
    });

    test('throws error when brokers is empty array', async () => {
        await expect(
            consumeMessages({
                brokers: [],
                topic: 'test-topic',
            }),
        ).rejects.toThrow('brokers is required');
    });

    test('throws error when topic is missing', async () => {
        await expect(
            consumeMessages({
                brokers: ['localhost:9092'],
                topic: null,
            }),
        ).rejects.toThrow('topic is required');
    });

    test('throws error when topic is empty string', async () => {
        await expect(
            consumeMessages({
                brokers: ['localhost:9092'],
                topic: '',
            }),
        ).rejects.toThrow('topic is required');
    });
});

describe('consumeMessages signal handling', () => {
    test('handles already aborted signal', async () => {
        const controller = new AbortController();
        controller.abort(); // Abort before passing to consumeMessages

        const brokersString = process.env.KAFKA_BROKERS_DYNAMIC;
        const brokers = brokersString ? brokersString.split(',') : globalThis.__kafka_brokers__?.brokers;
        const topic = uniqueId('test-topic');
        await ensureTopic(kafkaClient(), topic);

        // This should handle the already-aborted signal case
        const result = await consumeMessages({
            brokers,
            topic,
            signal: controller.signal,
            clientId: 'test-signal-client',
            groupId: 'test-signal-group',
        });

        expect(result.stop).toBeDefined();
        // runPromise may be undefined if signal was already aborted
        // This is expected behavior as the consumer stops immediately

        // Clean up
        await result.stop();
    }, 10_000);

    test('handles signal abort during consumption', async () => {
        const controller = new AbortController();
        const brokersString = process.env.KAFKA_BROKERS_DYNAMIC;
        const brokers = brokersString ? brokersString.split(',') : globalThis.__kafka_brokers__?.brokers;
        const topic = uniqueId('test-topic-signal');
        await ensureTopic(kafkaClient(), topic);

        const result = await consumeMessages({
            brokers,
            topic,
            signal: controller.signal,
            clientId: 'test-abort-client',
            groupId: 'test-abort-group',
        });

        // Abort after starting and let the signal own the shutdown.
        await new Promise((resolve) => {
            setTimeout(() => {
                controller.abort();
                resolve();
            }, 100);
        });

        // Should handle the abort gracefully
        await result.runPromise;

        expect(result.stop).toBeDefined();
        expect(result.runPromise).toBeDefined();
    }, 10_000);

    test('handles custom eachMessage function', async () => {
        const brokersString = process.env.KAFKA_BROKERS_DYNAMIC;
        const brokers = brokersString ? brokersString.split(',') : globalThis.__kafka_brokers__?.brokers;
        const topic = uniqueId('custom-handler');
        await ensureTopic(kafkaClient(), topic);

        let messageReceived = false;
        const customHandler = async (payload) => {
            messageReceived = true;
            expect(payload.topic).toBe(topic);
            expect(payload.message).toBeDefined();
        };

        const { stop, runPromise } = await consumeMessages({
            brokers,
            topic,
            clientId: 'custom-handler-client',
            groupId: `custom-handler-group-${Date.now()}`,
            fromBeginning: true,
            eachMessage: customHandler,
        });

        // Produce a message to trigger the handler
        await produce(topic, { key: 'test-key', value: 'test-value' });

        // Wait for message to be processed
        await new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (messageReceived) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 50);

            // Timeout after 5 seconds
            setTimeout(() => {
                clearInterval(checkInterval);
                resolve();
            }, 5000);
        });

        await stop();
        await runPromise;

        expect(messageReceived).toBe(true);
    }, 15_000);

    test('handles undefined eachMessage with default logging', async () => {
        const brokersString = process.env.KAFKA_BROKERS_DYNAMIC;
        const brokers = brokersString ? brokersString.split(',') : globalThis.__kafka_brokers__?.brokers;
        const topic = uniqueId('default-handler');
        await ensureTopic(kafkaClient(), topic);

        const { stop, runPromise } = await consumeMessages({
            brokers,
            topic,
            clientId: 'default-handler-client',
            groupId: `default-handler-group-${Date.now()}`,
            fromBeginning: true,
            // eachMessage is undefined, should use default handler
        });

        // Produce a message
        await produce(topic, { key: 'test-key', value: 'test-value' });

        // Wait a bit for potential message processing
        await new Promise((resolve) => setTimeout(resolve, 2000));

        await stop();
        await runPromise;

        // Just verify it doesn't crash with undefined eachMessage
        expect(stop).toBeDefined();
    }, 15_000);
});
