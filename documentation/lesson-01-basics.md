# Lesson 1: Follow one Kafka record

This lesson follows one record from a host-run producer to a consumer. It keeps the default example small, but makes Kafka's topic, partition, offset, key, and timestamp visible.

## What you will learn

- A producer sends a record to a topic.
- Kafka assigns the record to a partition and gives it an offset.
- A consumer reads the record as part of a consumer group.
- The record's offset is Kafka's position for that partition; it is not a global message number.
- A key is optional. When present, Kafka uses it when choosing a partition.

## Start the broker

Run these commands from the project root on the host:

```shell
docker compose up -d kafka
docker compose run --rm kafka-setup
```

The setup service creates `demo-topic` with one partition. Containers address the broker as `kafka:9092`; applications running on the host use `localhost:9092` because the Compose configuration advertises both addresses.

## Start the consumer

In terminal 1, start a consumer with a named group:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
KAFKA_GROUP_ID=lesson-01-group \
FROM_BEGINNING=true \
npm run start:consumer
```

The consumer waits for records and prints metadata similar to:

```text
Consumed message group=lesson-01-group topic=demo-topic partition=0 offset=0 timestamp=... key=null value=Hello from producer
```

The exact offset and timestamp depend on the broker's existing data and the time of production. `partition=0` is expected here because the topic has one partition.

## Produce one record

In terminal 2, send a keyed record:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
MESSAGE="Hello from lesson 1" \
KEY=lesson-01 \
npm run start:producer
```

The producer prints metadata returned by Kafka:

```text
Produced message topic=demo-topic partition=0 offset=1
```

The offset in the producer output identifies the record Kafka appended. The consumer should print the same topic, partition, and offset, along with the decoded key and value. The offset may not be `1` if the topic already contains records.

## Compare the two sides

1. Match the producer's `topic`, `partition`, and `offset` with the consumer's values.
2. Compare the producer's `KEY` with the consumer's `key`.
3. Notice that the producer knows Kafka accepted the record, while the consumer proves that a consumer group read it.
4. Stop the consumer with Ctrl+C, then clean up the disposable broker and its data:

```shell
docker compose down -v
```

## Optional experiment: no key

Repeat the producer command without `KEY`. The consumer prints `key=null`. In a topic with multiple partitions, keyed records are routed consistently by key while records without keys can be distributed differently; this one-partition lesson intentionally does not demonstrate that experiment yet.

## What this demo does not guarantee

A successful producer send is not a guarantee that a business operation completed. This lesson does not implement transactions, idempotent publishing, retries for application failures, schema validation, or a dead-letter topic. Those are separate production concerns and should be introduced only after the basic record flow is clear.