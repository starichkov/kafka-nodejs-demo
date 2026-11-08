import globals from 'globals';
import eslint from '@eslint/js';

export default [
    {
        ignores: ['coverage/**', 'node_modules/**'],
    },
    eslint.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.jest,
                ...globals.node,
            },
        },
        rules: {
            // Kafka readiness and shutdown paths intentionally swallow cleanup errors.
            'no-empty': ['error', { allowEmptyCatch: true }],
            // Some integration callbacks and test promises are intentionally retained for control flow.
            'no-unused-vars': 'off',
        },
    },
];
