/**
 * Shared utilities for Kafka modules.
 *
 * Exports:
 * - parseBrokers: normalizes brokers (string or array) to an array of host:port strings.
 * - waitForKafkaConnectivity: waits for admin.describeCluster to succeed.
 */

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
 * Waits for Kafka connectivity by using the admin client to poll describeCluster
 * until it succeeds or the timeout elapses. Safe to call in test environments
 * where kafka.admin may be unavailable (no-op in that case).
 *
 * @param {import('kafkajs').Kafka} kafka KafkaJS client instance
 * @param {number} [timeoutMs=10000] Maximum time to wait in milliseconds
 * @returns {Promise<void>} Resolves when connectivity is confirmed
 */
export async function waitForKafkaConnectivity(kafka, timeoutMs = 10000) {
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
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  } finally {
    try { await admin.disconnect(); } catch {}
  }
}
