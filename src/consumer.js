/**
 * Kafka consumer utilities and CLI for KafkaJS.
 * Provides helpers to normalize broker addresses, start a consumer with graceful shutdown,
 * environment-driven configuration, and a CLI entrypoint when executed directly.
 *
 * Exports:
 * - parseBrokers: normalizes brokers (string or array) to an array of host:port strings.
 * - consumeMessages: high-level API to connect, subscribe, run, and gracefully stop a consumer.
 * - configFromEnv: builds configuration from environment variables for convenience/CLI.
 * - main: CLI entrypoint used when running this file directly.
 * - isDirectRun: detects whether the module is executed directly (node src/consumer.js).
 */
import pkg from 'kafkajs';
import * as url from 'url';
import path from 'path';

const { Kafka, logLevel, Partitioners } = pkg;

// Re-exported from shared utils to avoid duplication across modules
import { parseBrokers, waitForKafkaConnectivity } from './utils.js';
export { parseBrokers };

// Centralized logger
import logger from './logger.js';

/**
 * Waits before retrying an application-level message handler.
 * @param {number} milliseconds Delay duration.
 * @returns {Promise<void>} Resolves after the delay.
 */
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Converts Kafka header values to readable strings for logs and dead-letter metadata.
 * @param {Record<string, unknown>} headers Kafka message headers.
 * @returns {Record<string, string|string[]|null>} Normalized header values.
 */
export function normalizeHeaders(headers = {}) {
    return Object.fromEntries(
        Object.entries(headers).map(([name, headerValue]) => [
            name,
            Array.isArray(headerValue)
                ? headerValue.map((item) => item?.toString() ?? null)
                : (headerValue?.toString() ?? null),
        ]),
    );
}

/**
 * Processes one record with optional intentional failure, bounded retries, and DLQ routing.
 * A record is acknowledged by KafkaJS only after this function resolves. Without a DLQ,
 * the final error is rethrown so KafkaJS can apply its normal failed-handler behavior.
 * @param {Object} params Processing configuration.
 * @param {import('kafkajs').EachMessagePayload} params.payload KafkaJS message payload.
 * @param {Function} [params.eachMessage] User-provided message handler.
 * @param {string|number} [params.failOnKey] Key that should intentionally fail.
 * @param {string} [params.failOnValue] Value that should intentionally fail.
 * @param {number} params.maxRetries Number of retries after the first attempt.
 * @param {number} params.retryBackoffMs Delay between retries.
 * @param {import('kafkajs').Producer|null} params.deadLetterProducer Connected DLQ producer.
 * @param {string} [params.deadLetterTopic] Destination for exhausted records.
 * @param {string} params.groupId Consumer group identifier for logging.
 * @returns {Promise<void>} Resolves when handled or routed to the DLQ.
 */
export async function processMessage({
    payload,
    eachMessage,
    failOnKey,
    failOnValue,
    maxRetries,
    retryBackoffMs,
    deadLetterProducer,
    deadLetterTopic,
    groupId,
}) {
    const { topic, partition, message } = payload;
    const key = message.key?.toString() ?? null;
    const value = message.value?.toString() ?? null;
    const shouldFail =
        (typeof failOnKey !== 'undefined' && key === String(failOnKey)) ||
        (typeof failOnValue !== 'undefined' && value === String(failOnValue));
    let attempt = 0;

    while (true) {
        try {
            if (shouldFail) {
                throw new Error(
                    `Intentional failure for topic=${topic} partition=${partition} offset=${message.offset}`,
                );
            }
            if (typeof eachMessage === 'function') {
                await eachMessage(payload);
            } else {
                logger.info(
                    `Consumed message group=${groupId} topic=${topic} partition=${partition} offset=${message.offset} timestamp=${message.timestamp ?? null} headers=${JSON.stringify(normalizeHeaders(message.headers))} key=${key} value=${value}`,
                );
            }
            return;
        } catch (error) {
            if (attempt < maxRetries) {
                attempt++;
                logger.warn(
                    `Message processing failed; retrying attempt=${attempt}/${maxRetries} topic=${topic} partition=${partition} offset=${message.offset}: ${error.message}`,
                );
                await delay(retryBackoffMs);
                continue;
            }

            if (!deadLetterProducer || !deadLetterTopic) throw error;

            const headers = {
                ...message.headers,
                'original-topic': topic,
                'original-partition': String(partition),
                'original-offset': String(message.offset),
                'retry-count': String(attempt),
                error: error.message,
            };
            await deadLetterProducer.send({
                topic: deadLetterTopic,
                messages: [{ key: message.key, value: message.value, headers }],
            });
            logger.error(
                `Message routed to dead-letter topic=${deadLetterTopic} originalTopic=${topic} partition=${partition} offset=${message.offset} retries=${attempt} error=${error.message}`,
            );
            return;
        }
    }
}

