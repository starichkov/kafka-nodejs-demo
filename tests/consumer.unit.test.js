import {describe, test, expect, jest, beforeEach, afterEach} from '@jest/globals';

// Helper to reset module registry between tests
async function importConsumerWithMocks({
  kafkajsMockFactory,
  urlMockFactory,
  setArgvToConsumer = false,
  useFakeTimers = false,
} = {}) {
  jest.resetModules();
  if (useFakeTimers) {
    jest.useFakeTimers();
  }

  if (kafkajsMockFactory) {
    jest.unstable_mockModule('kafkajs', kafkajsMockFactory);
  } else {
    // Default minimal mock to avoid real network if imported accidentally
    jest.unstable_mockModule('kafkajs', () => {
      const Kafka = jest.fn(() => ({ consumer: jest.fn(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        subscribe: jest.fn().mockResolvedValue(undefined),
        run: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn().mockResolvedValue(undefined),
      })) }));
      const logLevel = { INFO: 4 };
      return { default: { Kafka, logLevel }, Kafka, logLevel };
    });
  }

  if (urlMockFactory) {
    jest.unstable_mockModule('url', urlMockFactory);
  }

  const path = new URL('../src/consumer.js', import.meta.url);
  const prevArgv1 = process.argv[1];
  const prevFast = process.env.CONSUMER_FAST_START;
  process.env.CONSUMER_FAST_START = 'true';
  if (setArgvToConsumer) {
    process.argv[1] = decodeURIComponent(path.pathname);
  }

  const consumerModule = await import('../src/consumer.js');

  // restore argv/env so other tests aren't affected
  process.argv[1] = prevArgv1;
  process.env.CONSUMER_FAST_START = prevFast;

  return consumerModule;
}

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('consumeMessages retry and stop error branches (unit)', () => {
  test('retries once then succeeds; stop handles stop/disconnect errors and runPromise rejection', async () => {
    let runResolve, runReject;
    const connect = jest.fn().mockResolvedValue(undefined);
    const subscribe = jest.fn().mockResolvedValue(undefined);

    // First call throws synchronously to trigger retry, second returns controllable promise
    const run = jest
      .fn()
      .mockImplementationOnce(() => { throw new Error('run failed first'); })
      .mockImplementationOnce(() => new Promise((res, rej) => { runResolve = res; runReject = rej; }));

    const stop = jest.fn().mockRejectedValue(new Error('stop failure'));
    const disconnect = jest.fn().mockRejectedValue(new Error('disconnect failure'));

    const consumerObj = { connect, subscribe, run, stop, disconnect };

    // Kafka mock
    const Kafka = jest.fn(() => ({
      consumer: jest.fn(() => consumerObj),
    }));

    const { consumeMessages } = await importConsumerWithMocks({
      kafkajsMockFactory: () => ({ default: { Kafka, logLevel: { INFO: 4 } }, Kafka, logLevel: { INFO: 4 } }),
    });

    const promise = consumeMessages({ brokers: ['b:1'], topic: 't', clientId: 'c', groupId: 'g' });


    const { stop: stopFn, runPromise } = await promise;

    // Prevent unhandled rejection while still letting stop() await a rejecting runPromise
    runPromise.catch(() => {});

    // trigger run loop rejection to exercise stop() catch-ignore for awaiting runPromise
    runReject(new Error('run loop error'));

    await stopFn();

    // verify interactions
    expect(connect).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2); // one failure + one success
    expect(stop).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  }, 15000);

  test('max retries reached causes consumeMessages to throw', async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const subscribe = jest.fn().mockResolvedValue(undefined);
    const run = jest.fn()
      .mockImplementation(() => { throw new Error('run failed'); }); // always fails synchronously

    const stop = jest.fn();
    const disconnect = jest.fn();

    const consumerObj = { connect, subscribe, run, stop, disconnect };

    const Kafka = jest.fn(() => ({ consumer: jest.fn(() => consumerObj) }));

    const { consumeMessages } = await importConsumerWithMocks({
      kafkajsMockFactory: () => ({ default: { Kafka, logLevel: { INFO: 4 } }, Kafka, logLevel: { INFO: 4 } }),
    });

    const p = consumeMessages({ brokers: ['b:1'], topic: 't', clientId: 'c', groupId: 'g' });


    await expect(p).rejects.toThrow('run failed');
  }, 15000);
});

describe('isDirectRun edge cases', () => {
  test('isDirectRun returns false when pathToFileURL throws (catch branch)', async () => {
    const { isDirectRun } = await importConsumerWithMocks({
      urlMockFactory: () => ({
        pathToFileURL: jest.fn(() => { throw new Error('boom'); }),
      }),
      // ensure we do not accidentally hit direct-run path
      setArgvToConsumer: false,
    });

    expect(isDirectRun()).toBe(false);
  });

  test('direct-run guard calls main() when argv points to module path', async () => {
    let runResolve;

    const connect = jest.fn().mockResolvedValue(undefined);
    const subscribe = jest.fn().mockResolvedValue(undefined);
    const run = jest.fn().mockImplementation(() => new Promise((res) => { runResolve = res; }));
    const stop = jest.fn().mockResolvedValue(undefined);
    const disconnect = jest.fn().mockResolvedValue(undefined);

    const consumerObj = { connect, subscribe, run, stop, disconnect };
    const Kafka = jest.fn(() => ({ consumer: jest.fn(() => consumerObj) }));

    // Import with argv set to this module's path so isDirectRun() is true
    const mod = await importConsumerWithMocks({
      kafkajsMockFactory: () => ({ default: { Kafka, logLevel: { INFO: 4 } }, Kafka, logLevel: { INFO: 4 } }),
      setArgvToConsumer: true,
    });

    // Flush the 5s wait
    jest.advanceTimersByTime(5000);
    await Promise.resolve();

    // isDirectRun should be true in this context
    expect(mod.isDirectRun()).toBe(true);

    // Resolve run loop to allow main to finish (only if set)
    if (typeof runResolve === 'function') runResolve();

    // Give microtasks a chance to settle
    await Promise.resolve();

    // If main() was invoked, our mocks must have been called
    expect(connect).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  }, 15000);
});
