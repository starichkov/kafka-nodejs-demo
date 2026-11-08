[![Author](https://img.shields.io/badge/Author-Vadim%20Starichkov-blue?style=for-the-badge)](https://github.com/starichkov)
[![GitHub License](https://img.shields.io/github/license/starichkov/kafka-nodejs-demo?style=for-the-badge)](https://github.com/starichkov/kafka-nodejs-demo/blob/main/LICENSE.md)
[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/starichkov/kafka-nodejs-demo/node.js.yml?style=for-the-badge)](https://github.com/starichkov/kafka-nodejs-demo/actions/workflows/node.js.yml)
[![Codecov](https://img.shields.io/codecov/c/github/starichkov/kafka-nodejs-demo?style=for-the-badge)](https://codecov.io/gh/starichkov/kafka-nodejs-demo)

Apache Kafka Node.js Demo
=

A minimal Apache Kafka demo using Node.js.

## ⚙️ Requirements

The compatibility targets for this sample are summarized below. CI tests every combination of the listed Node.js and Kafka distributions.

| Component | Supported/tested versions | Where it is used |
| --- | --- | --- |
| Node.js | 22, 24, and 26; 26 is the primary development version | Local commands, application images, and CI |
| Kafka | 4.3.2 (primary); 3.9.2 (also supported) | Testcontainers and CI compatibility matrix |
| KafkaJS | `^2.2.4` | Node.js producer and consumer dependency |
| Compose Kafka image | `apache/kafka:4.3.2` | Default local Docker Compose flow |
| CI Kafka images | `confluentinc/cp-kafka:8.3.2` (Kafka 4.3.2, primary) and `confluentinc/cp-kafka:7.9.6` (Kafka 3.9.2, also supported) | GitHub Actions integration tests |
| Package manager | npm with `npm ci`; pnpm may also be used locally | Dependency installation |
| Docker Compose | Docker and Compose compatible with the commands below | Optional local broker and smoke test |

Stable work on versions lower than v22 is not guaranteed. CI verifies compatibility with Node.js v22, v24, and v26.

## 🚀 How to Run

### Option 1: Quickstart with Docker Compose

Requires Docker and Docker Compose.

- Start everything (Kafka, topic creation, producer, consumer):

```
docker compose up --build
```

- Follow logs:

```
docker compose logs -f consumer producer
```

This will:
- Start a Kafka broker (exposed on localhost:9092)
- Create the topic `demo-topic`
- Build and run the demo producer (sends one message) and consumer (prints messages)

The Compose broker advertises `kafka:9092` to other Compose services and `localhost:9092` to applications running on your host.

### Option 2: Run the Node.js apps locally

1. Start Kafka only:

```shell
docker compose up -d kafka
```

Optionally create the demo topic:

```shell
docker compose run --rm kafka-setup
```

2. Start the consumer (terminal 1):

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
npm run start:consumer
```

3. Produce a message (terminal 2):

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=demo-topic \
MESSAGE="Hello from producer" \
# KEY is optional; uncomment to set a key
# KEY=my-key \
npm run start:producer
```

4. Stop:
- Press Ctrl+C in the consumer terminal
- Stop Kafka and remove the disposable broker data: `docker compose down -v`

If the applications cannot connect, check `docker compose ps` and inspect the broker logs with `docker compose logs kafka`.

### Guided beginner lesson

Continue with [Lesson 1: Follow one Kafka record](documentation/lesson-01-basics.md) to observe the same record at both ends of the flow. The producer reports Kafka's topic, partition, and offset; the consumer reports those values plus its group, timestamp, key, and value. This makes the broker-assigned position visible before moving on to multiple partitions, replay, and consumer-group experiments.

Then continue with [Lesson 2: Consumer groups, offsets, and replay](documentation/lesson-02-groups-and-offsets.md) to compare a new group, a restarted group, and a different group reading the same records.

Then continue with [Lesson 3: Partitions, keys, ordering, and parallel consumers](documentation/lesson-03-partitions-and-ordering.md) to create a three-partition topic, observe same-key ordering, and share partitions between consumers in one group.

### Configuration (env vars and defaults)

- `KAFKA_BROKERS`: Kafka broker list (default: `localhost:9092`)
- `KAFKA_CLIENT_ID`: client id (default: `kafka-nodejs-demo`)
- `KAFKA_GROUP_ID`: consumer group id (consumer only; default: `kafka-nodejs-demo-group`)
- `KAFKA_TOPIC`: topic name (default: `demo-topic`; this is also the Compose topic)
- `PARTITION_COUNT`: number of partitions for a newly created Compose topic (default: `1`; topic setup only)
- `FROM_BEGINNING`: read from beginning (consumer only; default: `true`)
- `MESSAGE`: message value to send (producer only; default: `"hello from producer"`)
- `KEY`: optional message key (producer only; default: unset)
- `MESSAGE_COUNT`: number of records to send (producer only; default: `1`; values become `MESSAGE-1`, `MESSAGE-2`, ... when greater than one)
- `PARTITION`: optional non-negative partition number for every produced record (producer only; default: broker partition selection)
- `LOG_LEVEL`: logger level, one of `trace|debug|info|warn|error|fatal` (default: `info`)

To send a deterministic batch, keep the consumer running and use the same key for all records:

```shell
MESSAGE="lesson-03" KEY=sequence MESSAGE_COUNT=3 npm run start:producer
```

The producer logs one topic/partition/offset line per record. A shared key normally sends the batch to one partition, making the `-1`, `-2`, `-3` ordering easy to observe.

## 🧪 Testing

The project uses Jest for unit and integration testing. Integration tests use [Testcontainers](https://testcontainers.com/) to spin up a real Kafka instance.

### Run tests locally

```shell
npm test
```

### Run tests with coverage

```shell
npm run test:coverage
```

The coverage report will be generated in the `coverage/` directory.

### Run the Docker Compose smoke test

To validate the complete demo flow locally, including Kafka startup, topic creation, producer delivery, and consumer receipt:

```shell
npm run test:docker
```

The script builds the application images, starts the Compose stack, waits for the expected message, prints the container status, and cleans up containers and volumes automatically. Docker and Docker Compose are required.

## 🧾 About TemplateTasks

TemplateTasks is a personal software development initiative by Vadim Starichkov, focused on sharing open-source libraries, services, and technical demos.

It operates independently and outside the scope of any employment.

All code is released under permissive open-source licenses. The legal structure may evolve as the project grows.

## 📄 License & Attribution

This project is licensed under the **MIT License** - see the [LICENSE](https://github.com/starichkov/kafka-nodejs-demo/blob/main/LICENSE.md) file for details.

### Using This Project?

If you use this code in your own projects, attribution is required under the MIT License:

```
Based on kafka-nodejs-demo by Vadim Starichkov, TemplateTasks

https://github.com/starichkov/kafka-nodejs-demo
```

**Copyright © 2026 Vadim Starichkov, TemplateTasks**
