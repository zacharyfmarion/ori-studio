# Persisted tool options

## Goal

Let a chosen few CP tool settings survive a reload, so a designer who works in
22.5° does not re-pick it every session.

Today `OristudioCpToolOptions` — division count, angle system, fix precision,
polygon corners, parallel width, and the rest — lives in plain `useState` in
`CreasePatternPanel`, initialised from `DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS`. Every
one of them resets on reload. There is no persistence concept for tool params at
all.

**Opt-in, not blanket.** Only params named in a registry persist. That is a
correctness boundary rather than a scoping convenience — see below.

## Approach

### Opting in and validating are the same act

The registry entry for a key *is* its validator, so a param cannot be persisted
without saying what a valid value looks like:

```ts
const PERSISTED: PersistedToolOptions = {
  angleSystemDivider: (value) => (isInteger(value, 0, 64) ? value : null),
  fixPrecision: (value) => (isFinitePositive(value) ? value : null),
  foldableLineStopsOnAux: (value) => (typeof value === 'boolean' ? value : null),
};
```

Adding a persisted param is one line. Forgetting to validate one is impossible,
which matters because the value arrives from `localStorage` — user-editable, and
stale across any release that changes a range.

### The exclusions are the point

Two params are per-invocation, and persisting them would be actively wrong:

| key | why it must never persist |
| --- | --- |
| `candidateIndex` | Which candidate was picked last time is meaningless against a different vertex's candidates, and would silently pre-select the wrong one |
| `textContent` | The text typed for one annotation would pre-fill the next |

A blanket "serialise the options struct" would ship both bugs. The registry
exists to make that impossible, and the default — not persisted — is the safe
one.

### The first set

Deliberately small. Each later addition is one line, added when someone asks:

| key | why |
| --- | --- |
| `angleSystemDivider` | The most "how I work" setting in the editor. Re-picking 22.5 every session is the complaint that motivates this |
| `angleSystemAngles` | Pairs with the divider; persisting one without the other is a half-restored state |
| `fixPrecision`, `fixPrecisionUseBp`, `fixPrecisionUse22_5` | Fix Inaccurate's tolerance is a working preference, and its two flags are meaningless apart from it |
| `foldableLineStopsOnAux` | **New**, and the reason this plan exists now. See `spatial-vertex-completion.md` |

Left ephemeral for now, all reasonable candidates later: `divisionCount`,
`divisionRatio`, `polygonCorners`, `parallelWidth`, `customFromLineType`,
`customToLineType`, `customLineType`, `customCircleColor`.

### Storage shape

`Partial<OristudioCpToolOptions>` under one new key in the existing registry
(`STORAGE_KEYS.cpToolOptions`), through `lib/storage.ts`'s `readJson`/`writeJson`
so it inherits the namespace and the unavailable-storage guard.

**No version field**, matching `measurePreferences`. Per-key validation is
strictly better than versioning for a bag of independent scalars: an unknown key
is ignored, a missing key falls back to its default, and a key whose valid range
changed falls back *individually* rather than discarding every other setting with
it. A version bump is all-or-nothing and would throw away good values to fix one
bad one.

**Global, not per-document.** These are "how I like to work", not document data —
the same call `measurePreferences` made, and for the same reason.

### Writes

On change, debounced a few hundred milliseconds, so a number field does not write
per keystroke. Values are tiny; there is no reason for anything cleverer.

### Reset

Once settings stick, someone ends up with a value they did not mean and no way to
tell which control is responsible.

**A reset in the tool panel header, scoped to the groups currently on screen** —
"put this tool back to normal", not "wipe everything I have ever configured". The
group→keys mapping is the same information `CpContextToolGroup` already switches
on to render the controls, so it is not new knowledge to keep in sync.

**It appears only when a visible setting differs from its default.** That makes
one control do both jobs: it resets, and its presence is the only signal a user
gets that something here is non-default and sticky. Without that, a persisted
setting is invisible until it surprises someone.

### Where the new flag reaches the kernel

`foldableLineStopsOnAux` rides the command payload like `grid_width` and
`selection_distance` already do — the ray extension happens in Rust, so the flag
has to get there. `buildCpCommandPayload` already special-cases
`VertexMakeAngularlyFlatFoldable` / `FoldableLineDraw` for `grid_width`, so this
joins that branch.

## Affected Areas

- `apps/web/src/lib/storage.ts` — one key added to the registry
- `apps/web/src/lib/cpToolOptionPersistence.ts` — **new**: the registry, its
  validators, read/write/normalise
- `apps/web/src/lib/oristudioCpToolSettings.ts` — `foldableLineStopsOnAux` on the
  options struct, its default, its setting group, and the group→keys map the
  reset consults
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — initialise from
  storage instead of the defaults constant; write on change
- `apps/web/src/components/panels/CpContextToolPanel.tsx` — the reset control
- `apps/web/public/locales/*` — the reset label and the aux-line setting's label

## Checklist

- [ ] `cpToolOptionPersistence.ts`: registry, per-key validators, read/write
- [ ] Unknown keys in a stored blob are dropped
- [ ] A key with a now-invalid value falls back **alone**, leaving its neighbours
- [ ] `candidateIndex` and `textContent` are never written, asserted by test
- [ ] Storage-unavailable path returns defaults rather than throwing
- [ ] Panel initialises from storage and writes on change, debounced
- [ ] Group→keys map, beside the switch that renders those groups
- [ ] Reset control, scoped to the visible groups
- [ ] Reset appears only when a visible setting is non-default
- [ ] `foldableLineStopsOnAux` end to end: setting → payload → kernel
- [ ] `i18n:check` green

## Non-goals

- **Folding `measurePreferences` in.** Display units are a different concern from
  tool params and it already works. This leaves three storage shapes rather than
  two, which is worth naming rather than pretending otherwise.
- **Per-document tool settings.** A preference follows the person, not the file.
- **Persisting every param.** The list grows one line at a time, on request.
