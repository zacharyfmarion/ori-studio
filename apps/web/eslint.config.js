import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// Every persisted preference must go through the centralized storage layer
// (src/lib/storage.ts) so keys stay namespaced under `oristudio:` and access is
// SSR-/private-mode-guarded. Direct `localStorage`/`sessionStorage` is banned.
const NO_DIRECT_STORAGE =
  'Do not use localStorage/sessionStorage directly. Use the helpers in src/lib/storage.ts (storageKey + readString/writeString/readJson/writeJson/readBoolean/writeBoolean).';

const noDirectStorageGlobals = [
  'error',
  { name: 'localStorage', message: NO_DIRECT_STORAGE },
  { name: 'sessionStorage', message: NO_DIRECT_STORAGE },
];

const noDirectStorageProperties = [
  'error',
  { object: 'window', property: 'localStorage', message: NO_DIRECT_STORAGE },
  { object: 'window', property: 'sessionStorage', message: NO_DIRECT_STORAGE },
  { object: 'globalThis', property: 'localStorage', message: NO_DIRECT_STORAGE },
  { object: 'globalThis', property: 'sessionStorage', message: NO_DIRECT_STORAGE },
];

export default tseslint.config(
  {
    ignores: ['dist', 'src/generated'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-restricted-globals': noDirectStorageGlobals,
      'no-restricted-properties': noDirectStorageProperties,
    },
  },
  {
    // The storage layer itself is the single sanctioned localStorage caller.
    files: ['src/lib/storage.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },
  {
    // Tests may seed/inspect/spy on raw storage to verify persistence behavior.
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  }
);
