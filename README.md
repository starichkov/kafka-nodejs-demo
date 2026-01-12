[![Author](https://img.shields.io/badge/Author-Vadim%20Starichkov-blue?style=for-the-badge)](https://github.com/starichkov)
[![GitHub License](https://img.shields.io/github/license/starichkov/kafka-nodejs-demo?style=for-the-badge)](https://github.com/starichkov/kafka-nodejs-demo/blob/main/LICENSE.md)
[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/starichkov/kafka-nodejs-demo/node.js.yml?style=for-the-badge)](https://github.com/starichkov/kafka-nodejs-demo/actions/workflows/node.js.yml)
[![Codecov](https://img.shields.io/codecov/c/github/starichkov/kafka-nodejs-demo?style=for-the-badge)](https://codecov.io/gh/starichkov/kafka-nodejs-demo)

Apache Kafka Node.js Demo
=

A minimal Apache Kafka demo using Node.js.

## ⚙️ Requirements

These are the versions this sample app is coming with:

- Node.js (v24 or higher; compatible with v20 and v22)
- npm or pnpm
- Docker and Docker Compose (optional)
- Apache Kafka 3.9.1 or 4.1.1 (tested and supported; 3.9.1 is the primary version)

Stable work on versions lower than v20 is not guaranteed.

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
- Create the topic kafka-nodejs-demo-topic
- Build and run the demo producer (sends one message) and consumer (prints messages)

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
KAFKA_TOPIC=kafka-nodejs-demo-topic \
npm run start:consumer
```

3. Produce a message (terminal 2):

```shell
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=kafka-nodejs-demo-topic \
MESSAGE="Hello from producer" \
# KEY is optional; uncomment to set a key
# KEY=my-key \
npm run start:producer
```

4. Stop:
- Press Ctrl+C in the consumer terminal
- Stop Kafka: `docker compose down`

### Configuration (env vars and defaults)

- `KAFKA_BROKERS`: Kafka broker list (default: localhost:9092)
- `KAFKA_CLIENT_ID`: client id (default: kafka-nodejs-demo)
- `KAFKA_GROUP_ID`: consumer group id (consumer only; default: kafka-nodejs-demo-group)
- `KAFKA_TOPIC`: topic name (default: demo-topic)
- `FROM_BEGINNING`: read from beginning (consumer only; default: true)
- `MESSAGE`: message value to send (producer only; default: "hello from producer")
- `KEY`: optional message key (producer only; default: unset)

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
