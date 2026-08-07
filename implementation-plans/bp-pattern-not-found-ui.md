# BP "Pattern not found" — make the warning point at something

## Goal

When the BP editor cannot find a stretch pattern, the user should be able to see
**which flaps** are involved, **where on the sheet** they are, and **what to do
about it**. Today the warning names an internal class ("stretch repositories"),
is not clickable, highlights nothing, and refers to an entity (a stretch) that
has no representation anywhere in the UI for the file that triggered it.

Repro: `test_files/bp/patter_not_found.osf` (BP Editor pane, on load).

## Root cause

The engine knows exactly which stretches failed. Every layer above it throws
that away.

### 1. The engine derives 8 stretch repositories and reduces them to one bool

`active_layout_repositories` (`crates/oristudio-bp/src/layout.rs:1856`) builds
repositories from the **tree geometry** — the persisted `layout.stretches` list
is only a source of config/pattern *overrides*, not the set of stretches.
`project_graphics_snapshot` (`crates/oristudio-bp/src/io/cp.rs:143`) then walks
them and collapses every failure into a single flag
(`crates/oristudio-bp/src/io/cp.rs:149-157`):

```rust
if !repo.initialize_selected_pattern_with_tree(&tree)? {
    pattern_not_found = true;
}
```

For the repro file that loop sees:

| stretch id | flaps (display labels) | configurations | pattern |
| --- | --- | --- | --- |
| `3,10` | D, K | 1 | ✅ |
| `4,11` | E, L | 1 | ✅ |
| `7,10` | H, K | 1 | ✅ |
| `7,11` | H, L | 1 | ✅ |
| **`10,12,14,22`** | **K, M, O, W** | **0** | ❌ |
| **`11,13,15,22`** | **L, N, P, W** | **0** | ❌ |
| `18,22` | S, W | 1 | ✅ |
| `19,22` | T, W | 1 | ✅ |

Two four-flap overlaps fail, and they fail at the **configuration** stage
(`configs=0`), not the pattern stage — a distinction the engine has and the UI
never sees. `LayoutGraphicsSnapshot` (`crates/oristudio-bp/src/io/cp.rs:46-57`)
exports `patternNotFound: bool` and nothing else. Contrast
`InvalidJunctionSnapshot` right below it, which correctly carries `id`,
`flapIds`, and `polygon`.

### 2. The web mapper tries to attach the diagnostic to a stretch that cannot exist

`projectDiagnostics` (`apps/web/src/engine/oristudioBpSnapshotMapper.ts:145`)
looks for a patternless entry in `packing.stretches` and falls back to a generic
message when it finds none. It always finds none, for two compounding reasons:

- `packing.stretches` is built from the **persisted** layout
  (`oristudioBpSnapshotMapper.ts:299`:
  `project.design.layout.stretches.map(packingStretch)`), and the repro file has
  `"stretches": []`. That is not a corrupt file — upstream only persists a
  stretch whose config/pattern selection deviates from the default.
- A patternless stretch is *by construction* never persisted. Upstream's
  `patternTask` (`third_party/box-pleating-studio/src/core/design/tasks/pattern.ts:23-27`)
  calls `$removeStretch(id)` precisely when `!repo.$pattern`.

So the `patternlessStretches.length > 0` branch is dead code, and the fallback at
`oristudioBpSnapshotMapper.ts:160-166` — with no `selection` — is the only branch
that ever runs.

### 3. The panel renders an unselectable diagnostic as inert text

`BpPackingAlerts` (`apps/web/src/components/panels/BpPackingPanel.tsx:1862-1881`)
renders a `<button>` when `diagnostic.selection` is set and a
`<div role="status">` when it isn't. No selection → a dead card. It also renders
over the contextual flap editor, which is why the screenshot shows it covering
the Name/R/W/H toolbar.

### 4. Collateral: the entire stretch/device interaction layer is inert on a fresh load

Because `packing.stretches` and `packing.devices`
(`oristudioBpSnapshotMapper.ts:299,303`) both derive from the persisted layout:

- `BpPackingStretchNav` is gated on `activeStretch`
  (`BpPackingPanel.tsx:740-744,1824`), which needs a stretch in
  `packing.stretches`. It already has a **"No valid pattern"** label
  (`BpPackingPanel.tsx:559-563`) that can never be reached for a patternless
  stretch.
- `packingStretch` hardcodes `flapIds: []` and `riverIds: []`
  (`oristudioBpSnapshotMapper.ts:468`), so selecting a stretch highlights none of
  its flaps — `addStretch` (`oristudioBpSelection.ts:60-64`) iterates empty
  arrays. There is also no reverse link at all: `addStretch` is only reached from
  an explicit `bp-stretch` selection or from a device
  (`oristudioBpSelection.ts:72`), never from a flap.
