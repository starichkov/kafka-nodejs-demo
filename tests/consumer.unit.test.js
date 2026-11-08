import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Helper to reset module registry between tests
async function importConsumerWithMocks({
    kafkajsMockFactory,
    urlMockFactory,
    setArgvToConsumer = false,
    useFakeTimers = false,
} = {}) {
    jest.resetModules();
    if (useFakeTimers) {
        // Preserve the wall clock used by KafkaJS while controlling the retry delay.
        jest.useFakeTimers({ doNotFake: ['Date'] });
    }

    if (kafkajsMockFactory) {
        jest.unstable_mockModule('kafkajs', kafkajsMockFactory);
    } else {
        // Default minimal mock to avoid real network if imported accidentally
        jest.unstable_mockModule('kafkajs', () => {
            const Kafka = jest.fn(() => ({
                consumer: jest.fn(() => ({
                    connect: jest.fn().mockResolvedValue(undefined),
                    subscribe: jest.fn().mockResolvedValue(undefined),
                    run: jest.fn().mockResolvedValue(undefined),
                    stop: jest.fn().mockResolvedValue(undefined),
                    disconnect: jest.fn().mockResolvedValue(undefined),
                })),
            }));
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
            .mockImplementationOnce(() => {
                throw new Error('run failed first');
            })
            .mockImplementationOnce(
                () =>
                    new Promise((res, rej) => {
                        runResolve = res;
                        runReject = rej;
                    }),
            );

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

        // Attach a rejection handler before triggering the controllable run failure.
        const handledRunPromise = runPromise.catch(() => {});

        // trigger run loop rejection to exercise stop() catch-ignore for awaiting runPromise
        runReject(new Error('run loop error'));

        await stopFn();
        await handledRunPromise;

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
        const run = jest.fn().mockImplementation(() => {
            throw new Error('run failed');
        }); // always fails synchronously

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

describe('consumeMessages default record logging (unit)', () => {
    test('normalizes scalar, array, and missing header values', async () => {
        let eachMessage;
        const stop = jest.fn().mockResolvedValue(undefined);
        const Kafka = jest.fn(() => ({
            consumer: jest.fn(() => ({
                connect: jest.fn().mockResolvedValue(undefined),
                subscribe: jest.fn().mockResolvedValue(undefined),
                run: jest.fn((options) => {
                    eachMessage = options.eachMessage;
                    return Promise.resolve();
                }),
                stop,
                disconnect: jest.fn().mockResolvedValue(undefined),
            })),
        }));

        const { consumeMessages } = await importConsumerWithMocks({
            kafkajsMockFactory: () => ({ default: { Kafka, logLevel: { INFO: 4 } }, Kafka, logLevel: { INFO: 4 } }),
        });

        const { stop: stopConsumer } = await consumeMessages({ brokers: ['b:1'], topic: 't', groupId: 'g' });
        await eachMessage({
            topic: 't',
            partition: 0,
            message: {
                offset: '0',
                timestamp: null,
                key: null,
                value: null,
                headers: { scalar: Buffer.from('one'), many: [Buffer.from('two'), undefined], missing: undefined },
            },
        });
        await stopConsumer();

        expect(stop).toHaveBeenCalledTimes(1);
    });
});

describe('consumeMessages validation and dead-letter cleanup (unit)', () => {
    test.each([
        [{ maxRetries: -1 }, 'maxRetries must be a non-negative integer'],
        [{ maxRetries: 1.5 }, 'maxRetries must be a non-negative integer'],
        [{ retryBackoffMs: -1 }, 'retryBackoffMs must be a non-negative integer'],
        [{ retryBackoffMs: 1.5 }, 'retryBackoffMs must be a non-negative integer'],
    ])('rejects invalid retry option %j', async (options, error) => {
        const { consumeMessages } = await importConsumerWithMocks();

        await expect(consumeMessages({ brokers: ['b:1'], topic: 't', ...options })).rejects.toThrow(error);
    });

    test('continues cleanup when the dead-letter producer disconnect fails', async () => {
        const disconnect = jest.fn().mockResolvedValue(undefined);
        const deadLetterDisconnect = jest.fn().mockRejectedValue(new Error('dead-letter disconnect failed'));
        const Kafka = jest.fn(() => ({
            consumer: jest.fn(() => ({
                connect: jest.fn().mockResolvedValue(undefined),
                subscribe: jest.fn().mockResolvedValue(undefined),
                run: jest.fn().mockResolvedValue(undefined),
                stop: jest.fn().mockResolvedValue(undefined),
                disconnect,
            })),
            admin: jest.fn(() => ({
                connect: jest.fn().mockResolvedValue(undefined),
                describeCluster: jest.fn().mockResolvedValue({}),
                listTopics: jest.fn().mockResolvedValue([]),
                disconnect: jest.fn().mockResolvedValue(undefined),
            })),
            producer: jest.fn(() => ({
                connect: jest.fn().mockResolvedValue(undefined),
                disconnect: deadLetterDisconnect,
            })),
        }));

        const { consumeMessages } = await importConsumerWithMocks({
            kafkajsMockFactory: () => ({ default: { Kafka, logLevel: { INFO: 4 } }, Kafka, logLevel: { INFO: 4 } }),
        });

        const result = await consumeMessages({ brokers: ['b:1'], topic: 't', deadLetterTopic: 't.dlq' });
        await result.stop();

        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(deadLetterDisconnect).toHaveBeenCalledTimes(1);
    });
});

describe('processMessage retry and dead-letter behavior (unit)', () => {
    test('retries a transient handler failure and then succeeds', async () => {
        const { processMessage } = await importConsumerWithMocks();
        let attempts = 0;

        await processMessage({
            payload: {
                topic: 'source',
                partition: 1,
                message: { offset: '7', key: Buffer.from('k'), value: Buffer.from('v') },
            },
            eachMessage: async () => {
                attempts++;
                if (attempts < 3) throw new Error('temporary failure');
            },
            maxRetries: 2,
            retryBackoffMs: 0,
            groupId: 'group',
        });

        expect(attempts).toBe(3);
    });

    test('publishes exhausted failures with original record metadata', async () => {
        const { processMessage } = await importConsumerWithMocks();
        const send = jest.fn().mockResolvedValue(undefined);

        await processMessage({
            payload: {
                topic: 'source',
                partition: 2,
                message: {
                    offset: '9',
                    key: Buffer.from('bad'),
                    value: Buffer.from('payload'),
                    headers: { trace: Buffer.from('abc') },
                },
            },
            failOnKey: 'bad',
            maxRetries: 2,
            retryBackoffMs: 0,
            deadLetterProducer: { send },
            deadLetterTopic: 'source.dlq',
            groupId: 'group',
        });

        expect(send).toHaveBeenCalledWith({
            topic: 'source.dlq',
            messages: [
                expect.objectContaining({
                    key: Buffer.from('bad'),
                    value: Buffer.from('payload'),
                    headers: expect.objectContaining({
                        trace: Buffer.from('abc'),
                        'original-topic': 'source',
                        'original-partition': '2',
                        'original-offset': '9',
                        'retry-count': '2',
                        error: expect.stringContaining('Intentional failure'),
                    }),
                }),
            ],
        });
    });

    test('rethrows the final failure when no dead-letter topic is configured', async () => {
        const { processMessage } = await importConsumerWithMocks();

        await expect(
            processMessage({
                payload: {
                    topic: 'source',
                    partition: 0,
                    message: { offset: '1', key: null, value: Buffer.from('bad') },
                },
                failOnValue: 'bad',
                maxRetries: 1,
                retryBackoffMs: 0,
                groupId: 'group',
            }),
        ).rejects.toThrow('Intentional failure');
    });
});

describe('isDirectRun edge cases', () => {
    test('isDirectRun returns false when pathToFileURL throws (catch branch)', async () => {
        const { isDirectRun } = await importConsumerWithMocks({
            urlMockFactory: () => ({
                pathToFileURL: jest.fn(() => {
                    throw new Error('boom');
                }),
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
        const run = jest.fn().mockImplementation(
            () =>
                new Promise((res) => {
                    runResolve = res;
                }),
        );
        const stop = jest.fn().mockResolvedValue(undefined);
        const disconnect = jest.fn().mockResolvedValue(undefined);

        const consumerObj = { connect, subscribe, run, stop, disconnect };
        const Kafka = jest.fn(() => ({ consumer: jest.fn(() => consumerObj) }));

        // Import with argv set to this module's path so isDirectRun() is true
        const mod = await importConsumerWithMocks({
            kafkajsMockFactory: () => ({ default: { Kafka, logLevel: { INFO: 4 } }, Kafka, logLevel: { INFO: 4 } }),
            setArgvToConsumer: true,
            useFakeTimers: true,
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
