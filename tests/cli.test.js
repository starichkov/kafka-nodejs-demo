import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as producer from '../src/producer.js';
import * as consumer from '../src/consumer.js';
import * as topicAdmin from '../src/topic-admin.js';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
    // fresh copy for each test
    process.env = { ...ORIGINAL_ENV };
    process.exitCode = undefined;
});

afterEach(() => {
    process.env = ORIGINAL_ENV;
    process.exitCode = undefined;
    jest.restoreAllMocks();
    jest.clearAllMocks();
});

describe('configFromEnv (producer)', () => {
    test('returns defaults when env not set', () => {
        delete process.env.KAFKA_BROKERS;
        delete process.env.KAFKA_CLIENT_ID;
        delete process.env.KAFKA_TOPIC;
        delete process.env.MESSAGE;
        delete process.env.KEY;
        delete process.env.MESSAGE_COUNT;
        delete process.env.PARTITION;
        delete process.env.MESSAGE_HEADERS;
        delete process.env.MESSAGE_TIMESTAMP;
        delete process.env.PRODUCER_ACKS;
        delete process.env.PRODUCER_RETRIES;
        delete process.env.PRODUCER_IDEMPOTENT;

        const cfg = producer.configFromEnv();
        expect(cfg).toEqual({
            brokers: 'localhost:9092',
            clientId: 'kafka-nodejs-demo',
            topic: 'demo-topic',
            message: 'hello from producer',
            key: undefined,
            messageCount: 1,
            partition: undefined,
            headers: undefined,
            timestamp: undefined,
            acks: -1,
            retries: 5,
            idempotent: false,
        });
    });

    test('uses env overrides', () => {
        process.env.KAFKA_BROKERS = 'b1:9092,b2:9092';
        process.env.KAFKA_CLIENT_ID = 'cid';
        process.env.KAFKA_TOPIC = 't1';
        process.env.MESSAGE = 'm1';
        process.env.KEY = 'kk';
        process.env.MESSAGE_COUNT = '3';
        process.env.PARTITION = '1';
        process.env.MESSAGE_HEADERS = '{"trace-id":"abc"}';
        process.env.MESSAGE_TIMESTAMP = '1700000000000';
        process.env.PRODUCER_ACKS = '1';
        process.env.PRODUCER_RETRIES = '8';
        process.env.PRODUCER_IDEMPOTENT = 'true';

        const cfg = producer.configFromEnv();
        expect(cfg).toEqual({
            brokers: 'b1:9092,b2:9092',
            clientId: 'cid',
            topic: 't1',
            message: 'm1',
            key: 'kk',
            messageCount: 3,
            partition: 1,
            headers: { 'trace-id': 'abc' },
            timestamp: '1700000000000',
            acks: 1,
            retries: 8,
            idempotent: true,
        });
    });
});

describe('configFromEnv (consumer)', () => {
    test('returns defaults when env not set', () => {
        delete process.env.KAFKA_BROKERS;
        delete process.env.KAFKA_CLIENT_ID;
        delete process.env.KAFKA_GROUP_ID;
        delete process.env.KAFKA_TOPIC;
        delete process.env.FROM_BEGINNING;
        delete process.env.FAIL_ON_KEY;
        delete process.env.FAIL_ON_VALUE;
        delete process.env.MAX_RETRIES;
        delete process.env.RETRY_BACKOFF_MS;
        delete process.env.DEAD_LETTER_TOPIC;

        const cfg = consumer.configFromEnv();
        expect(cfg).toEqual({
            brokers: 'localhost:9092',
            clientId: 'kafka-nodejs-demo',
            groupId: 'kafka-nodejs-demo-group',
            topic: 'demo-topic',
            fromBeginning: true,
            failOnKey: undefined,
            failOnValue: undefined,
            maxRetries: 0,
            retryBackoffMs: 100,
            deadLetterTopic: undefined,
        });
    });

    test('uses env overrides and coerces FROM_BEGINNING', () => {
        process.env.KAFKA_BROKERS = 'b:1';
        process.env.KAFKA_CLIENT_ID = 'cid2';
        process.env.KAFKA_GROUP_ID = 'gid2';
        process.env.KAFKA_TOPIC = 't2';
        process.env.FROM_BEGINNING = 'false';
        process.env.FAIL_ON_KEY = 'bad-key';
        process.env.FAIL_ON_VALUE = 'bad-value';
        process.env.MAX_RETRIES = '2';
        process.env.RETRY_BACKOFF_MS = '250';
        process.env.DEAD_LETTER_TOPIC = 'demo-dlq';

        const cfg = consumer.configFromEnv();
        expect(cfg).toEqual({
            brokers: 'b:1',
            clientId: 'cid2',
            groupId: 'gid2',
            topic: 't2',
            fromBeginning: false,
            failOnKey: 'bad-key',
            failOnValue: 'bad-value',
            maxRetries: 2,
            retryBackoffMs: 250,
            deadLetterTopic: 'demo-dlq',
        });
    });
});