- Verified in the browser on the repro file: 12 device primitives are drawn from
  the Rust graphics snapshot, but `packing.devices` is empty, so **none of them
  carry `data-bp-select`** — devices are not selectable or draggable, and the
  only selectable tokens on the canvas are `flap:*` and `river:*`.

That last point is a bug in its own right and is the reason a user has no path
from the warning to the geometry: there is nothing named "stretch" to click.

### What upstream does

Box Pleating Studio sets the same flag and shows a warning button in its top
toolbar that opens a modal
(`third_party/box-pleating-studio/src/app/vue/modals/note.vue`). The copy
explains the concept — the overlaps are valid, the app just doesn't have an
algorithm for them yet — rather than naming internals. Upstream also does not
localize it on the canvas, so everything below beyond that copy fix is an
**addition**, not a parity deviation: it changes no engine semantics, only which
already-computed facts cross the wasm boundary.

### Not the cause

The grey hatched box near the top centre of the sheet in the report screenshot
is unrelated — confirmed by the author as a separate, expected UI change. The
failing stretches are on the left and right of the sheet (K/M/O/W and L/N/P/W),
and a clean load of this file drew nothing at that location.

## Approach

Four phases, each shippable on its own. Phase 2 is the one that unlocks the
rest, and it fixes the inert-device bug as a side effect.

### Phase 1 — export the stretch set, not a failure flag

Rather than a `patternlessStretches` list beside the bool, export **every**
stretch the engine derives. That single field answers Phase 1's question (which
stretches failed) and Phase 2's (what stretches exist at all), and it means the
web side never has to reconstruct stretch identity from an id string.

```rust
pub struct LayoutStretchSnapshot {
    pub id: String,                  // "10,12,14,22"
    pub flap_ids: Vec<u32>,
    pub configuration_index: usize,
    pub configuration_count: usize,  // 0 => configuration search failed
    pub pattern_index: usize,
    pub pattern_count: usize,
    pub pattern_found: bool,
    pub regions: Vec<RectSnapshot>,  // one gap rectangle per junction
}
```

`LayoutRepository` gains `flap_ids` and `junction_rects`, both derived in
`new()` from the `ValidJunction`s it is built from. `flap_ids` is the sorted,
deduped junction endpoints, which is *by construction* the same list
`layout_stretch_id` joins into the id — `group_junctions` collects flaps through
a `BTreeSet`, so the two cannot drift. A test asserts the identity holds for
every stretch in the fixture.

Keep `pattern_not_found: bool` (the wasm node test and
`crates/oristudio-bp/tests/engine.rs:33` assert the current shape); derive it
from the new vector so the two can't disagree.

### Phase 2 — model the stretches the engine actually has

`packingView` should build `stretches` and `devices` from the **engine
snapshot**, with the persisted `layout.stretches` merged in as overrides, rather
than treating persistence as the source of truth. Device graphics already arrive
keyed `"<stretchId>:device:<index>"`, so the selectable device model can be
rebuilt from `layoutSnapshot.deviceGraphics` with no new engine work. Populate
`stretch.flapIds` from the stretch id, and add the reverse index so a selected
flap can name the stretches it participates in.

Consequences, all free:

- `BpPackingStretchNav` appears for any stretch, including patternless ones, and
  its existing "No valid pattern" label becomes reachable.
- Devices become selectable and draggable on a freshly opened file.
- Selecting a stretch highlights its flaps, which is what makes the alert able to
  point at K, M, O, W.

### Phase 3 — the UI

- **Per-stretch diagnostics.** With Phase 1+2 the live branch in
  `projectDiagnostics` fires: one diagnostic per failing stretch, each with
  `selection: { kind: 'bp-stretch', id }`, so the alert becomes a `<button>`
  that selects the group.
- **Copy.** Drop "stretch repositories". Name the flaps and say what it means:
  primary line "No crease pattern for the K, M, O, W overlap"; secondary line
  explaining that the overlap is legal but unsupported, and that moving one of
  the flaps apart or enlarging the sheet usually resolves it. Use
  `configurationCount === 0` to distinguish "no configuration found" from
  "configuration found, no pattern" — different advice.
- **Canvas affordance.** Mark the failing stretch on its own "No pattern" layer,
  with a toggle beside "Conflicts". What gets marked is the **flaps**, ringed on
  their clearance shape: a stretch's own region is the gap *between the flap
  tips*, which for point flaps at opposite ends of the sheet is a 10×8 box on a
  20×20 sheet — drawn unasked it reads as "most of your design is broken". The
  region is revealed on selection instead, where its size is information rather
  than alarm.
