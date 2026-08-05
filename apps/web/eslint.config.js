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
  //
  // 2936 -> 2938: fold-angle badges. Two lines — an import and a mount —
  // beside the existing measure and text overlay layers. The layer, its badge
  // planning, and its tests all live in `cp-workspace/foldAngle/`; what is here
  // is composition, which is what a panel is for.
  //
  // 2938 -> 2939: one prop, wiring the inline simulation toolbar's export
  // dropdown to `useInlineSimulations.exportView`. The verb itself is in
  // `inlineSimulation/inlineSimulationRuntime` (the exporter registry) and its
  // store binding is in the hook, scoped to the focused window like `replay` —
  // so what landed here is composition too.
  //
  // 2939 -> 2674: the diagnostic HUD moved out, whole. Its store bindings are in
  // `diagnostics/useCpDiagnosticList` and the surface is
  // `diagnostics/CpDiagnosticHud`, which takes no props — so the expand state,
  // the status memo, the entry memo, the collapse effect, and the row markup all
  // left together. This is the direction the number is for: it went down because
  // behaviour moved to where it belongs, not because a file was split in half.
  //
  // 2674 -> 2700: not a change to this file, a merge. main grew the panel by 26
  // lines while the HUD extraction was in flight — the flat-foldable-line and
  // vertex-completion work — which is the "a merge where main grew the file"
  // case named above.
  //
  // 2700 -> 2687: the canvas half of diagnostic selection came out — the marker
  // hit geometry, its prop wiring, and the select callback. Clicking a marker
  // never worked, so nothing depended on it.
  //
  // 2687 -> 2669: the tool hint's portal machinery went away. It used to hunt
  // for a slot inside another dock pane with a body-wide MutationObserver and
  // hold the result in state; the hint is now a floating window that positions
  // itself, so the panel just mounts it and passes the viewport element it
  // already tracks for its other floating surfaces.
  //
  // 2669 -> 2676: persisting the view. The binding went out first — the
  // saved camera, the `.ori` fallback angle, and the settle-debounced write-back
  // are one concern with one invariant (what is written back is what the canvas
  // is restored from), so they are `camera/useCpDocumentCamera` and reach the
  // canvas as a single spread. What is left is composition: that spread, and one
  // prop feeding `isModelAlignedBoxOperation` to the canvas so the operation
  // frame keeps a model-aligned drag box — the same shape as the
  // `activeToolRequireSnap` prop beside it.
  //
  // 2676 -> 2729: the Solve Fold Angles tool. Its behaviour is three new
  // `cp-workspace/` modules — the review state, the on-canvas option window and
  // its placement math — and the rule that a crease-picking tool starts from an
  // empty selection went out to `tools/usePickToolSelectionReset`, beside the
  // registry that defines what a crease-picking tool is. What is left here is
  // composition: mounting the hook and the layer, routing the tool's commit to
  // the review instead of the kernel, and four viewport shortcut cases in the
  // executor every other viewport verb already lives in.
  //
  // 2729 -> 2740: the shared-link loading state. Opening `/s/<id>` by id is the one
  // provisioning path that waits on the network — up to a minute while KV propagates — and
  // without this it renders as an ordinary empty editor, which is indistinguishable from
  // the link having failed. What landed is an import, a store selector and a
  // `SurfaceLoading` early return: composition, mounting a shared component on a store
  // flag, the same shape `BpEditorPanel` uses for its own readiness. Extracting eleven
  // lines of that into a hook or a child would cost more than it saved, which AGENTS.md
  // names as the wrong trade.
  //
  // 2740 -> 2741: one import. The panel used to read the store's error and render
  // its raw `message`, which is written for diagnostics and never translated. That
  // derivation is now `hooks/useWorkspaceErrorText`, shared with the start screen,
  // so the store selector it replaced left with it and the body is a line shorter
  // than before. The cap moves for the import alone.
  //
  // 2741 -> 2751: the Square generator. Its geometry is in the kernel, its params
  // UI is `toolOptions/SquareToolOptions`, and unit conversion, enum spelling and
  // the payload assembly are in `tools/squareTool` — the first draft assembled
  // the payload here and threaded the grid width down as a prop, and both moved
  // out, which is where 14 of the 24 lines went. The ten left are composition and
  // cannot be anywhere else: a three-line payload branch beside the fifteen
  // already there, and `toolPreviewColor` resolving through the same function the
  // payload does, which is the thing that stops the preview and the commit
  // disagreeing about the line type.
  'CreasePatternPanel.tsx': 2751,
  'BpPackingPanel.tsx': 2085,
  'SimulatorPanel.tsx': 1770,
  'DesignPanel.tsx': 1260,
  'BpTreePanel.tsx': 890,
  // 1080 -> 1090: a second message slot, for the note the vertex-completion
  // tool shows when the assignment it solved overrides the active line type.
  // The sentence and the rule for when to say it are in
  // `cp-workspace/tools/toolUnavailable.ts` with their own tests; the panel
  // takes a string and renders it beside the existing one. Extracting the two
  // <p> tags into a child would have cost more lines than it saved, which
  // AGENTS.md names as the wrong trade.
  //
  // 1090 -> 1110: the `completion-stops` group — where a suggested crease is
  // allowed to stop. A settings group in the settings panel is the case
  // AGENTS.md calls "a feature that genuinely belongs in a panel", and its
  // option, default, persistence and group→keys entry all live outside this
  // file.
  //
  // 1110 -> 1097: the hint became a floating window, and the window chrome went
  // to `cp-workspace/toolHint/CpToolHintWindow` rather than landing here. The
  // first pass did land here — portal, placement, collapse state and the header
  // — and tripped the cap by 8 lines, which is exactly the prompt the number is
  // for. Positioning and collapse are one concern and the same for whatever the
  // tool has to say; what is left is the tool's content, which is what this file
  // is. The placement rule and the collapse preference live beside the chrome
  // with their own tests.
  //
  // 1097 -> 1105: the window stays shut for the resting tool — the one Escape
  // and every new document land on, whose hint would otherwise be on screen most
  // of the time saying how to drag a box. Both rules it needs are outside this
  // file with their own tests: `toolHint/restingTool` (which tool is the resting
  // one) and `foldAngle/hasFoldableCpSelection` (whether the fold-angle control
  // has anything to offer, which is the one thing that still opens the window
  // there). What landed here is the composition — two predicate calls and the
  // render decision they feed. Still below the 1110 this file started the change
  // at, because the window chrome came out on the way.
  //
  // 1105 -> 1167: the mode switches for the two merged tools — Extend Line's
  // colour, Divided Line's count-vs-ratio. Two more settings groups in the
  // settings panel, the same case as `completion-stops` above; the option, its
  // default, its persistence, its group→keys entry, and the operation resolution
  // it drives all live outside this file. `ModeToolOption` is the shared control
  // both render, and it costs more lines than the two inline blocks it replaced
  // — deliberately, because two near-identical `SegmentedControl` blocks in a
  // switch is the duplication this file least needs more of.
  //
  // **The seam this file actually wants** is `CpContextToolGroup`: ~560 lines,
  // 48% of the total, a switch over setting groups that has nothing to do with
  // the panel's composition. Moving it out is the fix, and it is a change of its
  // own rather than a rider on whichever feature next trips the cap. Every raise
  // since 1090 has been another group landing in that switch, which is the
  // signal AGENTS.md says to act on — this is now overdue.
  //
  // 1167 -> 1171: the Square tool's group. Four lines — an import and a branch
  // that returns `<SquareToolOptions />` — because the group's five controls,
  // its store binding for the grid width, and its unit maths all live in
  // `cp-workspace/toolOptions/`. There was nothing left to move.
  //
  // Which makes it the next instance of exactly what the paragraph above
  // describes, and it is being recorded rather than fixed: extracting
  // `CpContextToolGroup` is a ~560-line change that would dwarf the feature
  // carrying it, and the note above already says it should not ride on whichever
  // feature next trips the cap. It is filed separately.
  'CpContextToolPanel.tsx': 1171,
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
    // `.wrangler` holds the bundles `wrangler pages dev` generates from `functions/` —
    // build output, and minified, so linting it reports on generated code rather than ours.
    ignores: ['dist', 'src/generated', '.wrangler'],
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
