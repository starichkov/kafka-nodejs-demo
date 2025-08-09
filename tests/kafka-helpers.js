import {Kafka} from "kafkajs";

export function kafkaClient() {
    const {brokers} = globalThis.__kafka_brokers__;
    return new Kafka({brokers});
}

export function uniqueId(prefix = "t") {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function ensureTopic(kafka, topic) {
    const admin = kafka.admin();
    await admin.connect();
    const topics = await admin.listTopics();
    if (!topics.includes(topic)) {
        await admin.createTopics({topics: [{topic, numPartitions: 1, replicationFactor: 1}]});
    }
    await admin.disconnect();
}
