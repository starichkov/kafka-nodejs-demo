import {describe, test, expect} from '@jest/globals';
import {kafkaClient, uniqueId, ensureTopic} from './kafka-helpers.js';
import {consumeMessages} from '../src/consumer.js';
import {Partitioners} from "kafkajs";

async function produce(topic, {key = null, value}) {
    const kafka = kafkaClient();
    await ensureTopic(kafka, topic);
    const producer = kafka.producer({createPartitioner: Partitioners.DefaultPartitioner});
    await producer.connect();
    await producer.send({topic, messages: [{key, value}]});
    await producer.disconnect();
}

describe('consumer with real Kafka (Testcontainers)', () => {
    test('consumeMessages consumes a produced message and can stop', async () => {
        const {brokers} = globalThis.__kafka_brokers__;
        const topic = uniqueId('t');

        let firstMessage;
        const {stop, runPromise} = await consumeMessages({
            brokers,
            topic,
            clientId: 'c',
            groupId: `g-${Date.now()}-${Math.random()}`,
            fromBeginning: true,
            eachMessage: async ({topic, partition, message}) => {
                firstMessage = {
                    topic,
                    partition,
                    key: message.key ? message.key.toString() : null,
                    value: message.value ? message.value.toString() : null,
                };
                // NOTE: do not stop here — let the handler finish cleanly
            },
        });

        await produce(topic, {key: 'k', value: 'v'});

        // wait until handler ran
        const got = await Promise.race([
            (async () => {
                while (!firstMessage) await new Promise(r => setTimeout(r, 15));
                return firstMessage;
            })(),
            new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 15000)),
        ]);

        // NOW stop the consumer loop and await its promise
        await stop();
        await runPromise;

        expect(got).toEqual({topic, partition: 0, key: 'k', value: 'v'});
    }, 20_000);
});
