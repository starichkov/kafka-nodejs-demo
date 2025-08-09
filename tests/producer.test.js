import {describe, test, expect} from '@jest/globals';
import {kafkaClient, uniqueId, ensureTopic} from './kafka-helpers.js';
import {produceMessage} from "../src/producer.js";

async function consumeOne(kafka, topic) {
    const groupId = uniqueId("g");
    const consumer = kafka.consumer({groupId: groupId});
    await consumer.connect();
    await consumer.subscribe({topic, fromBeginning: true});
    let first;
    await new Promise((resolve, reject) => {
        consumer
            .run({
                eachMessage: async ({message}) => {
                    first = {
                        key: message.key ? message.key.toString() : null,
                        value: message.value ? message.value.toString() : null,
                    };
                    resolve();
                },
            })
            .catch(reject);
    });
    await consumer.stop();
    await consumer.disconnect();
    return first;
}

describe('producer with real Kafka (Testcontainers)', () => {

    const {brokers} = globalThis.__kafka_brokers__;

    const kafka = kafkaClient();

    test('produceMessage sends string message that can be consumed', async () => {
        const topic = uniqueId();
        await ensureTopic(kafka, topic);
        await produceMessage({brokers, topic, key: 'k', message: 'v'});

        const msg = await consumeOne(kafka, topic);
        expect(msg).toEqual({key: 'k', value: 'v'});
    });

    test('produceMessage stringifies non-string message', async () => {
        const topic = uniqueId();
        await ensureTopic(kafka, topic);
        await produceMessage({brokers, topic, message: {a: 1}});

        const msg = await consumeOne(kafka, topic);
        expect(msg).toEqual({key: null, value: JSON.stringify({a: 1})});
    });
});
