/**
 * Test helpers for KafkaJS used across the test suite.
 * Provides utilities to create a Kafka client, generate unique IDs, and ensure a topic exists.
 * Note: Brokers are read from globalThis.__kafka_brokers__ which is set in Jest global setup.
 */
import {Kafka} from "kafkajs";

/**
 * Creates a KafkaJS client configured with brokers from the test environment.
 * @returns {Kafka} KafkaJS client instance configured with the discovered brokers.
 */
export function kafkaClient() {
    const brokersString = process.env.KAFKA_BROKERS_DYNAMIC;
    const brokers = brokersString ? brokersString.split(',') : globalThis.__kafka_brokers__?.brokers;
    
    if (!brokers) {
        throw new Error("Kafka brokers not initialized in global setup. Ensure globalSetup is running and sharing data correctly.");
    }
    
    return new Kafka({brokers});
}

/**
 * Generates a reasonably unique identifier string, useful for Kafka resource names in tests.
 * Format: `${prefix}-${timestamp}-${randomHex}`
 * @param {string} [prefix="t"] Prefix to prepend to the generated ID.
 * @returns {string} A unique identifier string.
 */
export function uniqueId(prefix = "t") {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Ensures that the specified Kafka topic exists. If it does not, the topic is created
 * with a single partition and a replication factor of 1. Connects to an admin client,
 * checks for the topic, creates it if needed, and disconnects.
 * @param {Kafka} kafka KafkaJS client instance.
 * @param {string} topic The topic name to ensure exists.
 * @returns {Promise<void>} Resolves when the topic exists (either previously or after creation).
 */
export async function ensureTopic(kafka, topic) {
    const admin = kafka.admin();
    await admin.connect();
    const topics = await admin.listTopics();
    if (!topics.includes(topic)) {
        await admin.createTopics({topics: [{topic, numPartitions: 1, replicationFactor: 1}]});
    }
    await admin.disconnect();
}
