import { describe, test, expect, jest } from '@jest/globals';
import { parseBrokers, waitForKafkaConnectivity } from '../src/utils.js';

// Consolidated unit tests for parseBrokers from producer/consumer tests

describe('parseBrokers unit tests', () => {
    test('parseBrokers handles array input', () => {
        const input = ['broker1:9092', 'broker2:9092'];
        expect(parseBrokers(input)).toEqual(['broker1:9092', 'broker2:9092']);
    });

    test('parseBrokers handles string input', () => {
        const input = 'broker1:9092,broker2:9092';
        expect(parseBrokers(input)).toEqual(['broker1:9092', 'broker2:9092']);
    });

    test('parseBrokers handles string input with PLAINTEXT prefix', () => {
        const input = 'PLAINTEXT://broker1:9092,PLAINTEXT://broker2:9092';
        expect(parseBrokers(input)).toEqual(['broker1:9092', 'broker2:9092']);
    });

    test('parseBrokers handles string input with whitespace', () => {
        const input = ' broker1:9092 , broker2:9092 ';
        expect(parseBrokers(input)).toEqual(['broker1:9092', 'broker2:9092']);
    });

    test('parseBrokers returns empty array for non-string non-array input', () => {
        expect(parseBrokers(null)).toEqual([]);
        expect(parseBrokers(undefined)).toEqual([]);
        expect(parseBrokers(123)).toEqual([]);
        expect(parseBrokers({})).toEqual([]);
    });

    test('parseBrokers filters out empty strings', () => {
        const input = 'broker1:9092,,broker2:9092,';
        expect(parseBrokers(input)).toEqual(['broker1:9092', 'broker2:9092']);
    });
});

describe('waitForKafkaConnectivity unit tests', () => {
    test('retries until the broker becomes ready and disconnects', async () => {
        jest.useFakeTimers();
        const describeCluster = jest.fn().mockRejectedValueOnce(new Error('not ready')).mockResolvedValueOnce({});
        const connect = jest.fn().mockResolvedValue(undefined);
        const disconnect = jest.fn().mockResolvedValue(undefined);
        const promise = waitForKafkaConnectivity({
            admin: () => ({ connect, describeCluster, disconnect }),
        });

        await jest.advanceTimersByTimeAsync(250);
        await promise;

        expect(describeCluster).toHaveBeenCalledTimes(2);
        expect(connect).toHaveBeenCalledTimes(1);
        expect(disconnect).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
    });

    test('throws after the connectivity timeout and still disconnects', async () => {
        const now = jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(11);
        const disconnect = jest.fn().mockResolvedValue(undefined);

        await expect(
            waitForKafkaConnectivity(
                {
                    admin: () => ({
                        connect: jest.fn().mockResolvedValue(undefined),
                        describeCluster: jest.fn().mockRejectedValue(new Error('not ready')),
                        disconnect,
                    }),
                },
                10,
            ),
        ).rejects.toThrow('Kafka not ready in time');

        expect(disconnect).toHaveBeenCalledTimes(1);
        now.mockRestore();
    });
});
