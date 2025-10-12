import {describe, test, expect} from '@jest/globals';
import {parseBrokers} from '../src/utils.js';

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
