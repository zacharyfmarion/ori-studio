# BP stretch repository invalidation and upstream file format

## Goal

Make BP stretch pattern selection behave exactly like Box Pleating Studio.

Two defects, one shared cause — the port persists a `repo` blob and then trusts
it unconditionally:

1. **In-session pinning.** After the user changes a stretch's configuration or
   pattern, moving a flap keeps the *entire stored configuration set*, not just
   the chosen index. The old gadget is rigidly translated to the flap's new
   position instead of being regenerated for the new junction geometry, so the
   stretch renders a device that does not fit its own region. Reported as a
   stretch getting "pinned" to an option after switching; repro file
   `invalid_pytha_bug.osf` (two flaps, 16×16 sheet).
2. **The pin is baked into saved files.** `project_for_export` writes `repo`,
   which upstream deletes for non-session serialization. A saved file therefore
   reopens already pinned, with no interaction needed. The same conflation
   writes `history`, which upstream also gates on session — so the file form
   needs the split, not a one-field fix.

When this is done, `active_layout_repositories` must reproduce BP Studio's Core
for the same design and edit sequence, and a saved file must round-trip a chosen
pattern the way upstream's does.

## Background: what upstream does

Two mechanisms, neither of which the port has.

**The prototype is single-use.** The client sends
`design.$prototype.layout.stretches`
([batchUpdateManager.ts:78](../third_party/box-pleating-studio/src/client/project/batchUpdateManager.ts)),
and `$resetPrototype()` empties it after every core response
([project.ts:206](../third_party/box-pleating-studio/src/client/project/project.ts));
`State.$stretchPrototypes` is cleared each round
([state.ts:162](../third_party/box-pleating-studio/src/core/service/state.ts)).
During editing the prototype list is empty, so a rebuilt `Repository` always
searches fresh.

**The live `Repository` is invalidated by structure.**
[`Stretch.$update`](../third_party/box-pleating-studio/src/core/design/layout/stretch.ts)
compares `getStructureSignature(junctions)` — `JSON.stringify` over each
junction's `{c, f, ox, oy, sx}`, so it changes whenever the junction overlap
changes — and keeps the repo (index and all) only when the signature is
unchanged. Otherwise it constructs a new `Repository`, which starts at index 0.

**`repo` is session-only.** `JRepository` is documented as "Store all
information about the {@link Repository} **for session**", and
`JConfiguration.patterns` / `index` are "For session only"
([shared/json/pattern.ts](../third_party/box-pleating-studio/src/shared/json/pattern.ts)).
The client strips it on file save —
`if(!session) delete result.repo`
([client stretch.ts:39](../third_party/box-pleating-studio/src/client/project/components/layout/stretch.ts)).
A saved `.bps` carries `{id, configuration, pattern}`: the chosen
configuration's partitions plus the chosen pattern. On load, `configGenerator`
yields that prototype **first and then keeps searching**, so the pattern list
stays live.

## Why the port diverges

The port is stateless per call: `core_session()` builds a throwaway `BpSession`
from the design each time, and every render and stretch command rebuilds
repositories via `active_layout_repositories`. The persisted
`design.layout.stretches` is therefore the *only* memory of a stretch's state —
it is playing the role of upstream's live `Repository` object, but without the
signature guard.

- [`active_layout_repositories`](../crates/oristudio-bp/src/layout.rs) always
  passes the persisted stretch as the prototype, with no structure check.
- [`LayoutRepository::new`](../crates/oristudio-bp/src/layout.rs) takes
  `configurations` straight from `stored_repo`, sets `configurations_done =
  true`, and takes `index` from the stored repo.
- [`config_generator`](../crates/oristudio-bp/src/layout/generators.rs) returns
  the stored configurations verbatim — no search ever runs.
- Nothing invalidates the stored repo: `move_flaps` never touches
  `layout.stretches`, and `apply_tree_update` only copies tree edges.