/**
 * Starts a Kafka consumer and begins streaming messages from a topic.
 * Validates input, connects, subscribes, and runs the consumer. Supports AbortSignal for
 * graceful shutdown and includes basic retry logic when starting the run loop.
 *
 * @param {Object} params Consumer configuration.
 * @param {string|string[]} params.brokers Kafka broker(s), e.g., "localhost:9092" or ["host:port"].
 * @param {string} [params.clientId="kafka-nodejs-demo"] Kafka client ID.
 * @param {string} [params.groupId="kafka-nodejs-demo-group"] Consumer group ID.
 * @param {string} [params.topic="demo-topic"] Topic to subscribe to.
 * @param {boolean} [params.fromBeginning=true] When true, read from the beginning of the topic.
 * @param {(payload: import('kafkajs').EachMessagePayload) => (Promise<void>|void)} [params.eachMessage]
 *        Optional handler for each message. If omitted, messages are logged to stdout.
 * @param {string|number} [params.failOnKey] Intentionally fail records with this key.
 * @param {string} [params.failOnValue] Intentionally fail records with this value.
 * @param {number} [params.maxRetries=0] Number of application-level retries after the first attempt.
 * @param {number} [params.retryBackoffMs=100] Delay between application-level retries.
 * @param {string} [params.deadLetterTopic] Topic for records that still fail after retries.
 * @param {AbortSignal} [params.signal] Optional AbortSignal to stop and disconnect the consumer.
 * @throws {Error} If brokers or topic are not provided.
 * @returns {Promise<{stop: () => Promise<void>, runPromise: Promise<void>}>
 * } Object containing a stop function and the run promise.
 */
