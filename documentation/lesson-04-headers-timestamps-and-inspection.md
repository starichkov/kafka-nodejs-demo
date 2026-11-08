# Lesson 4: Headers, timestamps, and record inspection

This lesson adds metadata to the record from Lesson 3 and then asks Kafka for the offset range currently stored in each partition. The value is still a simple string: Kafka stores bytes, while headers and timestamps provide context around those bytes.

## 1. Start Kafka and create a topic

From the project root, run:

```shell
docker compose up -d kafka
docker compose run --rm kafka-setup
```

The commands run on the host. The broker is reachable at `localhost:9092` from host processes.

## 2. Start a consumer

In terminal 1, run:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
KAFKA_GROUP_ID=lesson-04-group \
FROM_BEGINNING=true \
npm run start:consumer
```

## 3. Produce a record with metadata

In terminal 2, run:

```shell
MESSAGE="lesson-04" \
KEY=order-42 \
MESSAGE_HEADERS='{"trace-id":"abc-123","source":"lesson-04"}' \
MESSAGE_TIMESTAMP=1700000000000 \
npm run start:producer
```

The producer sends the JSON object as Kafka headers and the timestamp as milliseconds since the Unix epoch. The consumer prints `topic`, `partition`, `offset`, `timestamp`, `headers`, `key`, and `value`.

KafkaJS decodes received header values as `Buffer` objects. A header can also have multiple values, which is why the producer accepts arrays such as `{"tag":["one","two"]}`.

## 4. Inspect the partition offset range

In another terminal, run:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
npm run inspect:topic
```

The command is read-only and prints one line per partition, for example:

```text
Topic partition=0 beginningOffset=0 endOffset=1
```

`beginningOffset` is the oldest available offset. `endOffset` is the next offset that would be assigned, so `endOffset - beginningOffset` is the number of currently retained records in an uncomplicated partition. A consumer's record offset is not a global message number; offsets are local to partitions.

## What to notice

| Field | Meaning |
| --- | --- |
| Key | Application value used by Kafka's partitioner; it is not part of the payload schema. |
| Timestamp | Producer-supplied record time when provided; Kafka returns it as a string. |
| Headers | Optional key/value metadata carried with the record, often used for tracing or routing hints. |
| Offset | Position within one partition. |
| Beginning/end offsets | The retained range and next-write position for each partition. |

This demo does not validate header schemas, guarantee timestamp semantics across broker settings, or implement tracing. Those are application-level concerns. Clean up the disposable broker when finished:

```shell
docker compose down -v
```