`LayoutStretch::update` ([layout.rs](../crates/oristudio-bp/src/layout.rs)) is a
faithful port of `Stretch.$update`, signature check included — but it is
referenced only from `crates/oristudio-bp/tests/layout.rs`. It is dead code in
the product path, and `EngineState.stretches` is only ever cleared.

The stored repo is written by `switch_stretch_config`, `switch_stretch_pattern`,
`complete_stretch`, and `move_device` — which is why the user sees it after
changing the stretch type.

## Oracle evidence

Ground truth from BP Studio's headless Core, driven through the real client
sequence (`init` → `completeStretch` → `switchPattern` → `update` with an
**empty** stretch list, since `$resetPrototype` has run). Design: flap 1 at
(12,3), flap 2 at (8,9), tree distance 7.

Moving flap 1 to (13,4) — overlap should change (3,1) → (2,2):

| path | stored overlap | device ridges |
| --- | --- | --- |
| BP Studio Core | regenerated (2,2) | `[13,4]→[12,7]`, `[12,7]→[8,9]`, … |
| ours, no stored repo | regenerated (2,2) | identical to BP Studio |
| ours, after select/switch | frozen (3,1) | old device translated by exactly (+1,+1) |

At (13,3) it is starker: a correctly regenerated design has **one** pattern, but
the pinned stretch reports `patternCount: 2, patternIndex: 1`.

File round-trip, using upstream's own serializer (core stretch JSON minus
`repo`) and reloading in a **fresh process**:

| saved with | upstream reload | ours today |
| --- | --- | --- |
| pattern 0 | first ridge `[12,3]→[11,6]` | `[12,3]→[11,6]` |
| pattern 1 | first ridge `[10,8]→[8,9]` | `[12,3]→[11,6]` — **choice lost** |

So today the port parses `configuration`/`pattern` and then ignores it: the
prototype never reaches generation (see Phase 2). Switching the file format
without Phase 2 would *lose* the user's chosen pattern on save.

**Upstream quirk to preserve.** After reloading an upstream-saved file and
completing the repository, upstream reports **3** patterns where the same
configuration natively generates 2: the restored prototype sits at index 0 and
the dedup in `patternGenerator` (`Device.$getSignature`) does not remove the
duplicate. `configIndex` and `patternIndex` both come back 0. Match this; do not
"fix" it. Verify against the oracle rather than reasoning about it — an earlier
attempt to check this in-process produced a wrong answer because
`DesignController.init` does **not** clear `State.$stretches`, so a second
`init` in the same process reuses the previous `Stretch` object and its repo.
Always reload in a fresh process.

## Approach

### Phase 1 — invalidate the stored repository by structure signature

Give the persisted repo the guard upstream's live `Repository` has, checked at
the single site where the prototype is consumed.

- Add `signature: Option<String>` to `RepositoryModel`
  (`crates/oristudio-bp/src/model.rs`), `skip_serializing_if = "Option::is_none"`.
  This diverges from `JRepository`'s field list, which is acceptable precisely
  because `JRepository` never appears in an upstream `.bps` file — after Phase 2
  it never appears in ours either.
- Record the freshly computed signature whenever a repo is written
  (`LayoutRepository::to_json`, which already knows it).
- In `LayoutRepository::new`, honour `prototype.repo` **only** when its
  `signature` equals the signature computed from the current junctions.
  Otherwise ignore it and generate fresh — the `prototype.configuration` /
  `prototype.pattern` branch still applies (Phase 2).
- **A missing `signature` means "not trusted"** — regenerate. This is what
  self-heals existing Ori Studio files such as the repro, and what makes an
  imported BP Studio session blob safe.

Prefer this over invalidating eagerly in each `BpProjectSession` mutation: it is
one site that cannot be bypassed by a future mutation path, and it handles
undo/redo for free (a history step restores flap positions, the signature
matches again, and the repo is honoured). If eager invalidation is chosen
instead, it must run **after** a whole history step is applied — positions and
mementos together — not per command.

### Phase 2 — thread the `configuration` + `pattern` prototype to generation

Required before Phase 3, or the file-format change loses the user's choice.

- `LayoutRepository` must retain the prototype's `configuration`/`pattern` (it
  currently keeps only `stored_repo`).