- **The stretch navigator itself.** It rendered both steppers unconditionally,
  so the common case was `Config 1/1 Pattern 1/1` with four dead arrows, and the
  patternless case was `Config — Pattern —` beside "No valid pattern": an empty
  picker. Upstream never shows either — its `Store` gadget is `v-if="size > 1"`
  and its stretch panel substitutes a sentence when both have one option
  (`app/vue/panel/stretch.vue`). Matching that is why Config appears to be
  missing in BP Studio: it exists, it is just hidden whenever there is one
  configuration, which is nearly always. Ours now does the same, says "Only one
  pattern" for the settled case, and shows no picker at all when there is no
  pattern to pick.
- **Activation.** Clicking the alert selects the stretch, which lights its flaps
  in both the tree and the packing panes and opens the stretch navigator with
  its "No valid pattern" label.

  Camera framing was considered and deliberately left out. `zoomToElement` on a
  1×5 gap rectangle magnifies until nothing around it is visible, and a
  scroll-into-view needs viewport math that does not exist on
  `useViewportSurface` yet. Selection already highlights in both panes, which
  answers "which ones" without moving the camera under the user.
- **Placement.** The alert stack currently overlays the contextual flap editor.
  Move it clear of the contextual toolbars, and when more than the current cap
  of 3 alerts exist, show "+N more" rather than silently truncating
  (`BpPackingPanel.tsx:1852`).
- **Symmetry.** Book-fold symmetric designs produce mirrored failures in pairs
  (as here). Decide whether to collapse a mirrored pair into one alert or list
  both; listing both is simpler and honest, so prefer that unless it gets noisy.

### Phase 4 — instrumentation and tests

- Analytics: one `track` when a patternless stretch first appears, with
  `configuration_count === 0` as a boolean-ish enum and a **bucketed** flap
  count. No coordinates, no ids. Per `docs/analytics.md`.
- Rust: a fixture test asserting the two expected stretch ids for the repro
  file, so a future engine change that silently "fixes" or breaks the set is
  caught.
- Web: extend `oristudioBpSnapshotMapper.test.ts` (which already covers the
  intended per-stretch shape at line 147, against a snapshot that cannot occur
  today) with a case built from the new snapshot field.
- i18n: new strings are inline English defaults, then `npm run i18n:extract`,
  translations for all 8 locales, `npm run i18n:stamp`, `npm run i18n:check`.

## Affected Areas

- `crates/oristudio-bp/src/io/cp.rs` — snapshot shape, failure collection
- `crates/oristudio-bp/src/layout.rs` — expose repo flap ids / junction polygons
- `crates/oristudio-bp-wasm` — regenerate bindings (tracked; must be rebuilt and
  committed)
- `apps/web/src/engine/oristudioBpTypes.ts` — snapshot + diagnostic types, new
  layer id
- `apps/web/src/engine/oristudioBpSnapshotMapper.ts` — stretch/device derivation,
  diagnostics
- `apps/web/src/lib/oristudioBpSelection.ts` — flap→stretch linking
- `apps/web/src/components/panels/BpPackingPanel.tsx` — alert placement, canvas
  layer, activation. Watch the panel line cap; the canvas layer and the alert
  list are both candidates for extraction into `cp-workspace`-style modules
  rather than inline growth.
- `apps/web/src/styles/theme.css` — patternless-stretch layer styling
- `apps/web/public/locales/**` — new strings, 8 locales

## Checklist

- [x] Phase 1: `LayoutStretchSnapshot` in `LayoutGraphicsSnapshot`, bool derived
- [x] Phase 1: `patternless-stretch.sample.json` fixture + engine test
- [x] Phase 1: wasm bindings rebuilt and committed
- [x] Phase 2: `packing.stretches` derived from the engine snapshot
- [x] Phase 2: `packing.devices` derived from `deviceGraphics`; devices selectable on load
- [x] Phase 2: `stretch.flapIds` populated from the snapshot
- [x] Phase 2: lazy `completeStretch`-on-select effect removed (counts now always known)
- [ ] Phase 2: flap→stretch reverse index (deferred to Phase 3, where it is used)
- [x] Phase 3: per-stretch diagnostics with `selection`; alert is a button
- [x] Phase 3: copy rewritten in user vocabulary, flaps named, advice included
- [x] Phase 3: patternless canvas layer ("No pattern") + Layers toggle
- [x] Phase 3: stretch navigator titled by flap letters, not the raw id
- [x] Phase 3: alert stack moved to the bottom-left, clear of the contextual toolbars
- [x] Phase 3: "+N more" instead of silent truncation
- [ ] Phase 3: camera framing on activation — **not done deliberately**, see below
- [x] Phase 4: `bp pattern not found` event (bucketed properties only) + hook tests
- [x] Phase 4: web mapper tests
- [x] Phase 4: i18n extract / translate / stamp / check
- [x] Follow-up: a stepper renders only when it has more than one option
      (upstream's `Store` rule), and the navigator moved to its own component
- [x] The grey hatched box in the report screenshot: confirmed unrelated and
      expected — a separate UI change, not part of this bug
