// import fs from "node:fs";
// import os from "node:os";
// import path from "node:path";
import {KafkaContainer} from "@testcontainers/kafka";
import {Kafka} from "kafkajs";

async function waitForKafka(brokers, timeoutMs = 30000) {
    const start = Date.now();
    const kafka = new Kafka({brokers});
    const admin = kafka.admin();
    while (true) {
        try {
            await admin.connect();
            // both calls touch controller & metadata paths
            await admin.describeCluster();
            await admin.listTopics();
            await admin.disconnect();
            return;
        } catch {
            try {
                await admin.disconnect();
            } catch {
            }
            if (Date.now() - start > timeoutMs) throw new Error("Kafka not ready in time");
            await new Promise(r => setTimeout(r, 250));
        }
    }
}

export default async () => {
    const image = process.env.KAFKA_IMAGE || "confluentinc/cp-kafka:7.9.2";
    const container = await new KafkaContainer(image)
        .withStartupTimeout(12000)
        // .withWaitStrategy(Wait.forHealthCheck())
        // .withReuse()
        .start();

    const brokers = [`${container.getHost()}:${container.getMappedPort(9093)}`];

    // ✅ wait for controller & group coordinator to be reachable
    await waitForKafka(brokers);

    // Save container id + brokers to a temp file visible to all workers
    // const file = path.join(os.tmpdir(), `kafka-testcontainers-${process.pid}.json`);
    // fs.writeFileSync(file, JSON.stringify({brokers, id: container.getId()}), "utf8");

    // Stash paths on global to read them in teardown (same process)
    globalThis.__kafka_container__ = {container};
    globalThis.__kafka_brokers__ = {brokers};
};