- `init_with_tree` and `complete_with_tree` pass `None` as the prototype to
  `config_generator_with_repo`; pass the retained prototype instead so the
  existing single-prototype branch
  ([generators.rs](../crates/oristudio-bp/src/layout/generators.rs)) actually
  runs — it is currently unreachable in the product path.
- `LayoutRepository::new` already reads `prototype.pattern` for `is_valid`;
  that line starts mattering.
- This also fixes legacy-file restoration: `io/migrations.rs` already migrates
  rc0/rc1 stretches into `{configuration, pattern}` shape, and those patterns
  are silently dropped today.

### Phase 3 — session vs file serialization

Mirror `Project.toJSON(session?: true)`.

- Split `project_for_export` into a session form and a file form.
  - **Session** (keep `repo`): `bp_project_snapshot` and the project returned
    from every mutation. The frontend reads `stretch.repo` in
    `oristudioBpSnapshotMapper.ts` for `completed`, `configIndex`, and
    `configCount`, so this cannot be stripped unconditionally.
  - **File** (drop `repo`, emit `configuration` + `pattern`): `bp_export_bps`,
    the `.osf` payload (which goes through `exportBps`), and
    `bp_export_workspace`.
- Emit the file form the way upstream does: `configuration` is the selected
  configuration's `toJSON()` **without** `patterns`/`index` (non-session), and
  `pattern` is the selected pattern. `LayoutStretch::to_json` and
  `project_session`'s stretch writers currently hardcode `configuration: None,
  pattern: None`.
- `oristudioBpSnapshotMapper.ts:562` already falls back to
  `configuration?.index`; confirm the inspector still reports sensible
  config/pattern counts for a freshly opened file.
- Drop `history` and `state` from the file form too, for the same reason and by
  the same switch. Upstream's `Project.toJSON(session?)` gates all three
  together: `history: session && this.history.toJSON()`, `state: session &&
  {...}`. We already never write `state`; `project_for_export` unconditionally
  writes `history`.

  The `history` in question is BP Studio's own ported `History` (`{index,
  savedIndex, steps}` on `model::Project`, inside the `.bps` payload) — not an
  Ori Studio workspace-level history. No other design kind persists undo.

  **This removes nothing the user can currently reach**, which is what makes it
  safe:

  - BP undo/redo is snapshot-based in the frontend and deliberately bypasses the
    ported engine command-history — see the comment on `navigateBpHistory`
    (`historySlice.ts`): "sidesteps the ported engine command-history (which
    mis-restores structural adds)". `undoOristudioBpProject` /
    `redoOristudioBpProject` exist in `oristudioBpRuntime.ts` and have **zero
    callers**.
  - Undo across save/reload does not work today regardless:
    `installBoxPleatDesign` sets `historyPast: []`, and the frontend snapshot
    stack is in-memory only.
  - `savedIndex` is never surfaced — `bp_notify_project_saved` drives
    `history.notify_save()`, but nothing reads `is_modified()` through wasm; the
    dirty flag is the store's own.

  Keep the **reader**. Stop writing, but leave `Option<History>` parsing intact:
  old files then load with no special case, and the ported v0.6 migrations that
  relocate `design.history` to top-level `history` stay meaningful (covered by
  `crates/oristudio-bp/tests/io.rs`). Removing the writer also shrinks `.osf`
  payloads.

  This closes a hole in Phase 3, since history can carry a `repo` blob past the
  `layout.stretches` stripping. Our port never *produces* `s`-tag stretch
  mementos (it only consumes them in `apply_memento`); the sole repo-carrying
  history entry we write is `complete_stretch`'s field command with prop
  `"repo"`. In-memory those entries keep the session shape, and Phase 1's
  signature check is what keeps a restored-from-history repo honest.

### Phase 4 — oracle harness

`tools/bp-studio-oracle/layout-graphics.ts` cannot express this bug and must not
be trusted for it: line 70 passes the design's stretches on **every** update,
reproducing our bug inside the oracle, and line 75 re-inits from a clean design
before printing, discarding the edit path entirely. (Same failure mode as
`angle-restricted-endpoint-grid-snap`, where the oracle reimplemented the gap
and parity stayed green.)

- Fix `layout-graphics.ts` to send `stretches: []` on update, matching the
  client after `$resetPrototype()`, and to print the state reached by the edit
  path rather than re-initialising.
- Add oracle commands for the two sequences this plan needs: (a) select →
  switch config/pattern → move flap; (b) save in file form → reload in a fresh
  process. Document the fresh-process requirement.

## Affected Areas

- `crates/oristudio-bp/src/model.rs` — `RepositoryModel.signature`
- `crates/oristudio-bp/src/layout.rs` — `LayoutRepository::new`, `to_json`,
  `init_with_tree`, `complete_with_tree`, `active_layout_repositories`
- `crates/oristudio-bp/src/layout/generators.rs` — prototype plumbing
- `crates/oristudio-bp/src/engine/project_session.rs` — stretch writers,
  `project_for_export` split, history/memento interaction
- `crates/oristudio-bp-wasm/src/lib.rs` — session vs file export surfaces
- `apps/web/src/engine/oristudioBpSnapshotMapper.ts` — non-session stretch shape
- `tools/bp-studio-oracle/` — harness fixes and new commands
- `tests/fixtures/bp-studio/` — new fixtures, generated **through upstream's
  serializer**, never hand-built

## Risks

- `LayoutStretch` / `EngineState.stretches` are dead in the product path. This
  plan does not revive them; if a later change makes `BpSession` stateful, the
  signature guard must move with it or it will be duplicated.
- Phase 3 changes what a `.osf` contains. Files saved by current builds carry
  `repo` with no `signature`, so Phase 1 makes them regenerate — correct, but it
  means an existing file's pinned pattern choice is not recoverable. Confirm
  this is the desired migration rather than attempting to reconstruct a
  `configuration`/`pattern` pair from the stale blob.
- `switch_stretch_config` / `switch_stretch_pattern` currently rely on the
  stored repo surviving between calls. They still do — within a session, where
  the signature matches.

## Checklist

- [x] Phase 1: `RepositoryModel.signature`, written by `to_json`
- [x] Phase 1: `LayoutRepository::new` honours `prototype.repo` only on
      signature match; missing signature is untrusted
- [x] Phase 1: regression test — repro design, switch pattern, move flap,
      assert device ridges equal the oracle's (and equal the no-stored-repo path)
- [x] Phase 1: regression test — opening the existing `invalid_pytha_bug`
      payload regenerates rather than reusing the stale (3,1) configuration
- [ ] Phase 2: `LayoutRepository` retains `configuration`/`pattern` prototype
- [ ] Phase 2: `init_with_tree` / `complete_with_tree` pass it to the generator
- [ ] Phase 2: test — a `{id, configuration, pattern}` design restores the saved
      pattern (fails today for pattern 1)
- [ ] Phase 3: session vs file serialization split, wired through wasm
- [ ] Phase 3: file form emits `configuration` + `pattern`, no `repo`
- [ ] Phase 3: file form omits `history` and `state`; the `History` reader and
      the v0.6 migrations stay
- [ ] Phase 3: test — an exported `.bps` has no `history`, `state`, or `repo`,
      and a file that still has them loads unchanged
- [ ] Phase 3: round-trip test — save with pattern 1, reload, matches the oracle
      (including the 3-pattern quirk)
- [ ] Phase 3: web snapshot mapper handles the non-session shape
- [ ] Phase 4: `layout-graphics.ts` sends `stretches: []` and reports the edit
      path
- [ ] Phase 4: oracle commands for both sequences, fresh-process requirement
      documented
- [ ] `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
      `cargo test --workspace`
- [ ] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`
- [ ] Rebuild the BP wasm bridge before browser checks:
      `npm --workspace @treemaker/web run build:oristudio-bp-wasm`
- [ ] Browser check: open the repro, switch pattern, drag a flap — the device
      regenerates instead of translating
