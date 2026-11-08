# Lesson 6: Producer acknowledgments, retries, and idempotence

This lesson separates three producer settings that are often described together but solve different problems:

- `PRODUCER_ACKS` controls how much broker acknowledgment Kafka waits for before a send succeeds.
- `PRODUCER_RETRIES` controls how many times KafkaJS retries retryable network or protocol failures.
- `PRODUCER_IDEMPOTENT` enables Kafka's producer identity and sequence handling to reduce duplicates caused by retrying a send.

These settings improve delivery behavior, but they do not prove that a business operation happened exactly once. A successful send means the broker accepted the record according to the selected acknowledgment level; it does not mean a consumer processed it.

## 1. Start Kafka and create the demo topic

Run these commands on the host:

```shell
docker compose up -d kafka
docker compose run --rm kafka-setup
```

## 2. Start a consumer

In terminal 1:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
KAFKA_GROUP_ID=lesson-06-consumer \
FROM_BEGINNING=true \
npm run start:consumer
```

## 3. Compare acknowledgment levels

In terminal 2, send a record using the default `acks=-1` (all in-sync replicas; this single-broker demo has one replica):

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
PRODUCER_ACKS=-1 \
MESSAGE="acks all in-sync replicas" \
npm run start:producer
```

Try `PRODUCER_ACKS=1` to wait for the leader only, or `PRODUCER_ACKS=0` to request no broker acknowledgment. The command can still exit successfully at `acks=0` before Kafka confirms the record, so this setting is a trade-off rather than a stronger guarantee.

## 4. Configure producer retries

KafkaJS retries retryable connection and protocol failures, not application-level consumer failures. Set the retry limit explicitly:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
PRODUCER_ACKS=-1 \
PRODUCER_RETRIES=8 \
MESSAGE="retry-configured record" \
npm run start:producer
```

The normal healthy-broker flow does not visibly consume retries. To study retry behavior, use controlled broker interruption or a separate disposable environment; do not infer retry behavior from duplicate-free sends on a healthy broker.

## 5. Enable idempotent publishing

Idempotence requires `acks=-1` in this demo:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
PRODUCER_ACKS=-1 \
PRODUCER_RETRIES=8 \
PRODUCER_IDEMPOTENT=true \
MESSAGE="idempotent record" \
npm run start:producer
```

Kafka uses producer identity and sequence numbers to identify duplicate retry attempts from the same producer session. This is not the same as a transaction, an application-level deduplication key, or an end-to-end exactly-once workflow. Producer restarts, consumer side effects, external databases, and transaction boundaries still require separate design.

## What this demo proves—and does not prove

The producer tests verify configuration and successful delivery to a real broker, including an idempotent send. They do not simulate broker failure, measure record loss under failure, or prove that a consumer's business side effect occurs once. Lesson 5 covers a separate consumer-side retry and dead-letter policy.

## Cleanup

```shell
docker compose down -v
```