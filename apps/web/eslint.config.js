import js from '@eslint/js';
import globals from 'globals';
import i18next from 'eslint-plugin-i18next';
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

/*
 * Panels are composition sites, not where behavior accumulates.
 *
 * `max-lines` has no custom-message option, so if it is what sent you here: this
 * is a prompt to decide, not a ceiling. Two answers are legitimate — move the
 * behavior to where it belongs (AGENTS.md > "Panel components" says where), or
 * raise the number and justify it in the PR. What is not legitimate is making
 * the count go down without making the code better: splitting a file along no
 * conceptual seam, extracting a hook that needs a dozen arguments to work, or
 * deleting comments to fit. A raised cap with a reason beats any of those.
 *
 * Comments and blank lines are not counted, so explanation is never the cheapest
 * thing to cut.
 */

/**
 * Panels already over the cap. Lower a number as work moves out; delete the entry
 * once the file fits under PANEL_MAX_LINES.
 *
 * Raising one is allowed and sometimes right — a feature that genuinely belongs
 * in a panel, or a merge where main grew the file. The point of the entry is
 * that the raise is a visible line in a diff someone reviews, not that it never
 * happens.
 */
const OVERSIZED_PANELS = {
  // 2860 -> 2936: inline simulation windows. The behaviour is in
  // `inlineSimulation/useInlineSimulations` and `useSimulateSelection`,
  // matching `useFoldedFigures` and `useCpAnnotations`; what landed here is the
  // composition — two hook calls, the canvas layer, its floating toolbar, one
  // more case in the viewport-shortcut switch, the boxes the camera frames
  // against, and the window's arm of the two dispatches every canvas-object
  // kind passes through (selection and delete).
  // 2936 -> 2937: one prop, wiring the inline simulation toolbar's export
  // dropdown to `useInlineSimulations.exportView`. The verb itself is in
  // `inlineSimulation/inlineSimulationRuntime` (the exporter registry) and its
  // store binding is in the hook, scoped to the focused window like `replay` —
  // so what landed here is composition, which is what this file is for.
  'CreasePatternPanel.tsx': 2937,
  'BpPackingPanel.tsx': 2085,
  'SimulatorPanel.tsx': 1770,
  'DesignPanel.tsx': 1260,
  'BpTreePanel.tsx': 890,
  'CpContextToolPanel.tsx': 1080,
};

const PANEL_MAX_LINES = 800;

const maxLines = (max) => ['error', { max, skipBlankLines: true, skipComments: true }];

const NO_PANEL_KEYDOWN =
  'Do not listen for keydown in a panel. A container-scoped listener dies whenever a text editor, floating toolbar, or portalled menu takes focus, and never sees portalled content at all. Register the key in src/keyboard/ and implement it in the surface executor (AGENTS.md > Panel components).';

const noPanelKeydown = [
  'error',
  {
    selector:
      "CallExpression[callee.property.name='addEventListener'][arguments.0.value='keydown']",
    message: NO_PANEL_KEYDOWN,
  },
];

/**
 * Panels that still bind keydown directly. This is a debt register, not a
 * settled exception: delete an entry as that panel's keys move into the shortcut
 * registry, and do not add to it.
 */
const PANELS_WITH_LEGACY_KEYDOWN = [
  // Only the Delete-selected-canvas-object listener is left; it is already
  // window-scoped, so it is not the focus-coupled failure this rule targets. It
  // folds into the `edit.delete` menu action with the annotation bindings.
  'src/components/panels/CreasePatternPanel.tsx',
  'src/components/panels/DesignPanel.tsx', // space-to-pan
  'src/components/panels/BpPackingPanel.tsx', // arrow-nudge + space-to-pan
  'src/components/panels/BpTreePanel.tsx',
  'src/components/panels/SimulatorPanel.tsx',
];

export default tseslint.config(
  {
    ignores: ['dist', 'src/generated'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node-run tooling scripts (i18n extract/stamp/check, parser config, etc.).
    files: ['**/*.mjs', '**/*.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
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
  },
  {
    files: ['src/components/panels/**/*.tsx'],
    ignores: ['src/components/panels/**/*.test.tsx'],
    rules: {
      'max-lines': maxLines(PANEL_MAX_LINES),
      'no-restricted-syntax': noPanelKeydown,
    },
  },
  ...Object.entries(OVERSIZED_PANELS).map(([file, max]) => ({
    files: [`src/components/panels/${file}`],
    rules: { 'max-lines': maxLines(max) },
  })),
  {
    // Pre-existing container keydown listeners. Delete an entry as its panel's
    // keys move into the shortcut registry; do not add to this list.
    files: PANELS_WITH_LEGACY_KEYDOWN,
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Catch hardcoded user-facing text that bypasses t(). Scoped to JSX text nodes
    // (jsx-text-only) — the main regression risk — with low false-positive noise. Tests are
    // exempt; the "Ori Studio" brand name is intentionally verbatim.
    files: ['src/**/*.tsx'],
    ignores: ['src/**/*.test.tsx'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }],
    },
  }
);