export async function consumeMessages({
    brokers,
    clientId = 'kafka-nodejs-demo',
    groupId = 'kafka-nodejs-demo-group',
    topic = 'demo-topic',
    fromBeginning = true,
    eachMessage,
    signal,
    failOnKey,
    failOnValue,
    maxRetries = 0,
    retryBackoffMs = 100,
    deadLetterTopic,
}) {
    if (!brokers || (Array.isArray(brokers) && brokers.length === 0)) {
        throw new Error('brokers is required');
    }
    if (!topic) throw new Error('topic is required');
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
        throw new Error('maxRetries must be a non-negative integer');
    }
    if (!Number.isInteger(retryBackoffMs) || retryBackoffMs < 0) {
        throw new Error('retryBackoffMs must be a non-negative integer');
    }

    const kafka = new Kafka({ clientId, brokers: parseBrokers(brokers), logLevel: logLevel.INFO });
    const consumer = kafka.consumer({ groupId });
    const deadLetterProducer = deadLetterTopic
        ? kafka.producer({ createPartitioner: Partitioners?.DefaultPartitioner })
        : null;

    let running = true;

    /**
     * Stops the Kafka consumer and releases its broker connection.
     *
     * The operation is idempotent: subsequent calls return without trying to
     * stop or disconnect the KafkaJS consumer again. Errors are logged so a
     * failure in one cleanup operation does not prevent the other from running.
     *
     * @returns {Promise<void>} Resolves after stop and disconnect cleanup has been attempted.
     */
    const stopConsumer = async () => {
        if (!running) return;
        logger.info('Stopping consumer...');
        running = false;
        try {
            await consumer.stop();
            logger.info('Consumer stopped');
        } catch (err) {
            logger.error('Error stopping consumer:', err);
        }
        try {
            await consumer.disconnect();
            logger.info('Consumer disconnected');
        } catch (err) {
            logger.error('Error disconnecting consumer:', err);
        }
        if (deadLetterProducer) {
            try {
                await deadLetterProducer.disconnect();
                logger.info('Dead-letter producer disconnected');
            } catch (err) {
                logger.error('Error disconnecting dead-letter producer:', err);
            }
        }
    };

    if (signal) {
        if (signal.aborted) {
            logger.warn('Signal already aborted, stopping consumer immediately');
            await stopConsumer();
        }
        signal.addEventListener('abort', stopConsumer, { once: true });
    }

    logger.info('Connecting to Kafka...');
    await consumer.connect();
    logger.info('Connected to Kafka successfully');

    logger.info(`Subscribing to topic: ${topic}, fromBeginning: ${fromBeginning}`);
    await consumer.subscribe({ topic, fromBeginning });
    logger.info('Subscribed to topic successfully');

    // Perform a readiness check via Kafka admin instead of a fixed sleep
    logger.info('Checking Kafka readiness (admin metadata)...');
    await waitForKafkaConnectivity(kafka);

    if (deadLetterProducer) {
        logger.info(`Connecting dead-letter producer for topic: ${deadLetterTopic}`);
        await deadLetterProducer.connect();
    }

    logger.info('Starting consumer run loop with retry logic...');
    let retries = 0;
    const maxStartupRetries = 3;
    let runPromise;

    while (retries < maxStartupRetries && running) {
        try {
            runPromise = consumer.run({
                eachMessage: async (payload) => {
                    if (!running) return;
                    await processMessage({
                        payload,
                        eachMessage,
                        failOnKey,
                        failOnValue,
                        maxRetries,
                        retryBackoffMs,
                        deadLetterProducer,
                        deadLetterTopic,
                        groupId,
                    });
                },
            });
            logger.info('Consumer run loop started successfully');
            break; // Success, exit retry loop
        } catch (error) {
            retries++;
            logger.warn(`Consumer start failed (attempt ${retries}/${maxStartupRetries}):`, error.message);
            if (retries < maxStartupRetries) {
                logger.info('Retrying after readiness check...');
                await waitForKafkaConnectivity(kafka, 5000);
            } else {
                logger.error('Max retries reached, consumer failed to start');
                throw error;
            }
        }
    }

    /**
     * Requests graceful shutdown and waits for the consumer run loop to exit.
     *
     * @returns {Promise<void>} Resolves when the consumer has stopped and its run loop has settled.
     */
    const stop = async () => {
        await stopConsumer();
        try {
            await runPromise; // ensure the run loop has exited
        } catch (_) {
            // ignore
        }
    };

    return { stop, runPromise };
}

/**
 * Builds a consumer configuration from environment variables.
 * Reads KAFKA_BROKERS, KAFKA_CLIENT_ID, KAFKA_GROUP_ID, KAFKA_TOPIC, FROM_BEGINNING,
 * FAIL_ON_KEY, FAIL_ON_VALUE, MAX_RETRIES, RETRY_BACKOFF_MS, and DEAD_LETTER_TOPIC.
 * @returns {{brokers: string|string[], clientId: string, groupId: string, topic: string, fromBeginning: boolean, failOnKey: (string|undefined), failOnValue: (string|undefined), maxRetries: number, retryBackoffMs: number, deadLetterTopic: (string|undefined)}}
 */
