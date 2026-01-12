FROM node:24.12.0-alpine3.23

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production

ENV KAFKA_BROKERS=localhost:9092 \
    KAFKA_CLIENT_ID=kafka-nodejs-demo \
    KAFKA_TOPIC=demo-topic \
    MESSAGE="hello from producer"

CMD ["node", "src/producer.js"]
