# Lesson 5: Failures, retries, and dead-letter topics

This lesson makes failure handling visible without changing the default consumer behavior. A selected record fails intentionally, the consumer retries it a bounded number of times, and a permanently failing record is sent to a separate dead-letter topic with its original Kafka metadata.

## What this demonstrates

- A Kafka handler failure is not the same as a broker connection retry.
- `MAX_RETRIES` and `RETRY_BACKOFF_MS` are application-level behavior in this demo.
- Without `DEAD_LETTER_TOPIC`, the final error is rethrown to KafkaJS and the record is not acknowledged by this handler.
- With a dead-letter topic, the failed record is published there and the source handler completes, allowing KafkaJS to commit the source offset.
- The dead-letter record includes `original-topic`, `original-partition`, `original-offset`, `retry-count`, and `error` headers.

This is an educational example, not a complete production retry or DLQ design. A production system also needs an explicit policy for duplicate publishing, DLQ producer failures, retention, alerting, access control, and replay.

## 1. Start Kafka and create two topics

Run these commands on the host:

```shell
docker compose up -d kafka
docker compose run --rm kafka-setup
```

Create a disposable source and dead-letter topic using the Kafka image:

```shell
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh \
  --create --if-not-exists --topic lesson-05-source \
  --bootstrap-server localhost:9092 --partitions 1 --replication-factor 1
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh \
  --create --if-not-exists --topic lesson-05-dlq \
  --bootstrap-server localhost:9092 --partitions 1 --replication-factor 1
```

## 2. Start the dead-letter observer

In terminal 1, start a consumer for the DLQ:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=lesson-05-dlq \
KAFKA_GROUP_ID=lesson-05-dlq-observer \
FROM_BEGINNING=true \
npm run start:consumer
```

## 3. Start the failing source consumer

In terminal 2, configure the consumer to fail records with a selected value, retry twice, and route the exhausted record:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=lesson-05-source \
KAFKA_GROUP_ID=lesson-05-source-group \
FAIL_ON_VALUE=permanent-failure \
MAX_RETRIES=2 \
RETRY_BACKOFF_MS=250 \
DEAD_LETTER_TOPIC=lesson-05-dlq \
npm run start:consumer
```

The source consumer logs two retry messages, followed by a dead-letter message containing the source topic, partition, offset, and error. The DLQ observer prints the original value and the added headers.

## 4. Produce a failing record

In terminal 3:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=lesson-05-source \
KEY=lesson-05-key \
MESSAGE=permanent-failure \
npm run start:producer
```

The producer's successful send only means Kafka accepted the source record. The consumer's retry and DLQ logs demonstrate the separate application processing outcome.

## 5. Compare the no-DLQ behavior

Stop the source consumer, then start it again without `DEAD_LETTER_TOPIC`:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=lesson-05-source \
KAFKA_GROUP_ID=lesson-05-no-dlq-group \
FAIL_ON_VALUE=permanent-failure \
MAX_RETRIES=2 \
RETRY_BACKOFF_MS=250 \
npm run start:consumer
```

The final failure is rethrown. No DLQ record is produced, and the group does not get the successful-handler acknowledgment that the DLQ path provides. This illustrates why retry, offset, and recovery policies must be designed together.

## Cleanup

Remove the disposable broker and its data when finished:

```shell
docker compose down -v
```