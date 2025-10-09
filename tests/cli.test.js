import {describe, test, expect, beforeEach, afterEach, jest} from '@jest/globals';
import * as producer from '../src/producer.js';
import * as consumer from '../src/consumer.js';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  // fresh copy for each test
  process.env = {...ORIGINAL_ENV};
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

    const cfg = producer.configFromEnv();
    expect(cfg).toEqual({
      brokers: 'localhost:9092',
      clientId: 'kafka-nodejs-demo',
      topic: 'demo-topic',
      message: 'hello from producer',
      key: undefined,
    });
  });

  test('uses env overrides', () => {
    process.env.KAFKA_BROKERS = 'b1:9092,b2:9092';
    process.env.KAFKA_CLIENT_ID = 'cid';
    process.env.KAFKA_TOPIC = 't1';
    process.env.MESSAGE = 'm1';
    process.env.KEY = 'kk';

    const cfg = producer.configFromEnv();
    expect(cfg).toEqual({
      brokers: 'b1:9092,b2:9092',
      clientId: 'cid',
      topic: 't1',
      message: 'm1',
      key: 'kk',
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

    const cfg = consumer.configFromEnv();
    expect(cfg).toEqual({
      brokers: 'localhost:9092',
      clientId: 'kafka-nodejs-demo',
      groupId: 'kafka-nodejs-demo-group',
      topic: 'demo-topic',
      fromBeginning: true,
    });
  });

  test('uses env overrides and coerces FROM_BEGINNING', () => {
    process.env.KAFKA_BROKERS = 'b:1';
    process.env.KAFKA_CLIENT_ID = 'cid2';
    process.env.KAFKA_GROUP_ID = 'gid2';
    process.env.KAFKA_TOPIC = 't2';
    process.env.FROM_BEGINNING = 'false';

    const cfg = consumer.configFromEnv();
    expect(cfg).toEqual({
      brokers: 'b:1',
      clientId: 'cid2',
      groupId: 'gid2',
      topic: 't2',
      fromBeginning: false,
    });
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
    const deps = { produceMessage: async () => { throw new Error('boom'); } };
    await producer.main(deps);
    expect(process.exitCode).toBe(1);
  });
});

describe('consumer.main (via dependency injection)', () => {
  test('awaits injected runPromise and does not set exitCode on success', async () => {
    const deps = { consumeMessages: async () => ({ stop: () => {}, runPromise: Promise.resolve() }) };
    await consumer.main(deps);
    expect(process.exitCode).toBeUndefined();
  });

  test('sets exitCode=1 on injected error', async () => {
    const deps = { consumeMessages: async () => { throw new Error('fail'); } };
    await consumer.main(deps);
    expect(process.exitCode).toBe(1);
  });
});
