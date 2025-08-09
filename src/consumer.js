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

export async function consumeMessages({
                                          brokers,
                                          clientId = 'kafka-nodejs-demo',
                                          groupId = 'kafka-nodejs-demo-group',
                                          topic = 'demo-topic',
                                          fromBeginning = true,
                                          eachMessage,
                                          signal,
                                      }) {
    if (!brokers || (Array.isArray(brokers) && brokers.length === 0)) {
        throw new Error('brokers is required');
    }
    if (!topic) throw new Error('topic is required');

    const kafka = new Kafka({clientId, brokers: parseBrokers(brokers), logLevel: logLevel.INFO});
    const consumer = kafka.consumer({groupId});

    let running = true;

    const stopConsumer = async () => {
        if (!running) return;
        console.log('Stopping consumer...');
        running = false;
        try {
            await consumer.stop();
            console.log('Consumer stopped');
        } catch (err) {
            console.error('Error stopping consumer:', err);
        }
        try {
            await consumer.disconnect();
            console.log('Consumer disconnected');
        } catch (err) {
            console.error('Error disconnecting consumer:', err);
        }
    };

    if (signal) {
        if (signal.aborted) {
            console.log('Signal already aborted, stopping consumer immediately');
            await stopConsumer();
        }
        signal.addEventListener('abort', stopConsumer, {once: true});
    }

    console.log('Connecting to Kafka...');
    await consumer.connect();
    console.log('Connected to Kafka successfully');
    
    console.log(`Subscribing to topic: ${topic}, fromBeginning: ${fromBeginning}`);
    await consumer.subscribe({topic, fromBeginning});
    console.log('Subscribed to topic successfully');

    // Add delay and retry logic for group coordinator readiness
    console.log('Waiting for group coordinator to be ready...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('Starting consumer run loop with retry logic...');
    let retries = 0;
    const maxRetries = 3;
    let runPromise;
    
    while (retries < maxRetries && running) {
        try {
            runPromise = consumer.run({
                eachMessage: async (payload) => {
                    if (!running) return;
                    if (typeof eachMessage === 'function') {
                        await eachMessage(payload);
                    } else {
                        const {topic, partition, message} = payload;
                        const key = message.key ? message.key.toString() : null;
                        const value = message.value ? message.value.toString() : null;
                        console.log(`Consumed message topic=${topic} partition=${partition} key=${key} value=${value}`);
                    }
                },
            });
            console.log('Consumer run loop started successfully');
            break; // Success, exit retry loop
        } catch (error) {
            retries++;
            console.log(`Consumer start failed (attempt ${retries}/${maxRetries}):`, error.message);
            if (retries < maxRetries) {
                console.log(`Retrying in ${2000 * retries}ms...`);
                await new Promise(resolve => setTimeout(resolve, 2000 * retries));
            } else {
                console.error('Max retries reached, consumer failed to start');
                throw error;
            }
        }
    }

    const stop = async () => {
        await stopConsumer();
        try {
            await runPromise; // ensure run loop has exited
        } catch (_) {
            // ignore
        }
    };

    return {stop, runPromise};
}

function configFromEnv() {
    return {
        brokers: process.env.KAFKA_BROKERS || 'localhost:9092',
        clientId: process.env.KAFKA_CLIENT_ID || 'kafka-nodejs-demo',
        groupId: process.env.KAFKA_GROUP_ID || 'kafka-nodejs-demo-group',
        topic: process.env.KAFKA_TOPIC || 'demo-topic',
        fromBeginning: process.env.FROM_BEGINNING ? process.env.FROM_BEGINNING === 'true' : true,
    };
}

async function main() {
    const cfg = configFromEnv();
    const ac = new AbortController();
    const signal = ac.signal;
    process.on('SIGINT', () => ac.abort());
    process.on('SIGTERM', () => ac.abort());
    try {
        console.log(`Starting consumer: topic=${cfg.topic}, brokers=${cfg.brokers}`);
        const {runPromise} = await consumeMessages({...cfg, signal});
        // Keep the process alive until the consumer stops (e.g., on SIGINT/SIGTERM)
        await runPromise;
    } catch (err) {
        console.error('Consumer error:', err);
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
