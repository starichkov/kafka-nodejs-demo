/**
 * Kafka producer utilities and CLI for KafkaJS.
 * Provides helpers to normalize broker addresses, produce a single message,
 * environment-driven configuration, and a CLI entrypoint when executed directly.
 *
 * Exports:
 * - parseBrokers: normalizes brokers (string or array) to an array of host:port strings.
 * - produceMessage: connects, sends a single message to a topic, and disconnects.
 * - configFromEnv: builds configuration from environment variables for convenience/CLI.
 * - main: CLI entrypoint used when running this file directly.
 * - isDirectRun: detects whether the module is executed directly (node src/producer.js).
 */
import pkg from 'kafkajs';
import {pathToFileURL} from 'url';

const {Kafka, logLevel} = pkg;

// Re-exported from shared utils to avoid duplication across modules
import {parseBrokers} from './utils.js';
export {parseBrokers};

/**
 * Produces a single message to a Kafka topic.
 * Validates input, creates a producer, connects, sends, and disconnects.
 *
 * @param {Object} params Producer configuration.
 * @param {string|string[]} params.brokers Kafka broker(s), e.g., "localhost:9092" or ["host:port"].
 * @param {string} [params.clientId="kafka-nodejs-demo"] Kafka client ID used by KafkaJS.
 * @param {string} [params.topic="demo-topic"] Topic to which the message will be produced.
 * @param {unknown} params.message The message payload. Strings/Buffers are used as-is; other types are JSON.stringified.
 * @param {string|number|null} [params.key] Optional key associated with the message (will be stringified; null if undefined).
 * @throws {Error} If brokers, topic, or message are not provided.
 * @returns {Promise<void>} Resolves when the message has been sent and the producer disconnected.
 */
export async function produceMessage({brokers, clientId = 'kafka-nodejs-demo', topic = 'demo-topic', message, key}) {
    if (!brokers || (Array.isArray(brokers) && brokers.length === 0)) {
        throw new Error('brokers is required');
    }
    if (!topic) throw new Error('topic is required');
    if (typeof message === 'undefined' || message === null) throw new Error('message is required');

    const kafka = new Kafka({clientId, brokers: parseBrokers(brokers), logLevel: logLevel.NOTHING});
    const producer = kafka.producer();

    // Perform a readiness check via Kafka admin instead of relying on timing
    console.log('Checking Kafka readiness (producer admin metadata)...');
    async function waitForKafkaConnectivity(timeoutMs = 10000) {
        // In unit tests or mocks, kafka.admin may be unavailable; treat as ready
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

    await producer.connect();
    try {
        await producer.send({
            topic,
            messages: [
                {
                    key: typeof key === 'undefined' ? null : String(key),
                    value: typeof message === 'string' || Buffer.isBuffer(message) ? message : JSON.stringify(message),
                },
            ],
        });
    } finally {
        await producer.disconnect();
    }
}

/**
 * Builds a producer configuration from environment variables.
 * Reads KAFKA_BROKERS, KAFKA_CLIENT_ID, KAFKA_TOPIC, MESSAGE, KEY.
 * @returns {{brokers: string|string[], clientId: string, topic: string, message: string, key: (string|undefined)}}
 */
export function configFromEnv() {
    return {
        brokers: process.env.KAFKA_BROKERS || 'localhost:9092',
        clientId: process.env.KAFKA_CLIENT_ID || 'kafka-nodejs-demo',
        topic: process.env.KAFKA_TOPIC || 'demo-topic',
        message: process.env.MESSAGE || 'hello from producer',
        key: process.env.KEY,
    };
}

/**
 * CLI entrypoint to produce a single message using environment configuration.
 * Sets process.exitCode to 0 on success and 1 on error. Accepts dependency injection for tests.
 * @param {{ produceMessage: typeof produceMessage }} [deps] Optional dependency overrides.
 * @returns {Promise<void>}
 */
export async function main(deps = { produceMessage }) {
    const cfg = configFromEnv();
    try {
        await deps.produceMessage(cfg);
        console.log(`Produced message to ${cfg.topic}`);
        process.exitCode = 0;
    } catch (err) {
        console.error('Producer error:', err);
        process.exitCode = 1;
    }
}

// Run as CLI if executed directly
/**
 * Detects whether this module is being executed directly (not imported) in Node.js.
 * Useful to guard the CLI entrypoint for ESM modules.
 * @returns {boolean} True if run via `node src/producer.js`, false if imported.
 */
export const isDirectRun = () => {
    try {
        return import.meta.url === pathToFileURL(process.argv[1]).href;
    } catch {
        return false;
    }
};

if (isDirectRun()) {
    // no top-level await to keep Node versions happy
    main();
}
