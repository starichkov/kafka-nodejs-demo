import { describe, test, expect, afterEach } from '@jest/globals';
import { inspectTopic, isDirectRun } from '../src/topic-admin.js';
import { kafkaClient, uniqueId, ensureTopic } from './kafka-helpers.js';
import { produceMessage } from '../src/producer.js';

const ORIGINAL_ARGV1 = process.argv[1];

afterEach(() => {
    process.argv[1] = ORIGINAL_ARGV1;
});

describe('topic inspection with real Kafka (Testcontainers)', () => {
    test('returns beginning and end offsets for each partition', async () => {
        const brokers = process.env.KAFKA_BROKERS_DYNAMIC
            ? process.env.KAFKA_BROKERS_DYNAMIC.split(',')
            : globalThis.__kafka_brokers__?.brokers;
        const topic = uniqueId('inspect');
        const kafka = kafkaClient();
        await ensureTopic(kafka, topic, 2);
        await produceMessage({ brokers, topic, message: 'one', partition: 0 });

        const offsets = await inspectTopic({ brokers, topic });

        expect(offsets).toHaveLength(2);
        expect(offsets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ partition: 0, low: '0', high: '1' }),
                expect.objectContaining({ partition: 1, low: '0', high: '0' }),
            ]),
        );
    });
});

describe('topic-admin direct-run detection', () => {
    test('returns false when argv does not contain a valid path', () => {
        process.argv[1] = undefined;

        expect(isDirectRun()).toBe(false);
    });
});

describe('topic inspection validation', () => {
    test('requires brokers', async () => {
        await expect(inspectTopic({ brokers: [], topic: 'topic' })).rejects.toThrow('brokers is required');
    });

    test('requires topic', async () => {
        await expect(inspectTopic({ brokers: ['localhost:9092'], topic: '' })).rejects.toThrow('topic is required');
    });
});
