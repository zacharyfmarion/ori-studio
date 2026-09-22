# Localized default document names

## Goal

A user running the app in any of the eight target locales sees new documents
named in their language — the tab title on `/edit`, a new design tab, the
box-pleat and tree defaults, and the synthesized `.osf` filename — instead of
the hard-coded English `Untitled`, `Untitled CP`, `Untitled Design`,
`Untitled BP`.

## Approach

- One helper module, `apps/web/src/i18n/documentNames.ts`, holds every default
  name as a literal-key `t()` call (the extractor only sees literals), in the
  shape of `enumLabels.ts` / `supersetFeatureLabels.ts`.
- Pure `lib/`, `engine/` and `platform/` modules take a `t: TFunction`
  parameter defaulting to the shared `identityTranslate` (the English inline
  default), the way `lib/workspaceCapabilities.ts` already does. They never
  import the i18n instance.
- Store slices and runtimes, which already import the app `i18n` instance for
  toasts and dialogs, pass `i18n.t`. The one React site, `useWindowTitle`,
  passes the `t` from `useTranslation`.
- Decision 1 — persisted names: a document's title is written into the `.osf`,
  so a localized default is saved in the creator's language (as macOS "Untitled"
  documents are). The `nativeProjectFile.ts` fallbacks are on the *write* side
  and get the writer's language too; reads take titles verbatim.
- Decision 2 — the synthesized filename follows the title. `defaultNativeFilename`
  is `exportFilename(title, 'osf')`, so it already derives from the title; the
  only thing stopping a non-ASCII name was the ASCII-only sanitizer, which turned
  any non-Latin title (a project a Japanese user names "鶴" too) into `Untitled`.
  The sanitizer now keeps Unicode letters, marks and digits and strips only
  what a filesystem or a shell would object to.
- Internal source refs (`Untitled.cp`, `Untitled.bps`, `generated-crease-pattern.fold`)
  are not user-facing names and stay as they are.
- Two places cannot simply read `i18n.t` at the right moment, and each got the
  smallest fix that closes it:
  - The store's initial state runs at module load, before any catalog. Its
    placeholders (workspace title, synthesized filename, the chooser tab) are
    named again on i18next's `languageChanged`, touching only a name that still
    equals the placeholder — an established project or a renamed tab keeps its
    name.
  - A cold `/edit` provisions its blank crease pattern as soon as the wasm
    worker is up, and in dev the worker beats the catalog (measured: the
    document came out "Untitled CP" under `ja`). `createBlankOristudioCpDocument`
    now awaits the worker and a bounded catalog wait together
    (`whenCatalogReady`, 2 s cap), so the title is read once both are in.

## Affected Areas

- `apps/web/src/i18n/documentNames.ts`, `identityTranslate.ts`, `catalogReady.ts` (new)
- `apps/web/src/lib/{oristudioCpStarterDocument,nativeProjectFile,creasePatternImport,sampleProject,workspaceCapabilities}.ts`
- `apps/web/src/engine/{snapshotMapper,oristudioBpSnapshotMapper}.ts`
- `apps/web/src/platform/{exportFilename,windowTitle}.ts`, `hooks/useWindowTitle.ts`
- `apps/web/src/store/workspaceStore/{store,designTabs,designContent,oristudioCpRuntime,oristudioBpRuntime}.ts`
  and `slices/{projectSlice,creasePatternSlice}.ts`
- `apps/web/public/locales/*/common.json` + `.hashes.json`

## Checklist

- [x] Helper module with literal-key `t()` calls, plus the shared identity translator
- [x] Lib/engine/platform modules take `t` with the identity default
- [x] Store slices and runtimes pass `i18n.t`; `useWindowTitle` passes its `t`
- [x] `exportFilename` keeps Unicode letters; tests for CJK and accented titles
- [x] Helper test: the translated string comes back when a bundle is present
- [x] Initial-state placeholders re-seeded on `languageChanged`, with tests
- [x] Blank CP waits (bounded) for the catalog; verified on a cold `/edit` under `ja`
- [x] `i18n:extract`, eight translations, `i18n:stamp`, `i18n:check` green
- [x] lint, typecheck, vitest green
- [ ] Draft PR against `main` recording both decisions
