/* eslint-env jest */
import {jest, describe, test, expect} from '@jest/globals';

// Mock kafkajs as an ESM default export
jest.unstable_mockModule('kafkajs', () => {
    const connect = jest.fn();
    const subscribe = jest.fn();
    const stop = jest.fn();
    const disconnect = jest.fn();
    const run = jest.fn(async ({eachMessage}) => {
        return eachMessage;
    });
    const consumer = () => ({connect, subscribe, run, stop, disconnect});
    const Kafka = function Kafka() {
        return {consumer};
    };
    return {default: {Kafka, logLevel: {NOTHING: 0}}};
});

describe('consumer (unit, mocked kafkajs)', () => {
    test('parseBrokers works', async () => {
        const {parseBrokers} = await import('../src/consumer.js');
        expect(parseBrokers('localhost:9092, other:9093')).toEqual(['localhost:9092', 'other:9093']);
    });

    test('consumeMessages calls eachMessage and can stop', async () => {
        const {default: kafkajs} = await import('kafkajs');
        const {consumeMessages} = await import('../src/consumer.js');
        const cons = new kafkajs.Kafka().consumer();

        const received = [];
        const {stop: stopFn, runPromise} = await consumeMessages({
            brokers: 'b:1',
            topic: 't',
            clientId: 'c',
            groupId: 'g',
            fromBeginning: true,
            eachMessage: async ({topic, partition, message}) => {
                received.push({
                    topic,
                    partition,
                    key: message.key ? message.key.toString() : null,
                    value: message.value ? message.value.toString() : null,
                });
                await stopFn();
            },
        });

        // Simulate a message arrival by invoking the stored handler
        const payload = {
            topic: 't',
            partition: 0,
            message: {key: Buffer.from('k'), value: Buffer.from('v')},
        };

        // Find the handler passed to run and invoke it
        const [[runArg]] = cons.run.mock.calls;
        await runArg.eachMessage(payload);

        await runPromise;

        expect(received).toEqual([{topic: 't', partition: 0, key: 'k', value: 'v'}]);
        expect(cons.connect).toHaveBeenCalled();
        expect(cons.subscribe).toHaveBeenCalledWith({topic: 't', fromBeginning: true});
        expect(cons.stop).toHaveBeenCalled();
        expect(cons.disconnect).toHaveBeenCalled();
    });
});
