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

const {Kafka, logLevel} = pkg;

/**
 * Normalizes broker endpoints into an array of host:port strings.
 * Accepts either a comma-separated string ("host1:port1,host2:port2")
 * or an array of strings. Strips the optional "PLAINTEXT://" prefix.
 * @param {string|string[]} input Broker endpoints as a string or array.
 * @returns {string[]} Array of brokers in "host:port" format. Returns [] for invalid input.
 */
export function parseBrokers(input) {
    if (Array.isArray(input)) return input;
    if (typeof input !== 'string') return [];
    return input
        .split(',')
        .map((b) => b.trim().replace(/^PLAINTEXT:\/\//, ''))
        .filter(Boolean);
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
                                      }) {
    if (!brokers || (Array.isArray(brokers) && brokers.length === 0)) {
        throw new Error('brokers is required');
    }
    if (!topic) throw new Error('topic is required');

    const kafka = new Kafka({clientId, brokers: parseBrokers(brokers), logLevel: logLevel.INFO});
    const consumer = kafka.consumer({groupId});

    let running = true;

    const stopConsumer = async () => {
        if (!running) return;
        console.log('Stopping consumer...');
        running = false;
        try {
            await consumer.stop();
            console.log('Consumer stopped');
        } catch (err) {
            console.error('Error stopping consumer:', err);
        }
        try {
            await consumer.disconnect();
            console.log('Consumer disconnected');
        } catch (err) {
            console.error('Error disconnecting consumer:', err);
        }
    };

    if (signal) {
        if (signal.aborted) {
            console.log('Signal already aborted, stopping consumer immediately');
            await stopConsumer();
        }
        signal.addEventListener('abort', stopConsumer, {once: true});
    }

    console.log('Connecting to Kafka...');
    await consumer.connect();
    console.log('Connected to Kafka successfully');
    
    console.log(`Subscribing to topic: ${topic}, fromBeginning: ${fromBeginning}`);
    await consumer.subscribe({topic, fromBeginning});
    console.log('Subscribed to topic successfully');

    // Perform a readiness check via Kafka admin instead of a fixed sleep
    console.log('Checking Kafka readiness (admin metadata)...');
    async function waitForKafkaConnectivity(timeoutMs = 10000) {
        // In unit tests, the Kafka mock may not provide admin(); treat as ready
        if (!kafka || typeof kafka.admin !== 'function') return;
        const admin = kafka.admin();
        const start = Date.now();
        try {
            await admin.connect();
            // Poll describeCluster until it succeeds or timeout
            for (;;) {
                try {
                    await admin.describeCluster();
                    return; // ready
                } catch {
                    if (Date.now() - start > timeoutMs) throw new Error('Kafka not ready in time');
                    await new Promise(r => setTimeout(r, 250));
                }
            }
        } finally {
            try { await admin.disconnect(); } catch {}
        }
    }

    await waitForKafkaConnectivity();

    console.log('Starting consumer run loop with retry logic...');
    let retries = 0;
    const maxRetries = 3;
    let runPromise;
    
    while (retries < maxRetries && running) {
        try {
            runPromise = consumer.run({
                eachMessage: async (payload) => {
                    if (!running) return;
                    if (typeof eachMessage === 'function') {
                        await eachMessage(payload);
                    } else {
                        const {topic, partition, message} = payload;
                        const key = message.key ? message.key.toString() : null;
                        const value = message.value ? message.value.toString() : null;
                        console.log(`Consumed message topic=${topic} partition=${partition} key=${key} value=${value}`);
                    }
                },
            });
            console.log('Consumer run loop started successfully');
            break; // Success, exit retry loop
        } catch (error) {
            retries++;
            console.log(`Consumer start failed (attempt ${retries}/${maxRetries}):`, error.message);
            if (retries < maxRetries) {
                console.log('Retrying after readiness check...');
                await waitForKafkaConnectivity(5000);
            } else {
                console.error('Max retries reached, consumer failed to start');
                throw error;
            }
        }
    }

    const stop = async () => {
        await stopConsumer();
        try {
            await runPromise; // ensure the run loop has exited
        } catch (_) {
            // ignore
        }
    };

    return {stop, runPromise};
}

/**
 * Builds a consumer configuration from environment variables.
 * Reads KAFKA_BROKERS, KAFKA_CLIENT_ID, KAFKA_GROUP_ID, KAFKA_TOPIC, FROM_BEGINNING.
 * @returns {{brokers: string|string[], clientId: string, groupId: string, topic: string, fromBeginning: boolean}}
 */
export function configFromEnv() {
    return {
        brokers: process.env.KAFKA_BROKERS || 'localhost:9092',
        clientId: process.env.KAFKA_CLIENT_ID || 'kafka-nodejs-demo',
        groupId: process.env.KAFKA_GROUP_ID || 'kafka-nodejs-demo-group',
        topic: process.env.KAFKA_TOPIC || 'demo-topic',
        fromBeginning: process.env.FROM_BEGINNING ? process.env.FROM_BEGINNING === 'true' : true,
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
        console.log(`Starting consumer: topic=${cfg.topic}, brokers=${cfg.brokers}`);
        const {runPromise} = await deps.consumeMessages({...cfg, signal});
        // Keep the process alive until the consumer stops (e.g., on SIGINT/SIGTERM)
        await runPromise;
    } catch (err) {
        console.error('Consumer error:', err);
        process.exitCode = 1;
    }
}

// Run as CLI if executed directly
/**
 * Detects whether this module is being executed directly (not imported) in Node.js.
 * Useful to guard the CLI entrypoint for ESM modules.
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
        if (modulePath && (argvAsPath === modulePath)) return true;

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

export const isDirectRun = () => __DIRECT_RUN__;

if (isDirectRun()) {
    // no top-level await to keep Node versions happy
    main();
}
