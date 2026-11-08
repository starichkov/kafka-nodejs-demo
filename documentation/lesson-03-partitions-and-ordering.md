# Lesson 3: Partitions, keys, ordering, and parallel consumers

This lesson builds on [Lesson 2](lesson-02-groups-and-offsets.md) by creating a topic with three partitions. You will send a deterministic batch, observe that one key stays in one partition and in order, and then run two consumers in the same group to see Kafka share partitions between them.

## What you will learn

- A topic is split into independent partitions.
- Kafka preserves record order within a partition, not across a whole topic.
- Records with the same key are normally routed to the same partition.
- Consumers in one group share partitions; each partition is assigned to one group member at a time.
- A group can have fewer, equal, or more consumers than the topic has partitions.

## Start a three-partition topic

Run these commands from the project root on the host. The environment variable is read by the Compose topic-setup service:

```shell
docker compose down -v
PARTITION_COUNT=3 docker compose up -d kafka
PARTITION_COUNT=3 docker compose run --rm kafka-setup
```

Confirm the topic layout from inside the Kafka container:

```shell
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh \
  --describe --topic demo-topic --bootstrap-server kafka:9092
```

The output should report `PartitionCount: 3`. The default Compose flow still uses one partition when `PARTITION_COUNT` is not set.

## 1. Observe same-key ordering

Start one consumer in terminal 1. A unique group makes the experiment independent of earlier committed offsets:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
KAFKA_GROUP_ID=lesson-03-order-group \
FROM_BEGINNING=true \
npm run start:consumer
```

Produce three records with one key in terminal 2:

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
MESSAGE="lesson-03" KEY=sequence MESSAGE_COUNT=3 \
npm run start:producer
```

The producer prints three records with the same partition and consecutive offsets. The consumer prints `lesson-03-1`, `lesson-03-2`, and `lesson-03-3` in that order. The partition number is broker-selected; it may be `0`, `1`, or `2`.

The key does not make the records global or permanently ordered across partitions. It gives Kafka a stable routing value, so records with the same key normally stay together and retain their order in that partition.

## 2. Share partitions between two consumers

Stop the first consumer. Open two terminals and start both consumers with the same topic and group ID:

```shell
KAFKA_BROKERS=localhost:9092 KAFKA_TOPIC=demo-topic KAFKA_GROUP_ID=lesson-03-shared FROM_BEGINNING=true npm run start:consumer
```

```shell
KAFKA_BROKERS=localhost:9092 KAFKA_TOPIC=demo-topic KAFKA_GROUP_ID=lesson-03-shared FROM_BEGINNING=true npm run start:consumer
```

Produce one record explicitly to each partition:

```shell
for partition in 0 1 2; do
  KAFKA_BROKERS=localhost:9092 KAFKA_TOPIC=demo-topic MESSAGE="lesson-03-partition-${partition}" PARTITION=$partition npm run start:producer
done
```

After the group rebalances, the two terminals should receive different partition numbers. Across both terminals, the records from partitions `0`, `1`, and `2` should each appear once. Which consumer receives which partition is assigned by Kafka and can change between runs.

The group has two consumers but three partitions, so one consumer normally owns two partitions and the other owns one. A fourth consumer would have no partition to process until membership changes.

## What to observe

| Observation | Explanation |
| --- | --- |
| Same key, same partition | Kafka's default partitioner hashes the key. |
| Consecutive offsets in one partition | Offsets are positions local to a partition. |
| Two consumers, one group | Partitions are divided between group members. |
| Different group ID | Each group receives its own view of the records. |
| Assignment changes between runs | Group membership triggers rebalancing. |

## Cleanup

Stop both consumers and remove the disposable broker data:

```shell
docker compose down -v
```

The application still defaults to a one-message, one-partition quickstart. This lesson opts into multiple partitions explicitly so the new behavior is easy to compare with the earlier lessons.