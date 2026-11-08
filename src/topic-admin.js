/**
 * Kafka topic inspection utility and CLI for KafkaJS.
 * Reports each partition's beginning and end offsets without changing topic state.
 */
import pkg from 'kafkajs';
import { pathToFileURL } from 'url';

const { Kafka, logLevel } = pkg;
import { parseBrokers, waitForKafkaConnectivity } from './utils.js';
import logger from './logger.js';

/**
 * Fetches beginning and end offsets for every partition in a topic.
 * @param {{brokers: string|string[], topic: string, clientId?: string}} params Inspection configuration.
 * @returns {Promise<Array<{partition: number, low: string, high: string, offset: string}>>} Partition offsets.
 */
export async function inspectTopic({ brokers, topic, clientId = 'kafka-nodejs-topic-admin' }) {
    if (!brokers || (Array.isArray(brokers) && brokers.length === 0)) throw new Error('brokers is required');
    if (!topic) throw new Error('topic is required');

    const kafka = new Kafka({ clientId, brokers: parseBrokers(brokers), logLevel: logLevel.NOTHING });
    const admin = kafka.admin();
    await waitForKafkaConnectivity(kafka);
    await admin.connect();
    try {
        return await admin.fetchTopicOffsets(topic);
    } finally {
        await admin.disconnect();
    }
}

/**
 * Builds topic inspection configuration from environment variables.
 * @returns {{brokers: string|string[], topic: string, clientId: string}} Inspection configuration.
 */
export function configFromEnv() {
    return {
        brokers: process.env.KAFKA_BROKERS || 'localhost:9092',
        topic: process.env.KAFKA_TOPIC || 'demo-topic',
        clientId: process.env.KAFKA_CLIENT_ID || 'kafka-nodejs-topic-admin',
    };
}

/**
 * Runs the topic inspection CLI and prints one line per partition.
 * @param {{inspectTopic: typeof inspectTopic}} [deps] Optional dependency overrides.
 * @returns {Promise<void>} Resolves after inspection output is written.
 */
export async function main(deps = { inspectTopic }) {
    try {
        const offsets = await deps.inspectTopic(configFromEnv());
        for (const { partition, low, high } of offsets) {
            logger.info(`Topic partition=${partition} beginningOffset=${low} endOffset=${high}`);
        }
        process.exitCode = 0;
    } catch (err) {
        logger.error('Topic inspection error:', err);
        process.exitCode = 1;
    }
}

/**
 * Detects whether this module is being executed directly.
 * @returns {boolean} True when run as the topic-admin CLI.
 */
export const isDirectRun = () => {
    try {
        return import.meta.url === pathToFileURL(process.argv[1]).href;
    } catch {
        return false;
    }
};

if (isDirectRun()) main();
