import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': ['error', {
        checksVoidReturn: {
          attributes: false,
        },
      }],
    },
  },
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['src/app/**/*.tsx', 'src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'better-sqlite3',
            message: 'SQLite is server-only. Keep database access in API routes or server library modules.',
          },
          {
            name: '@/lib/db',
            message: 'Database access is server-only. Use an API route or server data boundary instead.',
          },
          {
            name: '@/lib/repos-server',
            message: 'Repo registry server helpers import server-only dependencies. Use client-safe repo data or an API route.',
          },
          {
            name: '@/lib/poller',
            message: 'The poller is server-only and must not be imported by UI code.',
          },
          {
            name: '@/lib/refresh',
            message: 'Refresh jobs are server-only. Trigger them through API/server code instead of UI modules.',
          },
          {
            name: '@/lib/github',
            message: 'GitHub PAT helpers are server-only. UI code should call API routes.',
          },
          {
            name: '@/lib/auth',
            message: 'Session/auth persistence is server-only. UI code should use client-safe session hooks or API routes.',
          },
        ],
        patterns: [
          {
            group: ['@/lib/*-server', '@/lib/server/**'],
            message: 'Server-only library modules cannot be imported by UI code. Use an API route or client-safe module instead.',
          },
        ],
      }],
    },
  },
  {
    files: ['*.config.js', 'ecosystem.config.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];

export default eslintConfig;
