import { defineConfig, globalIgnores } from 'eslint/config';
import tsdoc from 'eslint-plugin-tsdoc';
import promise from 'eslint-plugin-promise';
import prettier from 'eslint-plugin-prettier';
import typescriptEslintEslintPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default defineConfig([
  globalIgnores([
    '**/.DS_Store',
    '**/node_modules',
    'dist',
    'elixir',
    'php/vendor',
    '**/npm-debug.log*',
    '**/yarn-debug.log*',
    '**/yarn-error.log*',
    '**/.nyc_output',
    '**/.idea',
    '**/.vscode',
    '**/*.suo',
    '**/*.ntvs*',
    '**/*.njsproj',
    '**/*.sln',
    '**/*.sw*',
    '**/temp',
    '**/changelogs',
    'docs/gitbook/api',
    'docs/gitbook/changelog.md',
    'docs/gitbook/bullmq-pro/changelog.md',
  ]),
  {
    extends: compat.extends(
      'prettier',
      'eslint:recommended',
      'plugin:@typescript-eslint/eslint-recommended',
      'plugin:@typescript-eslint/recommended',
    ),

    plugins: {
      tsdoc,
      promise,
      prettier,
      '@typescript-eslint': typescriptEslintEslintPlugin,
    },

    languageOptions: {
      globals: {
        ...globals.node,
        Atomics: 'readonly',
        SharedArrayBuffer: 'readonly',
      },

      parser: tsParser,
    },

    rules: {
      '@typescript-eslint/no-empty-interface': [
        'error',
        {
          allowSingleExtends: false,
        },
      ],
      '@typescript-eslint/no-require-imports': 0,
      '@typescript-eslint/no-unused-vars': 0,
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',

      '@typescript-eslint/no-empty-object-type': 1,
      '@typescript-eslint/no-unsafe-function-type': 1,
      '@typescript-eslint/no-var-requires': 0,
      '@typescript-eslint/no-this-alias': 0,

      'space-before-function-paren': [
        'error',
        {
          anonymous: 'ignore',
          named: 'never',
          asyncArrow: 'always',
        },
      ],

      'arrow-parens': [
        2,
        'as-needed',
        {
          requireForBlockBody: false,
        },
      ],

      curly: 'error',
      'no-async-promise-executor': 0,
      'no-extraneous-class': 0,
      '@typescript-eslint/no-inferrable-types': 2,
      semi: 2,
      'no-bitwise': 0,
      'eol-last': 2,
      'prefer-const': 1,
      forin: 0,

      'max-len': [
        'error',
        {
          code: 120,
          ignorePattern: '^import\\s.+\\sfrom\\s.+;$',
        },
      ],

      'tsdoc/syntax': 'error',
    },
  },
]);
