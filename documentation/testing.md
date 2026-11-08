# Test story

This project uses several test layers because Kafka behavior cannot be validated by assertions about JavaScript functions alone. The fast tests explain and protect application decisions; the real-broker tests prove Kafka delivery and metadata; the Docker smoke test proves that the packaged system can start and communicate.

## Run the checks

Run the complete local validation with:

```shell
npm test
npm run test:coverage
npm run test:docker
npm run lint
npm run format:check
git diff --check
```

`npm test` and `npm run test:coverage` use the same Jest suites. Coverage additionally writes the report to `coverage/`. The integration suites start Kafka with Testcontainers, so Docker is required for the Jest run as well as for `npm run test:docker`.

## What each test layer teaches

### Utility and configuration tests

- `tests/utils.test.js` checks pure broker-readiness, retry, normalization, and timeout behavior without requiring message delivery.
- `tests/config.test.js` calls the exported `configFromEnv` functions directly. It demonstrates how environment variables become typed producer, consumer, and topic-inspection options.
- `tests/logger.test.js` checks the small structured-logging wrapper independently from Kafka.

These tests are fast and deterministic. They are the right place for validation rules, defaults, malformed input, and error messages.

### CLI and mocked consumer tests

- `tests/cli.test.js` exercises direct-run entry points, dependency injection, configuration failures, and process exit behavior.
- `tests/consumer.unit.test.js` isolates consumer lifecycle, bounded retries, backoff, failure matching, dead-letter publishing, and cleanup with mocked KafkaJS clients.

Mocking is intentional here: it makes rare branches such as a failed dead-letter disconnect or a retry limit easy to reproduce without depending on broker timing.

### Real Kafka integration tests

- `tests/producer.test.js` verifies that records reach Kafka and that returned topic, partition, offset, key, headers, and timestamp metadata are usable.
- `tests/consumer.test.js` verifies consumer delivery, consumer groups, partition sharing, retries, and dead-letter behavior against a real broker.
- `tests/topic-admin.test.js` verifies topic listing, partition metadata, beginning/end offset inspection, safe deletion, and topic-admin validation against Kafka.
- `tests/kafka-helpers.js` provides disposable topics and groups so tests do not depend on retained data from another run.

These tests teach the boundary between application code and Kafka. They are slower and require Docker, but they catch incorrect topic names, broker protocol assumptions, partition assignment, offset behavior, and metadata handling that mocks cannot catch.

### Docker Compose smoke test

`test-docker-compose.sh`, run by `npm run test:docker`, validates the packaged flow:

1. Build the producer and consumer images.
2. Start Kafka and wait for broker readiness.
3. Create `demo-topic` with the configured partition count.
4. Start the producer and consumer on the Docker network.
5. Confirm the consumer receives the expected message.
6. Print useful status/log information and remove the disposable containers and volumes.

This is deliberately an end-to-end check. It covers image contents, Docker DNS (`kafka:9092`), startup ordering, topic setup, and the internal advertised listener—not just Node.js behavior.

## How to read failures

Use the smallest failing layer first:

| Failure                                    | First place to look                                           | What it usually means                                        |
| ------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------ |
| Validation or default mismatch             | Utility/configuration tests                                   | An option parser or default changed unexpectedly             |
| Retry, DLQ, or shutdown branch             | `consumer.unit.test.js`                                       | Application lifecycle behavior changed                       |
| Partition, offset, or metadata mismatch    | Real Kafka integration tests                                  | The broker-visible behavior is different from the assumption |
| Image, DNS, readiness, or delivery failure | `npm run test:docker`                                         | Compose configuration or container startup is broken         |
| Style or whitespace failure                | `npm run lint`, `npm run format:check`, or `git diff --check` | The change does not match repository formatting rules        |

The test layers complement each other. A passing unit suite does not prove that a Docker image can resolve Kafka, and a passing Compose smoke test does not cover every validation or retry branch.

## Educational progression

The tests follow the lessons:

1. configuration and one-record delivery;
2. consumer groups, offsets, and replay;
3. partitions, keys, ordering, and parallel consumers;
4. headers, timestamps, and offset inspection;
5. failures, retries, and dead-letter topics;
6. producer acknowledgments, retries, and idempotence.

When extending the demo, add a focused unit test for the new application rule and a real-broker test when the behavior depends on Kafka metadata, assignment, offsets, or delivery. Keep the default Docker smoke flow small and deterministic so it remains a useful first health check.
