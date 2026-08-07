// Flat config (ESLint 9+). Deliberately not "maximum strictness": this is a
// solo-dev game codebase where the rules that pay for themselves are the ones
// that catch REAL bugs — typos in identifiers, unreachable code, accidental
// globals, forgotten awaits. Style is Prettier's job, not the linter's.
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.meshy-cache/**',
      'public/**',
      'assets/**',
      '**/*.min.js',
      'J.O.B*',
    ],
  },

  // ---- browser: the game itself ----
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        __APP_VERSION__: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // an unused arg is usually an interface contract; an unused local is a bug
      'no-unused-vars': ['warn', {
        args: 'none',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'no-console': 'off',              // the console IS the debug channel here
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['warn', 'smart'],
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-implicit-globals': 'error',
      'require-atomic-updates': 'off',
      'no-unsafe-optional-chaining': 'error',
      'no-constant-binary-expression': 'error',
      'no-self-compare': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-promise-executor-return': 'error',
    },
  },

  // ---- node: relay server, asset pipeline, electron shell ----
  {
    files: ['server.js', 'scripts/**/*.{js,mjs}', 'electron/**/*.cjs', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-console': 'off',
    },
  },
  {
    files: ['electron/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },

  // ---- tests ----
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': 'off' },
  },

  prettier,
];
