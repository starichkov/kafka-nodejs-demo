/**
 * Shared utilities for Kafka modules.
 *
 * Exports:
 * - parseBrokers: normalizes brokers (string or array) to an array of host:port strings.
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
