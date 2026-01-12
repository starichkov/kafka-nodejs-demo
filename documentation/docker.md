## 🐳 Docker & Docker Compose

This repo includes Dockerfiles to run the producer and consumer as standalone containers, plus a docker-compose.yml to
run them together with Kafka.

### Build images

- Consumer:
  ```shell
  docker build -f consumer.Dockerfile -t kafka-nodejs-demo-consumer .
  ```

- Producer:
  ```shell
  docker build -f producer.Dockerfile -t kafka-nodejs-demo-producer .
  ```

### Run standalone (against your own Kafka)

Provide your Kafka bootstrap servers via KAFKA_BROKERS:

- Consumer (will keep running and print consumed messages):
    ```shell
    docker run --rm \
    -e KAFKA_BROKERS=host.docker.internal:9092 \
    -e KAFKA_TOPIC=demo-topic \
    -e KAFKA_GROUP_ID=kafka-nodejs-demo-group \
    --name consumer kafka-nodejs-demo-consumer
    ```

- Producer (sends one message and exits):
    ```shell
    docker run --rm \
    -e KAFKA_BROKERS=host.docker.internal:9092 \
    -e KAFKA_TOPIC=demo-topic \
    -e MESSAGE="hello from producer" \
    --name producer kafka-nodejs-demo-producer
    ```

Replace host.docker.internal:9092 with the address of your Kafka broker.

### Run everything with docker-compose

This will start a single Kafka broker (KRaft, version 3.9.1), the consumer, and then the producer. 
The project is also compatible with Kafka 4.1.1.

- Start:
  ```shell
  docker compose up --build
  ```

- Observe logs: the consumer should print the message produced by the producer to topic demo-topic.

- Cleanup:
  ```shell
  docker compose down -v
  ```
