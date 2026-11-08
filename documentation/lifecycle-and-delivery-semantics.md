# Lifecycle and delivery semantics

This demo intentionally separates the lifecycle of a Kafka record from the
lifecycle of the application that handles it. A producer can finish after
Kafka accepts a record, while a consumer may still be processing that record
or may process it again after a failure.

## Record lifecycle

The basic path has these distinct stages:

1. `src/producer.js` connects to Kafka and sends a record to a topic.
2. Kafka assigns or confirms the record's partition and offset.
3. The producer logs the returned metadata and disconnects in a `finally`
   block, including when sending fails.
4. A consumer group fetches the record and invokes the application handler.
5. KafkaJS commits consumer progress according to its consumer-run behavior.
6. The consumer can stop its run loop, wait for that loop to finish, and then
   disconnect cleanly.

The producer's successful `send` result confirms broker acceptance at the
configured `PRODUCER_ACKS` level. It does **not** confirm that a consumer saw
the record, completed its business work, or committed a corresponding offset.

## Producer lifecycle

The producer uses a short-lived connection: connect, send one or more records,
log each record's topic/partition/offset metadata, and disconnect. The
`try/finally` cleanup is important because a failed send must not leave the
producer's network connection open.

The delivery point depends on the producer settings:

| Setting                    | Meaning in this demo                                                                            | What it does not prove                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `PRODUCER_ACKS=0`          | The producer does not wait for a broker acknowledgment.                                         | That Kafka stored the record.                                                        |
| `PRODUCER_ACKS=1`          | The partition leader acknowledges the record.                                                   | That replicas or a consumer have completed the work.                                 |
| `PRODUCER_ACKS=-1`         | All in-sync replicas acknowledge the record. The demo has one broker and one replica.           | Fault tolerance beyond this single-broker setup or exactly-once business processing. |
| `PRODUCER_RETRIES`         | KafkaJS retries retryable network/protocol requests.                                            | That an uncertain request was not applied before a retry.                            |
| `PRODUCER_IDEMPOTENT=true` | Kafka producer sequencing helps suppress duplicate retry writes from the same producer session. | An end-to-end transaction or deduplication of consumer side effects.                 |

See [Lesson 6](lesson-06-acknowledgments-retries-and-idempotence.md) for
commands that compare these settings. A healthy broker does not provide a
useful retry experiment; broker interruption is required to observe failure
behavior.

## Consumer lifecycle and shutdown

`src/consumer.js` treats shutdown as a coordinated operation:

- `SIGINT` and `SIGTERM` are converted into an `AbortSignal`.
- The signal stops the application loop instead of abruptly terminating the
  process.
- The returned `stop` function requests KafkaJS to stop fetching records.
- The returned `runPromise` is awaited before disconnecting, so in-flight
  KafkaJS shutdown work does not continue after the test or CLI has finished.
- Disconnect then closes the Kafka client connection.

This order matters. Disconnecting first can cause KafkaJS to report a closed
connection while its consumer loop is still running, and asynchronous logs may
appear after a test has completed. Stopping and awaiting the run loop makes the
boundary explicit without hiding consumer errors.

The readiness helper checks broker metadata and retries until Kafka is
reachable. It is more reliable than sleeping for a fixed startup duration,
because container startup time varies and a running process is not necessarily
ready to serve client metadata.

## Offsets, redelivery, and application retries

Kafka retains records independently of consumer progress. A consumer group
tracks a committed offset for each partition; reading a record does not delete
it. If processing fails before progress is committed, Kafka can deliver the
record again. This is the basis of the common **at-least-once** processing
model.

The consumer's `MAX_RETRIES` and `RETRY_BACKOFF_MS` are application-level
handling rules. They are different from KafkaJS retrying a network request:

- KafkaJS retries communication with Kafka.
- Application retries invoke the handler again for the same record.
- After the configured attempts, `DEAD_LETTER_TOPIC` can receive the failed
  record and failure metadata.
- A successful dead-letter publish is still not the same as completing the
  original business operation.

The dead-letter topic is an application convention. Kafka does not know that a
topic is a DLQ, and operating a durable DLQ requires retention, monitoring,
reprocessing, and ownership policies that are outside this demo.

## What this demo does not guarantee

This repository is an educational single-broker example. It does not provide:

- end-to-end exactly-once processing;
- Kafka transactions between publishing and consuming;
- atomic updates across Kafka and an external database or API;
- protection from duplicate business side effects;
- production fault tolerance from the one-broker, replication-factor-one
  Compose setup;
- schema registration, compatibility checks, or payload validation;
- a universal offset-reset or manual-commit policy;
- production retention, replication, monitoring, alerting, or DLQ operations.

To design a stronger workflow, define the business side effect, its
deduplication key, the commit boundary, failure recovery, and ownership of
retries and dead-letter records. Do not infer those guarantees from a producer
log line or from a message appearing once in a terminal.

## Experiments

1. Run [Lesson 1](lesson-01-basics.md) and compare the producer's delivery
   metadata with the consumer's record metadata.
2. Use [Lesson 2](lesson-02-groups-and-offsets.md) to restart a group and
   observe committed offsets versus replay with a new group.
3. Use [Lesson 5](lesson-05-failures-retries-and-dead-letters.md) to observe
   bounded application retries and dead-letter routing.
4. Use [Lesson 6](lesson-06-acknowledgments-retries-and-idempotence.md) to
   compare broker acknowledgment and producer retry settings.

Clean up the disposable broker and its data when the experiments are complete:

```shell
docker compose down -v
```
