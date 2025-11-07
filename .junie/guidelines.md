# Project Overview — kafka-nodejs-demo

A minimal Apache Kafka demo implemented in Node.js. It showcases a simple producer that sends a single message and a consumer that prints messages from a Kafka topic. The project includes:
- Local and Docker Compose run options
- Typed-ish utility helpers and a lightweight logger
- Jest tests, including integration tests powered by Testcontainers (Kafka)
- CI via GitHub Actions with Codecov coverage upload

Last updated: 2025-11-07 22:25 (local)

---

## Tech Stack
- Node.js (ESM, requires Node 22+)
- KafkaJS for Kafka client
- Jest for testing (+ @testcontainers/kafka)
- Docker and Docker Compose for local infra and app containers

## Repository Layout
```
/
├─ README.md                 # User-facing quickstart and usage
├─ docker-compose.yml        # Single-broker Kafka + demo services
├─ consumer.Dockerfile       # Docker image for consumer
├─ producer.Dockerfile       # Docker image for producer
├─ documentation/
│  └─ docker.md              # Extra Docker-related docs
├─ src/
│  ├─ consumer.js            # Consumer implementation + CLI entry
│  ├─ producer.js            # Producer implementation + CLI entry
│  ├─ utils.js               # Shared helpers (parseBrokers, waitForKafkaConnectivity)
│  └─ logger.js              # Lightweight leveled logger
├─ tests/                    # Jest unit + integration tests
├─ jest-global-setup.js      # Starts Kafka Testcontainers and waits for readiness
├─ jest-global-teardown.js   # Stops Kafka Testcontainers
├─ .github/workflows/node.js.yml  # CI pipeline
└─ package.json              # Scripts, deps, Jest config
```

## How to Run

### Option A: All-in with Docker Compose
Requires Docker and Docker Compose.

- Start everything (Kafka, topic creation, producer, consumer):
```
docker compose up --build
```
- Follow logs:
```
docker compose logs -f consumer producer
```
This starts a single Kafka broker, creates the topic `kafka-nodejs-demo-topic`, runs the producer (send once) and the consumer (prints messages).

- Stop:
```
docker compose down
```

More details: ../documentation/docker.md

### Option B: Run Node.js apps locally (Kafka via Docker)
1) Start Kafka only:
```
docker compose up -d kafka
```
2) (Optional) Create the demo topic:
```
docker compose run --rm kafka-setup
```
3) Start the consumer (terminal 1):
```
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=kafka-nodejs-demo-topic \
npm run start:consumer
```
4) Produce a message (terminal 2):
```
KAFKA_BROKERS=localhost:9092 \
KAFKA_TOPIC=kafka-nodejs-demo-topic \
MESSAGE="Hello from producer" \
# KEY is optional; uncomment to set a key
# KEY=my-key \
npm run start:producer
```

## Scripts (package.json)
- `npm run start:producer` → `node src/producer.js`
- `npm run start:consumer` → `node src/consumer.js`
- `npm test`              → Jest in-band with open handle detection
- `npm run test:coverage` → Jest with coverage reports (lcov, text, summary)

## Configuration — Environment Variables
Common:
- `KAFKA_BROKERS`  (default: `localhost:9092` when running locally)
- `KAFKA_CLIENT_ID` (default: `kafka-nodejs-demo`)
- `KAFKA_TOPIC`     (default: `demo-topic` in code; Compose uses `kafka-nodejs-demo-topic`)

Consumer-only:
- `KAFKA_GROUP_ID`  (default: `kafka-nodejs-demo-group`)
- `FROM_BEGINNING`  (default: `true`) — whether to read from beginning

Producer-only:
- `MESSAGE`         (default: `"hello from producer"`)
- `KEY`             (optional)

Infrastructure / tooling:
- `LOG_LEVEL`       (logger; one of `trace|debug|info|warn|error|fatal`; default: `info`)
- `KAFKA_IMAGE`     (Jest Testcontainers; default in setup: `confluentinc/cp-kafka:7.9.3`)

## Code Highlights
- `src/producer.js`
  - `produceMessage({ brokers, clientId, topic, message, key })`
  - Reads env with `configFromEnv()`; CLI enabled when executed directly
  - Waits for Kafka readiness via `waitForKafkaConnectivity`

- `src/consumer.js`
  - `consumeMessages({ brokers, clientId, groupId, topic, fromBeginning })`
  - Also waits for readiness via `waitForKafkaConnectivity`

- `src/utils.js`
  - `parseBrokers(input)` — normalizes a string or array of brokers
  - `waitForKafkaConnectivity(kafka)` — polls `admin.describeCluster()`

- `src/logger.js`
  - Very small leveled logger with timestamp; respects `LOG_LEVEL`

## Testing
- Framework: Jest (ESM mode via Node flags)
- Global setup/teardown spin up Kafka via Testcontainers and wait for readiness
- Coverage: v8 provider, outputs text + lcov (`coverage/lcov.info`)

Run tests locally:
```
npm test
# or with coverage
npm run test:coverage
```

## CI
- GitHub Actions workflow: `.github/workflows/node.js.yml`
  - Matrix on Node 22.x and 24.x
  - Coverage and Codecov upload on Node 22.x

## Docker Images
- `consumer.Dockerfile` → runs `node src/consumer.js`
- `producer.Dockerfile` → runs `node src/producer.js`
See `documentation/docker.md` for manual build/run examples.

## Troubleshooting
- Kafka not ready: the app waits for readiness, but if you see timeouts, ensure port 9092 is free and Docker is healthy.
- Mixed topic names: code defaults to `demo-topic`; Docker Compose uses `kafka-nodejs-demo-topic`. Set `KAFKA_TOPIC` explicitly to avoid confusion.
- Node version: ensure Node 22+ when running locally (ESM, flags in Jest scripts rely on recent Node).
- Windows Docker networking: use `host.docker.internal:9092` inside containers if pointing to a host Kafka.

## License & Attribution
- License: MIT (see `LICENSE.md`)
- Attribution (from README):
```
Based on kafka-nodejs-demo by Vadim Starichkov, TemplateTasks
https://github.com/starichkov/kafka-nodejs-demo
```

## References
- README: ../README.md
- Docker docs: ../documentation/docker.md
- Compose: ../docker-compose.yml
- Producer: ../src/producer.js
- Consumer: ../src/consumer.js
- Utils: ../src/utils.js
- Logger: ../src/logger.js
- CI: ../.github/workflows/node.js.yml
