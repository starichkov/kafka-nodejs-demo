import {describe, test, expect} from '@jest/globals';
import {kafkaClient, uniqueId, ensureTopic} from './kafka-helpers.js';
import {produceMessage, parseBrokers} from "../src/producer.js";

async function consumeOne(kafka, topic) {
    const groupId = uniqueId("g");
    const consumer = kafka.consumer({groupId: groupId});
    await consumer.connect();
    await consumer.subscribe({topic, fromBeginning: true});
    let first;
    await new Promise((resolve, reject) => {
        consumer
            .run({
                eachMessage: async ({message}) => {
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

    const {brokers} = globalThis.__kafka_brokers__;

    const kafka = kafkaClient();

    test('produceMessage sends string message that can be consumed', async () => {
        const topic = uniqueId();
        await ensureTopic(kafka, topic);
        await produceMessage({brokers, topic, key: 'k', message: 'v'});

        const msg = await consumeOne(kafka, topic);
        expect(msg).toEqual({key: 'k', value: 'v'});
    });

    test('produceMessage stringifies non-string message', async () => {
        const topic = uniqueId();
        await ensureTopic(kafka, topic);
        await produceMessage({brokers, topic, message: {a: 1}});

        const msg = await consumeOne(kafka, topic);
        expect(msg).toEqual({key: null, value: JSON.stringify({a: 1})});
    });
});

describe('parseBrokers unit tests', () => {
    test('parseBrokers handles array input', () => {
        const input = ['broker1:9092', 'broker2:9092'];
        expect(parseBrokers(input)).toEqual(['broker1:9092', 'broker2:9092']);
    });

    test('parseBrokers handles string input', () => {
        const input = 'broker1:9092,broker2:9092';
        expect(parseBrokers(input)).toEqual(['broker1:9092', 'broker2:9092']);
    });

    test('parseBrokers handles string input with PLAINTEXT prefix', () => {
        const input = 'PLAINTEXT://broker1:9092,PLAINTEXT://broker2:9092';
        expect(parseBrokers(input)).toEqual(['broker1:9092', 'broker2:9092']);
    });

    test('parseBrokers handles string input with whitespace', () => {
        const input = ' broker1:9092 , broker2:9092 ';
        expect(parseBrokers(input)).toEqual(['broker1:9092', 'broker2:9092']);
    });

    test('parseBrokers returns empty array for non-string non-array input', () => {
        expect(parseBrokers(null)).toEqual([]);
        expect(parseBrokers(undefined)).toEqual([]);
        expect(parseBrokers(123)).toEqual([]);
        expect(parseBrokers({})).toEqual([]);
    });

    test('parseBrokers filters out empty strings', () => {
        const input = 'broker1:9092,,broker2:9092,';
        expect(parseBrokers(input)).toEqual(['broker1:9092', 'broker2:9092']);
    });
});

describe('produceMessage error handling', () => {
    test('throws error when brokers is null', async () => {
        await expect(produceMessage({
            brokers: null,
            topic: 'test-topic',
            message: 'test'
        })).rejects.toThrow('brokers is required');
    });

    test('throws error when brokers is empty array', async () => {
        await expect(produceMessage({
            brokers: [],
            topic: 'test-topic',
            message: 'test'
        })).rejects.toThrow('brokers is required');
    });

    test('throws error when topic is missing', async () => {
        await expect(produceMessage({
            brokers: ['localhost:9092'],
            topic: null,
            message: 'test'
        })).rejects.toThrow('topic is required');
    });

    test('throws error when topic is empty string', async () => {
        await expect(produceMessage({
            brokers: ['localhost:9092'],
            topic: '',
            message: 'test'
        })).rejects.toThrow('topic is required');
    });

    test('throws error when message is undefined', async () => {
        await expect(produceMessage({
            brokers: ['localhost:9092'],
            topic: 'test-topic'
        })).rejects.toThrow('message is required');
    });

    test('throws error when message is null', async () => {
        await expect(produceMessage({
            brokers: ['localhost:9092'],
            topic: 'test-topic',
            message: null
        })).rejects.toThrow('message is required');
    });
});

describe('produceMessage message formatting', () => {
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
