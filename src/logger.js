/**
 * Simple leveled logger with timestamp and stdout/stderr routing.
 *
 * Usage:
 *   import logger from './logger.js'
 *   logger.info('Message', {foo: 'bar'})
 *
 * Configure level via LOG_LEVEL env var: trace|debug|info|warn|error|fatal (default: info)
 */

const LEVELS = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60,
};

/**
 * Parses the log level from a string.
 * @param {string} [name] The level name.
 * @returns {string} The normalized level name (defaults to 'info' if invalid).
 */
function parseLevel(name) {
    if (!name) return 'info';
    const key = String(name).toLowerCase();
    return LEVELS[key] ? key : 'info';
}

const currentLevelName = parseLevel(process.env.LOG_LEVEL);
const currentLevel = LEVELS[currentLevelName];

/**
 * Formats log arguments into a single string.
 * Handles Error objects and stringifies plain objects.
 * @param {any[]} args Arguments to format.
 * @returns {string} Formatted string.
 */
function format(args) {
    // Join arguments similar to console, but include ISO timestamp and level
    return args
        .map((arg) => {
            if (arg instanceof Error) {
                return `${arg.message}\n${arg.stack || ''}`.trim();
            }
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                } catch {
                    return String(arg);
                }
            }
            return String(arg);
        })
        .join(' ');
}

/**
 * Creates a logger function for a specific level.
 * @param {string} levelName The level name (trace, debug, info, etc.).
 * @returns {(...args: any[]) => void} Logger function.
 */
function makeLogger(levelName) {
    const levelNum = LEVELS[levelName];
    const useErr = levelNum >= LEVELS.error;
    return (...args) => {
        if (levelNum < currentLevel) return;
        const ts = new Date().toISOString();
        const line = `${ts} [${levelName.toUpperCase()}] ${format(args)}`;
        (useErr ? process.stderr : process.stdout).write(line + '\n');
    };
}

const logger = {
    level: currentLevelName,
    trace: makeLogger('trace'),
    debug: makeLogger('debug'),
    info: makeLogger('info'),
    warn: makeLogger('warn'),
    error: makeLogger('error'),
    fatal: makeLogger('fatal'),
};

export default logger;
