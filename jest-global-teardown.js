/**
 * Jest global teardown for Kafka integration tests.
 * Stops the Kafka Testcontainers container started during global setup.
 * Reads the container reference from globalThis.__kafka_container__ set in setup.
 */

/**
 * Jest globalTeardown entry point. Stops the Kafka container if present.
 * @returns {Promise<void>} Resolves when the container is stopped or if none is present.
 */
export default async () => {
    // Container instance is available on the same process that ran globalSetup
    const container = globalThis.__kafka_container__?.container;
    if (container) {
        await container.stop();
    }
};
