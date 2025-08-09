/* eslint-env jest */
import {jest, describe, test, expect, beforeEach} from '@jest/globals';

// Mock kafkajs as an ESM default export
jest.unstable_mockModule('kafkajs', () => {
    const send = jest.fn();
    const connect = jest.fn();
    const disconnect = jest.fn();
    const producer = () => ({connect, send, disconnect});
    const Kafka = function Kafka() {
        return {producer};
    };
    return {default: {Kafka, logLevel: {NOTHING: 0}}};
});

describe('producer (unit, mocked kafkajs)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('parseBrokers works with string and array', async () => {
        const {parseBrokers} = await import('../src/producer.js');
        expect(parseBrokers('localhost:9092')).toEqual(['localhost:9092']);
        expect(parseBrokers(['a:1', 'b:2'])).toEqual(['a:1', 'b:2']);
        expect(parseBrokers('PLAINTEXT://kafka:9092, other:1234')).toEqual(['kafka:9092', 'other:1234']);
        expect(parseBrokers(123)).toEqual([]);
    });

    test('produceMessage sends string message and disconnects', async () => {
        const {default: kafkajs} = await import('kafkajs');
        const {produceMessage} = await import('../src/producer.js');
        const kafka = new kafkajs.Kafka();
        const prod = kafka.producer();

        await produceMessage({brokers: 'b:1', topic: 't', key: 'k', message: 'v'});

        expect(prod.connect).toHaveBeenCalled();
        expect(prod.send).toHaveBeenCalledWith({
            topic: 't',
            messages: [
                {key: 'k', value: 'v'},
            ],
        });
        expect(prod.disconnect).toHaveBeenCalled();
    });

    test('produceMessage stringifies non-string message', async () => {
        const {default: kafkajs} = await import('kafkajs');
        const {produceMessage} = await import('../src/producer.js');
        const prod = new kafkajs.Kafka().producer();

        await produceMessage({brokers: 'b:1', topic: 't', message: {a: 1}});

        const [[call]] = prod.send.mock.calls;
        expect(call.messages[0].value).toBe(JSON.stringify({a: 1}));
        expect(call.messages[0].key).toBe(null);
    });
});
