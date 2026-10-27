import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'third_party/**',
      'docs/mockup/**',
      'original/**',
      '.wrangler/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/core/**/*.ts'],
    languageOptions: { globals: globals['shared-node-browser'] },
  },
  {
    // The Worker runs in Cloudflare's runtime: fetch, Request, Response, crypto and the like.
    files: ['packages/worker/**/*.ts'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.node } },
  },
  {
    files: ['packages/app/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['**/*.config.{js,ts}', 'scripts/**/*.mjs', 'tools/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
