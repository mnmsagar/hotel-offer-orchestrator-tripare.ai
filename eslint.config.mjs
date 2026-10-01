import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Workflow code runs in Temporal's deterministic sandbox: forbid I/O and non-determinism.
    files: ['src/temporal/workflows/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'http', 'https', 'crypto', 'ioredis', 'axios', 'pino'],
              message: 'No I/O in workflow code.',
            },
            { group: ['**/lib/*'], message: 'lib/ does I/O; workflows must stay deterministic.' },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Non-deterministic in workflows.' },
        { object: 'Date', property: 'now', message: 'Non-deterministic in workflows.' },
      ],
    },
  },
);
