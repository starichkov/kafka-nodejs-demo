/**
 * Kafka producer utilities and CLI for KafkaJS.
 * Provides helpers to normalize broker addresses, produce one or more messages,
 * environment-driven configuration, and a CLI entrypoint when executed directly.
 *
 * Exports:
 * - parseBrokers: normalizes brokers (string or array) to an array of host:port strings.
 * - produceMessage: connects, sends one or more messages to a topic, and disconnects.
 * - configFromEnv: builds configuration from environment variables for convenience/CLI.
 * - main: CLI entrypoint used when running this file directly.
 * - isDirectRun: detects whether the module is executed directly (node src/producer.js).
 */
import pkg from 'kafkajs';
import { pathToFileURL } from 'url';

const { Kafka, logLevel, Partitioners } = pkg;

// Re-exported from shared utils to avoid duplication across modules
import { parseBrokers, waitForKafkaConnectivity } from './utils.js';
export { parseBrokers };

// Centralized logger
import logger from './logger.js';

/**
 * Produces one or more messages to a Kafka topic.
 * Validates input, creates a producer, connects, sends, and disconnects.
 *
 * @param {Object} params Producer configuration.
 * @param {string|string[]} params.brokers Kafka broker(s), e.g., "localhost:9092" or ["host:port"].
 * @param {string} [params.clientId="kafka-nodejs-demo"] Kafka client ID used by KafkaJS.
 * @param {string} [params.topic="demo-topic"] Topic to which the message will be produced.
 * @param {unknown} params.message The message payload. Strings/Buffers are used as-is; other types are JSON.stringified.
 * @param {string|number|null} [params.key] Optional key associated with the message (will be stringified; null if undefined).
 * @param {number} [params.messageCount=1] Number of records to send. Values are suffixed with `-1`, `-2`, etc. when greater than one.
 * @param {number} [params.partition] Optional partition to which every record is sent.
 * @param {Record<string, string|string[]|Buffer|Buffer[]>} [params.headers] Optional record headers.
 * @param {string|number} [params.timestamp] Optional Kafka record timestamp in milliseconds.
 * @throws {Error} If brokers, topic, or message are not provided.
 * @returns {Promise<import('kafkajs').RecordMetadata[]>} Kafka metadata for the sent record(s).
 */
export async function produceMessage({
    brokers,
    clientId = 'kafka-nodejs-demo',
    topic = 'demo-topic',
    message,
    key,
    messageCount = 1,
    partition,
    headers,
    timestamp,
}) {
    if (!brokers || (Array.isArray(brokers) && brokers.length === 0)) {
        throw new Error('brokers is required');
    }
    if (!topic) throw new Error('topic is required');
    if (typeof message === 'undefined' || message === null) throw new Error('message is required');
    if (!Number.isInteger(messageCount) || messageCount < 1) {
        throw new Error('messageCount must be a positive integer');
    }
    if (typeof partition !== 'undefined' && (!Number.isInteger(partition) || partition < 0)) {
        throw new Error('partition must be a non-negative integer');
    }

    const kafka = new Kafka({ clientId, brokers: parseBrokers(brokers), logLevel: logLevel.NOTHING });
    const producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });

    // Perform a readiness check via Kafka admin instead of relying on timing
    logger.info('Checking Kafka readiness (producer admin metadata)...');
    await waitForKafkaConnectivity(kafka);

    await producer.connect();
    try {
        const metadata = [];
        for (const record of buildMessages({ message, key, messageCount, partition, headers, timestamp })) {
            const result = await producer.send({ topic, messages: [record] });
            metadata.push(...result);
        }
        return metadata;
    } finally {
        await producer.disconnect();
    }
}

/**
 * Builds the KafkaJS records for a producer request.
 * The default single-record shape remains unchanged; batch records use a deterministic suffix so their order is visible.
 * @param {{message: unknown, key?: string|number|null, messageCount?: number, partition?: number, headers?: Record<string, string|string[]|Buffer|Buffer[]>, timestamp?: string|number}} params Record options.
 * @returns {Array<{key: string|null, value: string|Buffer, partition?: number, headers?: Record<string, string|string[]|Buffer|Buffer[]>, timestamp?: string|number}>} KafkaJS-compatible records.
 */
export function buildMessages({ message, key, messageCount = 1, partition, headers, timestamp }) {
    if (!Number.isInteger(messageCount) || messageCount < 1) {
        throw new Error('messageCount must be a positive integer');
    }

    return Array.from({ length: messageCount }, (_, index) => {
        const value = messageCount === 1 ? message : `${message}-${index + 1}`;
        const record = {
            key: typeof key === 'undefined' ? null : String(key),
            value: typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value),
        };
        if (typeof partition !== 'undefined') record.partition = partition;
        if (typeof headers !== 'undefined') record.headers = headers;
        if (typeof timestamp !== 'undefined') record.timestamp = String(timestamp);
        return record;
    });
}

/**
 * Builds a producer configuration from environment variables.
 * Reads KAFKA_BROKERS, KAFKA_CLIENT_ID, KAFKA_TOPIC, MESSAGE, KEY, MESSAGE_COUNT, PARTITION,
 * MESSAGE_HEADERS, and MESSAGE_TIMESTAMP.
 * @returns {{brokers: string|string[], clientId: string, topic: string, message: string, key: (string|undefined), messageCount: number, partition: (number|undefined), headers: (Record<string, string|string[]>|undefined), timestamp: (string|undefined)}}
 */
export function configFromEnv() {
    return {
        brokers: process.env.KAFKA_BROKERS || 'localhost:9092',
        clientId: process.env.KAFKA_CLIENT_ID || 'kafka-nodejs-demo',
        topic: process.env.KAFKA_TOPIC || 'demo-topic',
        message: process.env.MESSAGE || 'hello from producer',
        key: process.env.KEY,
        messageCount: process.env.MESSAGE_COUNT ? Number(process.env.MESSAGE_COUNT) : 1,
        partition: process.env.PARTITION ? Number(process.env.PARTITION) : undefined,
        headers: process.env.MESSAGE_HEADERS ? JSON.parse(process.env.MESSAGE_HEADERS) : undefined,
        timestamp: process.env.MESSAGE_TIMESTAMP,
    };
}

/**
 * CLI entrypoint to produce one or more messages using environment configuration.
 * Sets process.exitCode to 0 on success and 1 on error. Accepts dependency injection for tests.
 * @param {{ produceMessage: typeof produceMessage }} [deps] Optional dependency overrides.
 * @returns {Promise<void>}
 */
export async function main(deps = { produceMessage }) {
    const cfg = configFromEnv();
    try {
        const metadata = await deps.produceMessage(cfg);
        if (metadata?.length) {
            for (const record of metadata) {
                logger.info(
                    `Produced message topic=${record.topicName} partition=${record.partition} offset=${record.baseOffset}`,
                );
            }
        } else {
            logger.info(`Produced message to ${cfg.topic}`);
        }
        process.exitCode = 0;
    } catch (err) {
        logger.error('Producer error:', err);
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
