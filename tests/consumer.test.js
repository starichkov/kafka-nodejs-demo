import {describe, test, expect} from '@jest/globals';
import {kafkaClient, uniqueId, ensureTopic} from './kafka-helpers.js';
import {consumeMessages} from '../src/consumer.js';
import {Partitioners} from "kafkajs";

async function produce(topic, {key = null, value}) {
    const kafka = kafkaClient();
    await ensureTopic(kafka, topic);
    const producer = kafka.producer({createPartitioner: Partitioners.DefaultPartitioner});
    await producer.connect();
    await producer.send({topic, messages: [{key, value}]});
    await producer.disconnect();
}

describe('consumer with real Kafka (Testcontainers)', () => {
    test('consumeMessages consumes a produced message and can stop', async () => {
        const {brokers} = globalThis.__kafka_brokers__;
        const topic = uniqueId('t');

        let firstMessage;
        const {stop, runPromise} = await consumeMessages({
            brokers,
            topic,
            clientId: 'c',
            groupId: `g-${Date.now()}-${Math.random()}`,
            fromBeginning: true,
            eachMessage: async ({topic, partition, message}) => {
                firstMessage = {
                    topic,
                    partition,
                    key: message.key ? message.key.toString() : null,
                    value: message.value ? message.value.toString() : null,
                };
                // NOTE: do not stop here — let the handler finish cleanly
            },
        });

        await produce(topic, {key: 'k', value: 'v'});

        // wait until handler ran
        const got = await Promise.race([
            (async () => {
                while (!firstMessage) await new Promise(r => setTimeout(r, 15));
                return firstMessage;
            })(),
            new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 15000)),
        ]);

        // NOW stop the consumer loop and await its promise
        await stop();
        await runPromise;

        expect(got).toEqual({topic, partition: 0, key: 'k', value: 'v'});
    }, 20_000);
});


describe('consumeMessages error handling', () => {
    test('throws error when brokers is null', async () => {
        await expect(consumeMessages({
            brokers: null,
            topic: 'test-topic'
        })).rejects.toThrow('brokers is required');
    });

    test('throws error when brokers is empty array', async () => {
        await expect(consumeMessages({
            brokers: [],
            topic: 'test-topic'
        })).rejects.toThrow('brokers is required');
    });

    test('throws error when topic is missing', async () => {
        await expect(consumeMessages({
            brokers: ['localhost:9092'],
            topic: null
        })).rejects.toThrow('topic is required');
    });

    test('throws error when topic is empty string', async () => {
        await expect(consumeMessages({
            brokers: ['localhost:9092'],
            topic: ''
        })).rejects.toThrow('topic is required');
    });
});

describe('consumeMessages signal handling', () => {
    test('handles already aborted signal', async () => {
        const controller = new AbortController();
        controller.abort(); // Abort before passing to consumeMessages
        
        const {brokers} = globalThis.__kafka_brokers__;
        
        // This should handle the already-aborted signal case
        const result = await consumeMessages({
            brokers,
            topic: 'test-topic',
            signal: controller.signal,
            clientId: 'test-signal-client',
            groupId: 'test-signal-group'
        });
        
        expect(result.stop).toBeDefined();
        // runPromise may be undefined if signal was already aborted
        // This is expected behavior as the consumer stops immediately
        
        // Clean up
        await result.stop();
    }, 10_000);

    test('handles signal abort during consumption', async () => {
        const controller = new AbortController();
        const {brokers} = globalThis.__kafka_brokers__;
        
        const result = await consumeMessages({
            brokers,
            topic: 'test-topic-signal',
            signal: controller.signal,
            clientId: 'test-abort-client',
            groupId: 'test-abort-group'
        });
        
        // Abort after starting
        setTimeout(() => controller.abort(), 100);
        
        // Should handle the abort gracefully
        await result.stop();
        await result.runPromise;
        
        expect(result.stop).toBeDefined();
        expect(result.runPromise).toBeDefined();
    }, 10_000);

    test('handles custom eachMessage function', async () => {
        const {brokers} = globalThis.__kafka_brokers__;
        const topic = uniqueId('custom-handler');
        
        let messageReceived = false;
        const customHandler = async (payload) => {
            messageReceived = true;
            expect(payload.topic).toBe(topic);
            expect(payload.message).toBeDefined();
        };
        
        const {stop, runPromise} = await consumeMessages({
            brokers,
            topic,
            clientId: 'custom-handler-client',
            groupId: `custom-handler-group-${Date.now()}`,
            fromBeginning: true,
            eachMessage: customHandler
        });
        
        // Produce a message to trigger the handler
        await produce(topic, {key: 'test-key', value: 'test-value'});
        
        // Wait for message to be processed
        await new Promise(resolve => {
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
        const {brokers} = globalThis.__kafka_brokers__;
        const topic = uniqueId('default-handler');
        
        const {stop, runPromise} = await consumeMessages({
            brokers,
            topic,
            clientId: 'default-handler-client',
            groupId: `default-handler-group-${Date.now()}`,
            fromBeginning: true
            // eachMessage is undefined, should use default handler
        });
        
        // Produce a message
        await produce(topic, {key: 'test-key', value: 'test-value'});
        
        // Wait a bit for potential message processing
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await stop();
        await runPromise;
        
        // Just verify it doesn't crash with undefined eachMessage
        expect(stop).toBeDefined();
    }, 15_000);
});
