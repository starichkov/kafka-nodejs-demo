# Lesson 2: Consumer groups, offsets, and replay

This lesson builds on [Lesson 1](lesson-01-basics.md) and uses a known sequence of records to show how Kafka remembers a consumer group's position. You will compare a new group, a restarted group, and a different group reading the same topic.

## What you will learn

- A consumer group has its own committed position for each topic partition.
- A new group can start at the beginning when `FROM_BEGINNING=true`.
- `FROM_BEGINNING` is used only when the group has no committed offset; it is not a rewind switch.
- Restarting the same group resumes after its committed position.
- A different group gets an independent view of the same records.
- With one partition, only one consumer in a group can actively receive that partition at a time.

## Start with a clean, one-partition topic

Run these commands from the project root on the host. Removing the Compose volumes makes the starting state predictable for this disposable exercise:

```shell
docker compose down -v
docker compose up -d kafka
docker compose run --rm kafka-setup
```

The setup service creates `demo-topic` with one partition. Wait until the broker is ready before continuing:

```shell
docker compose ps
```

The `kafka` service should show `healthy`. If it does not, inspect `docker compose logs kafka` before starting the applications.

## 1. Read a known sequence with a new group

In terminal 1, start a consumer with a new group ID:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
KAFKA_GROUP_ID=lesson-02-group \
FROM_BEGINNING=true \
npm run start:consumer
```

In terminal 2, produce three records. The commands run on the host and use the broker's external listener:

```shell
KAFKA_BROKERS=localhost:9092 KAFKA_TOPIC=demo-topic MESSAGE="lesson-02-first" KEY=sequence npm run start:producer
KAFKA_BROKERS=localhost:9092 KAFKA_TOPIC=demo-topic MESSAGE="lesson-02-second" KEY=sequence npm run start:producer
KAFKA_BROKERS=localhost:9092 KAFKA_TOPIC=demo-topic MESSAGE="lesson-02-third" KEY=sequence npm run start:producer
```

The consumer prints three records with the same `topic=demo-topic` and `partition=0`, with consecutive offsets such as `0`, `1`, and `2`:

```text
Consumed message group=lesson-02-group topic=demo-topic partition=0 offset=0 timestamp=... key=sequence value=lesson-02-first
Consumed message group=lesson-02-group topic=demo-topic partition=0 offset=1 timestamp=... key=sequence value=lesson-02-second
Consumed message group=lesson-02-group topic=demo-topic partition=0 offset=2 timestamp=... key=sequence value=lesson-02-third
```

The exact offsets depend on the topic's previous data. What matters is their order and that the consumer group name is the same for all three records. Leave the consumer running until all three records are visible, then stop it with Ctrl+C so KafkaJS can finish its normal shutdown and commit processing progress.

## 2. Restart the same group

Start the consumer again with the same group ID, this time explicitly setting `FROM_BEGINNING=false`:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
KAFKA_GROUP_ID=lesson-02-group \
FROM_BEGINNING=false \
npm run start:consumer
```

Nothing from the first sequence should be printed. The group already has a committed position after the third record, so Kafka resumes from that position rather than replaying old records.

Now produce one more record in terminal 2:

```shell
KAFKA_BROKERS=localhost:9092 KAFKA_TOPIC=demo-topic MESSAGE="lesson-02-fourth" KEY=sequence npm run start:producer
```

The restarted consumer should print only `lesson-02-fourth`. Its offset is the next offset after the first sequence. Stop the consumer with Ctrl+C after the record appears.

> **Important:** Setting `FROM_BEGINNING=true` on this same `lesson-02-group` would not rewind it. Kafka uses the group's committed offset when one exists. To replay from the beginning, use a new group or reset offsets with an explicit administrative operation.

## 3. Replay with a different group

Start a new consumer group:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
KAFKA_GROUP_ID=lesson-02-replay-group \
FROM_BEGINNING=true \
npm run start:consumer
```

This group has no committed offset for `demo-topic`, so it reads the whole sequence, including `lesson-02-first`, `lesson-02-second`, `lesson-02-third`, and `lesson-02-fourth`. The records are not copied or removed when one group reads them; each group maintains its own position. Stop this consumer with Ctrl+C when all four records are visible.

## Consumer-group observations

| Experiment | Group ID | Starting position | Expected records |
| --- | --- | --- | --- |
| First read | `lesson-02-group` | No committed offset, `FROM_BEGINNING=true` | First three records |
| Restart | `lesson-02-group` | Existing committed offset, `FROM_BEGINNING=false` | Only the fourth record after it is produced |
| Replay | `lesson-02-replay-group` | No committed offset, `FROM_BEGINNING=true` | All four records |

The topic has one partition so the ordering is easy to follow. If two consumers use `lesson-02-group` at the same time, Kafka assigns the single partition to only one of them; the other is waiting for work. Consumer-group load sharing becomes visible only when the topic has at least as many partitions as active consumers.

## Optional extension: observe assignment with multiple partitions

This extension uses a separate three-partition topic. Run it from the host after the broker is running:

```shell
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh \
  --create --if-not-exists --topic lesson-02-partitions \
  --bootstrap-server kafka:9092 --partitions 3 --replication-factor 1
```

Open two terminals and start both consumers with the same group ID and topic:

```shell
KAFKA_BROKERS=localhost:9092 KAFKA_TOPIC=lesson-02-partitions KAFKA_GROUP_ID=lesson-02-shared FROM_BEGINNING=true npm run start:consumer
```

```shell
KAFKA_BROKERS=localhost:9092 KAFKA_TOPIC=lesson-02-partitions KAFKA_GROUP_ID=lesson-02-shared FROM_BEGINNING=true npm run start:consumer
```

Produce several records, using different keys or no key, and compare the `partition` values in both consumers' output. The group shares partitions between its members; a second group with a different ID would receive its own copy of the records. Stop both consumers before cleanup.

## Cleanup

Stop any remaining consumers, then remove the broker and its disposable data:

```shell
docker compose down -v
```

This lesson does not reset committed offsets through Kafka's admin API. That omission is intentional: it keeps the first replay experiment focused on the difference between a new group and a restarted group. Offset reset and topic administration are useful follow-up lessons.