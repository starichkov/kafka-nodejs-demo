/* eslint-env jest */

import {describe, expect, test} from "@jest/globals";

describe('parseBrokers', () => {
    test('returns array as-is', async () => {
        const {parseBrokers: parseBrokersProducer} = await import('../../src/producer.js');
        const {parseBrokers: parseBrokersConsumer} = await import('../../src/consumer.js');
        const arr = ['localhost:9092', '127.0.0.1:9093'];
        expect(parseBrokersProducer(arr)).toEqual(arr);
        expect(parseBrokersConsumer(arr)).toEqual(arr);
    });

    test('splits comma-separated string and trims', async () => {
        const {parseBrokers: parseBrokersProducer} = await import('../../src/producer.js');
        const {parseBrokers: parseBrokersConsumer} = await import('../../src/consumer.js');
        const input = ' localhost:9092 , 127.0.0.1:9093 ';
        const expected = ['localhost:9092', '127.0.0.1:9093'];
        expect(parseBrokersProducer(input)).toEqual(expected);
        expect(parseBrokersConsumer(input)).toEqual(expected);
    });

    test('removes PLAINTEXT:// prefix if present', async () => {
        const {parseBrokers: parseBrokersProducer} = await import('../../src/producer.js');
        const {parseBrokers: parseBrokersConsumer} = await import('../../src/consumer.js');
        const input = 'PLAINTEXT://localhost:9092,PLAINTEXT://127.0.0.1:9093';
        const expected = ['localhost:9092', '127.0.0.1:9093'];
        expect(parseBrokersProducer(input)).toEqual(expected);
        expect(parseBrokersConsumer(input)).toEqual(expected);
    });

    test('returns empty array for invalid input', async () => {
        const {parseBrokers: parseBrokersProducer} = await import('../../src/producer.js');
        const {parseBrokers: parseBrokersConsumer} = await import('../../src/consumer.js');
        expect(parseBrokersProducer(undefined)).toEqual([]);
        expect(parseBrokersConsumer(undefined)).toEqual([]);
        expect(parseBrokersProducer(null)).toEqual([]);
        expect(parseBrokersConsumer(null)).toEqual([]);
    });
});
