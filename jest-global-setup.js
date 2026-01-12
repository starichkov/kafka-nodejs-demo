/**
 * Jest global setup for Kafka integration tests.
 * - Starts a Kafka Testcontainers container (image configurable via KAFKA_IMAGE)
 * - Waits until Kafka is responsive using a KafkaJS admin client
 * - Exposes the container and brokers on globalThis for tests and teardown
 */
import {KafkaContainer} from "@testcontainers/kafka";
import {Wait} from "testcontainers";
import {Kafka} from "kafkajs";

/**
 * Polls Kafka until it is ready by using a KafkaJS admin client and metadata calls.
 * @param {string[]} brokers Array of broker addresses in host:port format.
 * @param {number} [timeoutMs=30000] Maximum time to wait before rejecting.
 * @returns {Promise<void>} Resolves when Kafka responds to admin operations.
 */
async function waitForKafka(brokers, timeoutMs = 30000) {
    const start = Date.now();
    const kafka = new Kafka({brokers});
    const admin = kafka.admin();
    while (true) {
        try {
            await admin.connect();
            // both calls touch controller & metadata paths
            await admin.describeCluster();
            await admin.listTopics();
            await admin.disconnect();
            return;
        } catch {
            try {
                await admin.disconnect();
            } catch {
            }
            if (Date.now() - start > timeoutMs) throw new Error("Kafka not ready in time");
            await new Promise(r => setTimeout(r, 250));
        }
    }
}

/**
 * Jest globalSetup entry point.
 * Starts the Kafka Testcontainers container, waits for readiness, and stores references on globalThis.
 * Environment:
 * - KAFKA_IMAGE: Optional Docker image tag to use for the Kafka container.
 * Side effects:
 * - Sets globalThis.__kafka_container__ and globalThis.__kafka_brokers__ for use by tests and teardown.
 * @returns {Promise<void>}
 */
export default async () => {
    const image = process.env.KAFKA_IMAGE || "confluentinc/cp-kafka:7.9.5";
    console.log(`[jest-global-setup] Starting Kafka container with image: ${image}`);
    const container = await new KafkaContainer(image)
        .withStartupTimeout(30000)
        .withWaitStrategy(Wait.forLogMessage(/(Kafka Server started|\[KafkaServer id=\d+\] started)/))
        .start();

    const host = container.getHost();
    const port = container.getMappedPort(9093);
    const brokers = [`${host}:${port}`];
    console.log(`[jest-global-setup] Kafka container started. Brokers: ${brokers}`);

    // ✅ wait for controller and group coordinator to be reachable
    await waitForKafka(brokers);
    console.log(`[jest-global-setup] Kafka is ready for connections.`);

    // Stash paths on global to read them in teardown (same process)
    globalThis.__kafka_container__ = {container};
    globalThis.__kafka_brokers__ = {brokers};
    
    // Also set environment variable for tests that might run in separate processes
    process.env.KAFKA_BROKERS_DYNAMIC = brokers.join(',');
};
