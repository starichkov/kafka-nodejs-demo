import pkg from 'kafkajs';
import {pathToFileURL} from 'url';

const {Kafka, logLevel} = pkg;

export function parseBrokers(input) {
    if (Array.isArray(input)) return input;
    if (typeof input !== 'string') return [];
    return input
        .split(',')
        .map((b) => b.trim().replace(/^PLAINTEXT:\/\//, ''))
        .filter(Boolean);
}

export async function produceMessage({brokers, clientId = 'kafka-nodejs-demo', topic = 'demo-topic', message, key}) {
    if (!brokers || (Array.isArray(brokers) && brokers.length === 0)) {
        throw new Error('brokers is required');
    }
    if (!topic) throw new Error('topic is required');
    if (typeof message === 'undefined' || message === null) throw new Error('message is required');

    const kafka = new Kafka({clientId, brokers: parseBrokers(brokers), logLevel: logLevel.NOTHING});
    const producer = kafka.producer();

    await producer.connect();
    try {
        await producer.send({
            topic,
            messages: [
                {
                    key: typeof key === 'undefined' ? null : String(key),
                    value: typeof message === 'string' || Buffer.isBuffer(message) ? message : JSON.stringify(message),
                },
            ],
        });
    } finally {
        await producer.disconnect();
    }
}

function configFromEnv() {
    return {
        brokers: process.env.KAFKA_BROKERS || 'localhost:9092',
        clientId: process.env.KAFKA_CLIENT_ID || 'kafka-nodejs-demo',
        topic: process.env.KAFKA_TOPIC || 'demo-topic',
        message: process.env.MESSAGE || 'hello from producer',
        key: process.env.KEY,
    };
}

async function main() {
    const cfg = configFromEnv();
    try {
        await produceMessage(cfg);
        console.log(`Produced message to ${cfg.topic}`);
        process.exitCode = 0;
    } catch (err) {
        console.error('Producer error:', err);
        process.exitCode = 1;
    }
}

// Run as CLI if executed directly
const isDirectRun = () => {
    try {
        return import.meta.url === pathToFileURL(process.argv[1]).href;
    } catch {
        return false;
    }
};

if (isDirectRun()) {
    // no top-level await to keep Node versions happy
    main();
}
