/**
 * Kafka topic administration utility and CLI for KafkaJS.
 * Supports read-only inspection by default and requires explicit confirmation for deletion.
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
 * Lists the topics known to the Kafka cluster.
 * @param {{brokers: string|string[], clientId?: string}} params Admin configuration.
 * @returns {Promise<string[]>} Topic names.
 */
export async function listTopics({ brokers, clientId = 'kafka-nodejs-topic-admin' }) {
    if (!brokers || (Array.isArray(brokers) && brokers.length === 0)) throw new Error('brokers is required');

    const kafka = new Kafka({ clientId, brokers: parseBrokers(brokers), logLevel: logLevel.NOTHING });
    const admin = kafka.admin();
    await waitForKafkaConnectivity(kafka);
    await admin.connect();
    try {
        return await admin.listTopics();
    } finally {
        await admin.disconnect();
    }
}

/**
 * Fetches partition and replica metadata for a topic.
 * @param {{brokers: string|string[], topic: string, clientId?: string}} params Admin configuration.
 * @returns {Promise<object>} KafkaJS topic metadata.
 */
export async function inspectTopicMetadata({ brokers, topic, clientId = 'kafka-nodejs-topic-admin' }) {
    if (!brokers || (Array.isArray(brokers) && brokers.length === 0)) throw new Error('brokers is required');
    if (!topic) throw new Error('topic is required');

    const kafka = new Kafka({ clientId, brokers: parseBrokers(brokers), logLevel: logLevel.NOTHING });
    const admin = kafka.admin();
    await waitForKafkaConnectivity(kafka);
    await admin.connect();
    try {
        const { topics } = await admin.fetchTopicMetadata({ topics: [topic] });
        return topics[0];
    } finally {
        await admin.disconnect();
    }
}

/**
 * Deletes a topic after an explicit confirmation is supplied.
 * @param {{brokers: string|string[], topic: string, clientId?: string, confirmed?: boolean}} params Admin configuration.
 * @returns {Promise<void>} Resolves when Kafka accepts the deletion request.
 */
export async function deleteTopic({ brokers, topic, clientId = 'kafka-nodejs-topic-admin', confirmed = false }) {
    if (!brokers || (Array.isArray(brokers) && brokers.length === 0)) throw new Error('brokers is required');
    if (!topic) throw new Error('topic is required');
    if (!confirmed) throw new Error('topic deletion requires explicit confirmation');

    const kafka = new Kafka({ clientId, brokers: parseBrokers(brokers), logLevel: logLevel.NOTHING });
    const admin = kafka.admin();
    await waitForKafkaConnectivity(kafka);
    await admin.connect();
    try {
        return await admin.deleteTopics({ topics: [topic] });
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
        action: process.env.KAFKA_ADMIN_ACTION || 'inspect',
        confirmed: process.env.KAFKA_DELETE_CONFIRMED === 'true',
    };
}

/**
 * Runs the topic inspection CLI and prints one line per partition.
 * @param {{inspectTopic?: typeof inspectTopic, listTopics?: typeof listTopics, inspectTopicMetadata?: typeof inspectTopicMetadata, deleteTopic?: typeof deleteTopic}} [deps] Optional dependency overrides.
 * @returns {Promise<void>} Resolves after the selected admin output is written.
 */
export async function main(deps = { inspectTopic, listTopics, inspectTopicMetadata, deleteTopic }) {
    try {
        const config = configFromEnv();
        if (config.action === 'list') {
            const topics = await deps.listTopics({ brokers: config.brokers, clientId: config.clientId });
            for (const topic of topics) logger.info(`Topic name=${topic}`);
        } else if (config.action === 'metadata') {
            const metadata = await deps.inspectTopicMetadata({
                brokers: config.brokers,
                topic: config.topic,
                clientId: config.clientId,
            });
            logger.info(`Topic name=${metadata.name} partitions=${metadata.partitions.length}`);
            for (const partition of metadata.partitions) {
                logger.info(
                    `Topic partition=${partition.partitionId} leader=${partition.leader} replicas=${partition.replicas.join(',')} isr=${partition.isr.join(',')}`,
                );
            }
        } else if (config.action === 'delete') {
            await deps.deleteTopic({
                brokers: config.brokers,
                topic: config.topic,
                clientId: config.clientId,
                confirmed: config.confirmed,
            });
            logger.info(`Deleted topic=${config.topic}`);
        } else if (config.action === 'inspect') {
            const offsets = await deps.inspectTopic({
                brokers: config.brokers,
                topic: config.topic,
                clientId: config.clientId,
            });
            for (const { partition, low, high } of offsets) {
                logger.info(`Topic partition=${partition} beginningOffset=${low} endOffset=${high}`);
            }
        } else {
            throw new Error(`unsupported admin action: ${config.action}`);
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