export function configFromEnv() {
    return {
        brokers: process.env.KAFKA_BROKERS || 'localhost:9092',
        clientId: process.env.KAFKA_CLIENT_ID || 'kafka-nodejs-demo',
        groupId: process.env.KAFKA_GROUP_ID || 'kafka-nodejs-demo-group',
        topic: process.env.KAFKA_TOPIC || 'demo-topic',
        fromBeginning: process.env.FROM_BEGINNING ? process.env.FROM_BEGINNING === 'true' : true,
        failOnKey: process.env.FAIL_ON_KEY,
        failOnValue: process.env.FAIL_ON_VALUE,
        maxRetries: process.env.MAX_RETRIES ? Number(process.env.MAX_RETRIES) : 0,
        retryBackoffMs: process.env.RETRY_BACKOFF_MS ? Number(process.env.RETRY_BACKOFF_MS) : 100,
        deadLetterTopic: process.env.DEAD_LETTER_TOPIC,
    };
}

/**
 * CLI entrypoint to start the consumer using environment configuration.
 * Installs SIGINT/SIGTERM handlers to gracefully stop. Sets process.exitCode = 1 on error.
 * Accepts dependency injection for tests.
 * @param {{ consumeMessages: typeof consumeMessages }} [deps] Optional dependency overrides.
 * @returns {Promise<void>} Resolves when the consumer stops (e.g., via signal).
 */
export async function main(deps = { consumeMessages }) {
    const cfg = configFromEnv();
    const ac = new AbortController();
    const signal = ac.signal;
    process.on('SIGINT', () => ac.abort());
    process.on('SIGTERM', () => ac.abort());
    try {
        logger.info(`Starting consumer: topic=${cfg.topic}, brokers=${cfg.brokers}`);
        const { runPromise } = await deps.consumeMessages({ ...cfg, signal });
        // Keep the process alive until the consumer stops (e.g., on SIGINT/SIGTERM)
        await runPromise;
    } catch (err) {
        logger.error('Consumer error:', err);
        process.exitCode = 1;
    }
}

// Run as CLI if executed directly
/**
 * Detects whether this module is being executed directly (not imported) in Node.js.
 * Useful to guard the CLI entrypoint for ESM modules.
 *
 * Several path and URL comparisons are attempted because `process.argv[1]` can
 * be represented differently by Node.js and by test runners.
 *
 * @returns {boolean} True if run via `node src/consumer.js`, false if imported.
 */
function computeDirectRun() {
    try {
        const argv1 = process.argv[1];
        if (!argv1) return false;

        // Normalize argv1 into a path when possible
        let argvAsPath = argv1;
        try {
            if (argv1.startsWith('file:')) {
                argvAsPath = url.fileURLToPath(argv1);
            }
        } catch {}

        // Try to get module path from import.meta.url
        let modulePath = null;
        try {
            modulePath = url.fileURLToPath(import.meta.url);
        } catch {
            try {
                modulePath = decodeURIComponent(new URL(import.meta.url).pathname);
            } catch {}
        }

        // 1) Exact URL equality (common case)
        try {
            if (import.meta.url === url.pathToFileURL(argv1).href) return true;
        } catch {}

        // 2) Direct string equality of normalized paths
        if (modulePath && argvAsPath === modulePath) return true;

        // 3) Resolved path equality (handles relative segments and symlinks in many cases)
        try {
            if (modulePath && path.resolve(modulePath) === path.resolve(argvAsPath)) return true;
        } catch {}

        // 4) Basename match as a very last resort (helps in constrained test environments)
        try {
            if (modulePath && path.basename(modulePath) === path.basename(argvAsPath)) return true;
        } catch {}

        return false;
    } catch {
        return false;
    }
}

const __DIRECT_RUN__ = computeDirectRun();

/**
 * Reports whether the consumer module was started as a CLI script.
 *
 * @returns {boolean} True when this file is the direct Node.js entrypoint.
 */
export const isDirectRun = () => __DIRECT_RUN__;

if (isDirectRun()) {
    // no top-level await to keep Node versions happy
    main();
}
