import {describe, test, expect, beforeEach, afterEach, jest} from '@jest/globals';

// Helper to (re)load the logger with a specific LOG_LEVEL
async function loadLoggerWithLevel(level) {
  jest.resetModules();
  if (level === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = level;
  }
  // Dynamic import after resetting modules ensures the module code runs with current env
  const mod = await import('../src/logger.js');
  return mod.default;
}

const ORIGINAL_ENV = process.env;

describe('logger', () => {
  let spyOut;
  let spyErr;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    spyOut = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    spyErr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('level parsing via LOG_LEVEL (covers parseLevel path with provided value)', () => {
    test('defaults to info when LOG_LEVEL is not set', async () => {
      const logger = await loadLoggerWithLevel(undefined);
      expect(logger.level).toBe('info');
    });

    test('accepts valid mixed-case names (e.g., DeBuG)', async () => {
      const logger = await loadLoggerWithLevel('DeBuG');
      expect(logger.level).toBe('debug');
    });

    test('falls back to info on invalid level', async () => {
      const logger = await loadLoggerWithLevel('not-a-level');
      expect(logger.level).toBe('info');
    });
  });

  describe('routing, formatting, and gating', () => {
    test('info logs go to stdout and include ISO timestamp, level tag, and JSON for objects', async () => {
      const logger = await loadLoggerWithLevel('trace');
      logger.info('hello', { a: 1 });

      expect(spyOut).toHaveBeenCalledTimes(1);
      const line = spyOut.mock.calls[0][0];
      // Starts with ISO timestamp and contains [INFO]
      expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(line).toContain('[INFO]');
      expect(line).toContain('hello');
      expect(line).toContain('{"a":1}');
      // Should not go to stderr
      expect(spyErr).not.toHaveBeenCalled();
    });

    test('error logs go to stderr and include error message', async () => {
      const logger = await loadLoggerWithLevel('trace');
      const err = new Error('boom');
      logger.error('oops', err);

      expect(spyErr).toHaveBeenCalledTimes(1);
      const line = spyErr.mock.calls[0][0];
      expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(line).toContain('[ERROR]');
      expect(line).toContain('oops');
      expect(line).toContain('boom');
      // Should not go to stdout for error level
      expect(spyOut).not.toHaveBeenCalled();
    });

    test('circular object falls back to String(arg) path (covers stringify catch)', async () => {
      const logger = await loadLoggerWithLevel('trace');
      const obj = {}; obj.self = obj; // circular
      logger.info(obj);

      expect(spyOut).toHaveBeenCalledTimes(1);
      const line = spyOut.mock.calls[0][0];
      expect(line).toContain('[INFO]');
      // JSON.stringify would fail; fallback is String(obj) => [object Object]
      expect(line).toContain('[object Object]');
    });

    test('level gating suppresses lower levels when LOG_LEVEL is high', async () => {
      const logger = await loadLoggerWithLevel('error');
      logger.info('should be suppressed');
      logger.error('should appear');

      expect(spyOut).not.toHaveBeenCalled();
      expect(spyErr).toHaveBeenCalledTimes(1);
      const line = spyErr.mock.calls[0][0];
      expect(line).toContain('[ERROR]');
      expect(line).toContain('should appear');
    });
  });
});
