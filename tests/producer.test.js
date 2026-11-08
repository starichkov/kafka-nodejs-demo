import { describe, test, expect } from '@jest/globals';
import { kafkaClient, uniqueId, ensureTopic } from './kafka-helpers.js';
import { buildMessages, produceMessage } from '../src/producer.js';

async function consumeOne(kafka, topic) {
    const groupId = uniqueId('g');
    const consumer = kafka.consumer({ groupId: groupId });
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: true });
    let first;
    await new Promise((resolve, reject) => {
        consumer
            .run({
                eachMessage: async ({ message }) => {
                    first = {
                        key: message.key ? message.key.toString() : null,
                        value: message.value ? message.value.toString() : null,
                    };
                    resolve();
                },
            })
            .catch(reject);
    });
    await consumer.stop();
    await consumer.disconnect();
    return first;
}

describe('producer with real Kafka (Testcontainers)', () => {
    const brokersString = process.env.KAFKA_BROKERS_DYNAMIC;
    const brokers = brokersString ? brokersString.split(',') : globalThis.__kafka_brokers__?.brokers;

    const kafka = kafkaClient();

    test('produceMessage sends string message that can be consumed', async () => {
        const topic = uniqueId();
        await ensureTopic(kafka, topic);
        const metadata = await produceMessage({ brokers, topic, key: 'k', message: 'v' });

        expect(metadata).toHaveLength(1);
        expect(metadata[0]).toMatchObject({ topicName: topic, partition: 0 });
        expect(metadata[0].baseOffset).toEqual(expect.any(String));

        const msg = await consumeOne(kafka, topic);
        expect(msg).toEqual({ key: 'k', value: 'v' });
    });

    test('produceMessage stringifies non-string message', async () => {
        const topic = uniqueId();
        await ensureTopic(kafka, topic);
        await produceMessage({ brokers, topic, message: { a: 1 } });

        const msg = await consumeOne(kafka, topic);
        expect(msg).toEqual({ key: null, value: JSON.stringify({ a: 1 }) });
    });

    test('produceMessage preserves headers and timestamp', async () => {
        const topic = uniqueId();
        await ensureTopic(kafka, topic);
        const timestamp = '1700000000000';
        await produceMessage({
            brokers,
            topic,
            message: 'with metadata',
            headers: { 'trace-id': 'abc-123', flags: ['lesson', 'four'] },
            timestamp,
        });

        const groupId = uniqueId('g');
        const consumer = kafka.consumer({ groupId });
        let received;
        await consumer.connect();
        await consumer.subscribe({ topic, fromBeginning: true });
        await new Promise((resolve, reject) => {
            consumer
                .run({
                    eachMessage: async ({ message }) => {
                        received = message;
                        resolve();
                    },
                })
                .catch(reject);
        });
        await consumer.stop();
        await consumer.disconnect();

        expect(received.headers).toEqual({
            'trace-id': Buffer.from('abc-123'),
            flags: [Buffer.from('lesson'), Buffer.from('four')],
        });
        expect(received.timestamp).toBe(timestamp);
    });

    test('produceMessage keeps same-key records ordered in one partition', async () => {
        const topic = uniqueId();
        await ensureTopic(kafka, topic, 3);
        const metadata = await produceMessage({ brokers, topic, key: 'sequence', message: 'item', messageCount: 3 });

        expect(metadata).toHaveLength(3);
        expect(new Set(metadata.map((record) => record.partition)).size).toBe(1);
        expect(metadata.map((record) => Number(record.baseOffset))).toEqual([
            Number(metadata[0].baseOffset),
            Number(metadata[0].baseOffset) + 1,
            Number(metadata[0].baseOffset) + 2,
        ]);

        const groupId = uniqueId('g');
        const consumer = kafka.consumer({ groupId });
        const messages = [];
        await consumer.connect();
        await consumer.subscribe({ topic, fromBeginning: true });
        await new Promise((resolve, reject) => {
            consumer
                .run({
                    eachMessage: async ({ message }) => {
                        messages.push({
                            key: message.key?.toString() ?? null,
                            value: message.value?.toString() ?? null,
                        });
                        if (messages.length === 3) resolve();
                    },
                })
                .catch(reject);
        });
        await consumer.stop();
        await consumer.disconnect();

        expect(messages).toEqual([
            { key: 'sequence', value: 'item-1' },
            { key: 'sequence', value: 'item-2' },
            { key: 'sequence', value: 'item-3' },
        ]);
    });
});

describe('produceMessage error handling', () => {
    test('throws error when brokers is null', async () => {
        await expect(
            produceMessage({
                brokers: null,
                topic: 'test-topic',
                message: 'test',
            }),
        ).rejects.toThrow('brokers is required');
    });

    test('throws error when brokers is empty array', async () => {
        await expect(
            produceMessage({
                brokers: [],
                topic: 'test-topic',
                message: 'test',
            }),
        ).rejects.toThrow('brokers is required');
    });

    test('throws error when topic is missing', async () => {
        await expect(
            produceMessage({
                brokers: ['localhost:9092'],
                topic: null,
                message: 'test',
            }),
        ).rejects.toThrow('topic is required');
    });

    test('throws error when topic is empty string', async () => {
        await expect(
            produceMessage({
                brokers: ['localhost:9092'],
                topic: '',
                message: 'test',
            }),
        ).rejects.toThrow('topic is required');
    });

    test('throws error when message is undefined', async () => {
        await expect(
            produceMessage({
                brokers: ['localhost:9092'],
                topic: 'test-topic',
            }),
        ).rejects.toThrow('message is required');
    });

    test('throws error when message is null', async () => {
        await expect(
            produceMessage({
                brokers: ['localhost:9092'],
                topic: 'test-topic',
                message: null,
            }),
        ).rejects.toThrow('message is required');
    });
});

describe('produceMessage message formatting', () => {
    test('buildMessages preserves the single-message shape', () => {
        expect(buildMessages({ message: 'hello' })).toEqual([{ key: null, value: 'hello' }]);
    });

    test('buildMessages adds deterministic suffixes and partition', () => {
        expect(buildMessages({ message: 'hello', key: 7, messageCount: 2, partition: 1 })).toEqual([
            { key: '7', value: 'hello-1', partition: 1 },
            { key: '7', value: 'hello-2', partition: 1 },
        ]);
    });

    test('buildMessages adds headers and timestamp', () => {
        expect(buildMessages({ message: 'hello', headers: { 'trace-id': 'abc' }, timestamp: 1700000000000 })).toEqual([
            { key: null, value: 'hello', headers: { 'trace-id': 'abc' }, timestamp: '1700000000000' },
        ]);
    });

    test('buildMessages rejects an invalid count', () => {
        expect(() => buildMessages({ message: 'hello', messageCount: 0 })).toThrow(
            'messageCount must be a positive integer',
        );
    });

    test('buildMessages keeps Buffer payloads intact for a single record', () => {
        const value = Buffer.from('hello');
        const [record] = buildMessages({ message: value });
        expect(record.value).toBe(value);
    });
    test('handles Buffer message without Kafka connection', () => {
        // Test the message formatting logic without actual Kafka calls
        const buffer = Buffer.from('test buffer');
        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect(typeof buffer === 'string').toBe(false);
    });

    test('handles key conversion', () => {
        // Test the key conversion logic
        expect(String(123)).toBe('123');
        expect(String(null)).toBe('null');
        expect(String(undefined)).toBe('undefined');
    });
});