describe('configFromEnv (topic admin)', () => {
    test('returns topic inspection defaults', () => {
        delete process.env.KAFKA_BROKERS;
        delete process.env.KAFKA_CLIENT_ID;
        delete process.env.KAFKA_TOPIC;

        expect(topicAdmin.configFromEnv()).toEqual({
            brokers: 'localhost:9092',
            topic: 'demo-topic',
            clientId: 'kafka-nodejs-topic-admin',
        });
    });

    test('reports offsets through the injected inspection function', async () => {
        process.env.KAFKA_TOPIC = 'lesson-topic';
        const inspectTopic = jest.fn().mockResolvedValue([{ partition: 0, low: '0', high: '2' }]);

        await topicAdmin.main({ inspectTopic });

        expect(inspectTopic).toHaveBeenCalledWith({
            brokers: 'localhost:9092',
            topic: 'lesson-topic',
            clientId: 'kafka-nodejs-topic-admin',
        });
        expect(process.exitCode).toBe(0);
    });

    test('sets exitCode=1 when inspection fails', async () => {
        await topicAdmin.main({ inspectTopic: jest.fn().mockRejectedValue(new Error('boom')) });
        expect(process.exitCode).toBe(1);
    });
});

describe('isDirectRun returns false under Jest (not executed as script)', () => {
    test('producer.isDirectRun()', () => {
        expect(producer.isDirectRun()).toBe(false);
    });
    test('consumer.isDirectRun()', () => {
        expect(consumer.isDirectRun()).toBe(false);
    });
});

describe('producer.main (via dependency injection)', () => {
    test('sets exitCode=0 on success and calls injected produceMessage', async () => {
        const deps = { produceMessage: async () => {} };
        await producer.main(deps);
        expect(process.exitCode).toBe(0);
    });

    test('sets exitCode=1 on injected error', async () => {
        const deps = {
            produceMessage: async () => {
                throw new Error('boom');
            },
        };
        await producer.main(deps);
        expect(process.exitCode).toBe(1);
    });

    test('logs metadata for each produced record', async () => {
        const deps = {
            produceMessage: async () => [
                { topicName: 'topic', partition: 1, baseOffset: '4' },
                { topicName: 'topic', partition: 1, baseOffset: '5' },
            ],
        };

        await producer.main(deps);

        expect(process.exitCode).toBe(0);
    });
});

describe('consumer.main (via dependency injection)', () => {
    test('awaits injected runPromise and does not set exitCode on success', async () => {
        const deps = { consumeMessages: async () => ({ stop: () => {}, runPromise: Promise.resolve() }) };
        await consumer.main(deps);
        expect(process.exitCode).toBeUndefined();
    });

    test('sets exitCode=1 on injected error', async () => {
        const deps = {
            consumeMessages: async () => {
                throw new Error('fail');
            },
        };
        await consumer.main(deps);
        expect(process.exitCode).toBe(1);
    });
});
