# Lesson 7: Topic administration and safe cleanup

Kafka topic lifecycle operations are administrative operations. This lesson
uses the `topic-admin` CLI to list topics, inspect partition metadata, inspect
offset ranges, and delete a disposable topic only when deletion is explicitly
confirmed.

## 1. Start Kafka

```shell
docker compose up -d kafka
docker compose run --rm kafka-setup
```

The commands run on the host, so the broker address is `localhost:9092`.

## 2. List topics

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_ADMIN_ACTION=list \
npm run inspect:topic
```

The command prints one `Topic name=...` line for each topic. Listing is
read-only and does not require a topic name.

## 3. Inspect partition metadata

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
KAFKA_ADMIN_ACTION=metadata \
npm run inspect:topic
```

The output includes the topic name, partition count, leader, replicas, and
in-sync replicas. This is different from the offset inspection in Lesson 4:
metadata describes the topic layout, while offsets describe the retained
record range in each partition.

## 4. Inspect offsets

The default action remains the read-only offset inspection command:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
npm run inspect:topic
```

## 5. Delete a disposable topic

Create a disposable topic from the broker container, then delete it only with
the explicit confirmation variable:

```shell
docker compose exec kafka \
  /opt/kafka/bin/kafka-topics.sh --create --if-not-exists \
  --topic lesson-07-disposable --bootstrap-server localhost:9092 \
  --partitions 1 --replication-factor 1

KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=lesson-07-disposable \
KAFKA_ADMIN_ACTION=delete \
KAFKA_DELETE_CONFIRMED=true \
npm run inspect:topic
```

Without `KAFKA_DELETE_CONFIRMED=true`, the command fails before connecting to
Kafka. This guard makes accidental deletion harder and communicates that
topic deletion removes the topic's records and metadata; it is not a normal
consumer cleanup operation.

## What to notice

- Compose creates `demo-topic` as infrastructure, while the CLI exposes the
  equivalent Kafka admin read and delete operations.
- Topic metadata reports partition ownership and replica state; it does not
  report consumer-group progress.
- Deleting a topic is destructive and should be reserved for disposable
  environments. In production, retention and explicit operational procedures
  are normally preferred over ad hoc deletion.

When finished with the local broker and its data:

```shell
docker compose down -v
```
