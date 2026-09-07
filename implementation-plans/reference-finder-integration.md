# ReferenceFinder Integration: the References Workspace

## Goal

A **References workspace** — a fourth workspace beside Edit, Design and Simulate — that
shows the current crease pattern read-only and answers two questions about it, built on
Robert J. Lang's ReferenceFinder as compiled to WebAssembly by Mu-Tsun Tsai and Omri
Shavit (`MuTsunTsai/reference-finder`, GPL, C++ → Emscripten) and on a new planner of our
own:

1. **How do I fold this whole pattern?** An ordered precrease sequence that creases every
   line of the CP in as few folds as possible, grouped into readable rounds, with the
   auxiliary (non-CP) creases it needed called out and kept as pinches wherever a mark is
   all that is needed — auxiliary creases show in the finished model and should be
   minimised. Each step highlights on the CP view.
2. **How do I locate this reference?** Press a vertex (or a crease) in the view and see
   ranked folding sequences for it, with per-step diagrams and an exact/approximate
   verdict — ReferenceFinder's per-target problem — plus a CP-wide analysis of which
   references are hard.

The workspace is a **guide to look at while folding**. It never edits the document ("view
only for now"), persists nothing, and is left through the rail or View › Edit like Simulate.
There is no roadmap anchor for this feature; the product case is that a folder given a CP
has to *locate* its references before collapsing it, and today the app offers nothing for
that step. Analytics ship with it so we learn whether it is used.

### Model and non-goals (read this before anything else)

The V1 model is ReferenceFinder's: a **flat, open, rectangular sheet**, where each step is
one Huzita–Justin fold (O1–O7) producing one crease line, made full-length or as a pinch.
Consequently:

- A CP's segments are first merged into distinct infinite lines; collinear segments are one
  fold. Lines coinciding with the sheet outline are free.
- Folding through several layers, mountain/valley assignment, collapse order, and folded
  intermediate states are **out of scope**. The deleted `treemaker-sequence` crate was a
  fold-through planner and is not reused, mined, or restored (its removal PR #326 and the
  owner's memory note both say why).
- Sequence length = |distinct CP lines| + |auxiliary folds|. The first term is an exact
  lower bound *within the flat-sheet model* (hand folding through layers can beat it: {¼, ½,
  ¾} is three model steps, two by hand). The planner minimises auxiliary folds and, among
  equals, the number of auxiliary creases that stay visible (full-length rather than
  pinched). The search is bounded, not exhaustive, so the UI reports "N folds = M creases +
  K auxiliary (J visible)" and never says "minimum".
- Approximations are **reported, never folded**. An exactness probe classifies a CP as
  EXACT, SNAPPABLE (planned on a snapped copy) or OFF-LATTICE; for the last, the sequence
  covers the constructible lines and the rest are listed as approximate findings with their
  error. No approximate line ever becomes a reference for later steps in V1.
- The sheet must be a rectangle **in any orientation** (BP Studio exports rotated-square
  sheets); non-rectangular outlines are refused with a message in V1. Planning runs per
  connected component.
- **Nothing is written**: no creases, no snapped coordinates, no persisted workspace state.
  The only per-document state is transient store state that resets when the document
  changes.

### Decisions taken 2026-09-05 (Zach)

A separate workspace like Simulate, not an inline window and not a stepper — the editor
cannot select vertices, the workspace's own view can · view-only for now (no "apply", no
guide lines written) · rectangles in any orientation only · plan on a snapped copy
automatically, never write it back in V1 · ReferenceFinder's legibility filters scored,
never enforced · auxiliary creases pinched wherever only a mark is needed, visible
auxiliary creases are a cost · bounded search, no exhaustive certification, no "minimum" in
the UI · desktop memory measured before deciding · emsdk 6.0.9 · the new wasm is warmed
offline like the others · licence-version and package questions wait for Tsai's reply ·
entered only from the rail, View › References, or the selection floating toolbar when the
**entire CP** is selected (the Simulate button's toolbar) — a selected crease never carries
over · settings live in the toolbar, no View pane · default chords as proposed.

## Approach

### Evidence this plan rests on

Measured 2026-09-05 by (a) driving the committed `ref.wasm` from Node, (b) a JavaScript
prototype of the planner (a Node script, since removed — see the commit that deleted
`research/reference-finder-spike/`), (c) a
design panel of four reviewers plus seven adversarial verifiers who built their own probes
(their probes are in that same removed directory; the counterexample crease patterns they
built live on in `tests/fixtures/precrease/`), (d) a
four-lens review of the earlier plan against the codebase, and (e) a three-reader
reconnaissance of the Simulate workspace's wiring. The prototype has defects the panel
found (listed below), so its counts are **upper bounds** on auxiliary creases; the panel's
counts, marked ✓, are the best found by an exhaustive search to depth k **without O6**
under the prototype's own predicate — better evidence, not certified minima. The Rust crate
re-derives every expected value with the corrected predicate.

ReferenceFinder itself:

| Quantity | Measured |
| --- | --- |
| Cold database build, rank 6 (shipped default) | 1.7–2.5 s; 600,000 lines / 598,712 marks (the line cap binds; rank 7 is byte-identical) |
| Point query / **line** query at rank 6 | ~7–12 ms / ~70–100 ms (machine-dependent; lines ≈ 10× points) |
| From-source build with emcc 6.0.9 | compiles; needs `-sMIN_SAFARI_VERSION` ≥ 150000; **identical solutions** to the committed wasm across 11 queries |
| Exact constructions per target | **at most one** (one object per quantised key; `count=5` returns five *different* lines) |
| Grid lines x = k/n with no exact route at rank 6 | 17 of 42: 13 by priority/key shadowing (k/5 ×4, k/7 ×6, 3/10, 7/10, 9/10) and 4 by `MakesSkinnyFlap` (1/12, 11/12, 1/16, 15/16; aspect < 0.1). x = 1/5 and 1/12 also checked at rank 5. `numA = numD = 50000` lifts 25/42 → 38/42 at a 2.7–6 s build |
| Query settings change the answer | default `goodEnoughError = 0.005` sorts a rank-3 *approximation* above the exact rank-4 solution for x = 5/12; `count = 1` loses it; `goodEnoughError = 1e-9` puts it first |
| Seeding existing lines (rank 6) | shape robust, magnitude depends on the seed set: 0 → 5 → 10 → 20 random crossing chords: 2.5 → 7.8 → 17 → 85 s; 0 → 5 → 10 grid lines: 1.9 → 4.4 → 8.6 s. Disables the IndexedDB cache; changes answers |
| Seeding points | 20 → 2.6–3.1 s; 50 → 17–18.6 s |

The planner (closure + stuck search, defined below):

| CP | lines (targets) | constructible from the bare sheet | auxiliary folds |
| --- | --- | --- | --- |
| bird base molecule (22.5°) | 10 | 10 | 0 ✓ — its closure exercises O5/O6/O7 |
| frog base molecule | 16 | 0 | 1 ✓ (a diagonal; then O3/O7 closure) |
| synthetic 1/6 grid | 14 | 4 | 1 ✓ (e.g. y = 2x through the corner and (½, 1)) |
| kabuto | 13 | 7 | **1 ✓** (prototype: 2; the `nw_se` diagonal alone suffices) |
| Oriedita `solution_sample_1.cp` | 14 | 2 | **1 ✓** (prototype: 2; fold corner onto centre) |
| TreeMaker triad base | 9 lines, 6 border (**hexagonal sheet**) | 3/3 under the bbox model | refused by D10 in V1 — the non-rectangular refusal test |
| iguana_24 component 0 (1,774 segs, 24-grid box pleat) | 93 (89) | 2 | ≤ 2 (prototype; ~8 s incl. RF; sheet frame unverified) |
| iguana_24 component 1 (641 segs, sheet rotated 45°) | 99 (95) | 7 | ≤ 4 (prototype, bbox in-paper on a rotated sheet — **unverified**) |
| iguana_24 component 4 (451 segs, sheet rotated 45°) | 127 (123) | 123 | 0 (same caveat) |
| panel counterexamples `g3d_x19`, `x13_x38`, `x13_diag_pair`, `g3d_x112`, `claim7-cand9` | 2–7 | — | 2, 3, 3, 2, 2 ✓ (greedy: 3, 4, 4, 2 + 1 unsolved — 6 with the approx branch, 3); `claim7-cand9`'s 2 is proven without O6 routes |

Lessons that drive the design:

- "On a lattice" means *exactly expressible in some angle system*, not "grid-based": box
  pleating (0°/45°/90°, rational offsets) and 22.5° designs (offsets in ℤ[√2]/2ᵏ) both are,
  and both close under the planner's own axiom search — ReferenceFinder is not needed for
  them. Box pleating collapses ~20:1 under collinear merge and needs one landmark (the 1/3
  on a 24-grid) plus halving, so a stuck event happens once or twice per design, not per
  line. **Off-lattice** designs (freeform, TreeMaker output, hand-placed vertices, scans)
  cannot be constructed exactly by any finite fold sequence; approximating them is
  ReferenceFinder's original purpose and the workspace reports those as approximate findings.
- The prototype's greedy stuck handler ("cheapest deduped ReferenceFinder solution") was
  **+50–100 % auxiliary creases on the plan's own fixtures and order-dependent** (kabuto
  gave 1, 2 or 3 across six orderings of the same 13 lines). A forward-first search from
  the current state matched the exhaustive search on every fixture where a depth-≤ 2
  auxiliary set exists; `grid3`, `{x = 1/5}` and `thirds_and_fifths` need depth 3 (found by
  exhaustive depth-3 search in ~100 ms JS) and `x13_x19` needs O6 — **the depth-3 rule and
  the O6 constructor are load-bearing, not optional**.
- ReferenceFinder is state-blind, returns one exact construction per target, and lacks
  exact routes for common landmarks; it is the right tool for the per-target question and
  a *fallback* for planning, not the planner's engine.
- Inexact input is pathological: an image-detected CP (coordinates ~1e-3 off) had 0/84
  lines constructible and the prototype's "fold the best approximation" branch accepted 26
  approximate folds (79 auxiliary, 2,646 queries); on the synthetic `g3d_x112` the same
  branch folded x = 0.1000 for x = 1/12. That branch is deleted.
- Prototype defects the Rust port must not repeat: ReferenceFinder treats the two
  **diagonals as free** rank-1 references that never appear as steps; `diagrams[]` is
  indexed per *line* step; an O5/O6/O7 "lander" is vacuous when the point already lies on a
  line the fold maps onto itself; O4 and O7 must require the fold's intersection with the
  perpendicular reference line to lie **inside the paper**; O3's external bisector must
  pass a per-root in-paper overlap test; and the point-on-line index compared an offset
  derived from a *rounded* normal against an exact one, making every ±45° line invisible
  from every point on it (5 of kabuto's 17 lines). The fixed-point **set** of the closure is
  order-independent (482 shuffled runs: 80 each on six fixtures plus 2 on the 1,036-line
  iguana canvas), but the axiom *labels* are not (434 label changes on the bird base).

### Corpus sweep

Every fifth `.cp` of the 563-design cpoogle corpus
(`~/Documents/datasets/create-pattern-detector/scraped/native/raw/cpoogle/`, external,
never committed) — 112 real designs — through the **prototype** at rank 6, **without an
effective budget** (the prototype checks its budget only between stuck events, so a single
closure or ReferenceFinder pass runs unbounded).

| Statistic (n = 112) | Value |
| --- | --- |
| Segments per design | p50 271, p90 1,282, max 9,396 |
| Distinct target lines | p50 96, p90 252, max 1,597 (merge ratio p50 2.6 : 1 — mostly 22.5° designs; box pleating merges ~20 : 1) |
| Sheets with a non-square bounding box | 4 / 112 |
| Designs whose **every** line is constructible from the bare sheet | **74 / 112 (66 %)** |
| Stuck events | 0: 74 · 1: 28 · 2: 7 · 4: 1 · 5: 2 — 91 % need at most one |
| Auxiliary folds (prototype upper bound) | 0: 74 · 1: 13 · 2: 8 · 3: 5 · 4: 6 · 6: 1 · 8: 3 · 9: 1 · 16: 1 — **100 / 112 needed ≤ 3**; the tail (4–16) is unmeasured because 10 of those 12 ran through the deleted approx branch (as did 2 designs in the ≤ 3 group) |
| Designs whose plan was fully exact | **100 / 112 (89 %)** |
| Designs with lines ReferenceFinder could not construct exactly | 12 / 112 — all off-lattice by a residual probe written for the spike (removed with it; Phase 2's probe in `oristudio-precrease` re-derives this classification): 7 have angles off the 22.5°/15° families, 5 have 22.5° angles with offsets off the ℤ[√2]/2ᵏ lattice (hand-placed vertices or a richer lattice). None was a clean 22.5° design that RF failed on. Under D8 these get a partial plan with off-lattice findings, so ~11 % of real designs would not receive a complete exact sequence |
| ReferenceFinder used | 38 / 112 designs; 3,757 line queries total |
| Prototype wall time | p50 0.3 s; **Scale-Shaping** (1,600 lines, \|P\| = 424,534, 0 stuck) took **960 s in closure alone**; Chinese Dragon (401 lines) 96 s |

Reading: the closure does almost all the work, a stuck event is rare and shallow, and the
only designs that defeat exact planning are those whose geometry is not on a lattice. The
16-minute row is why the Rust closure gets a resumable `close(budget_ms)`, a `|P|` cap, and
a measured (not estimated) budget before shipping — the O(|L|·|P|) prototype is not the
incremental design and **no incremental closure has been measured yet**. The panel's
missing-landmark cases (1/5, 1/7, 1/12, 1/16) did not appear in this mostly-22.5° sample;
box-pleated designs on odd grids are under-represented in it.

### Decisions

**D1 — Consume ReferenceFinder as WebAssembly; do not port it.** The engine is Lang's GPL
C++; Tsai's and Shavit's contribution is the Emscripten build, JSON output, database
persistence, axiom priorities, scoring, and the seeding feature. A Rust port would carry all
of that across (the shape of the Box Pleating Studio friction) and would still be GPL as a
derivative. Whether we build from vendored source or consume a package he publishes is the
question in flight with him; the plan below assumes vendoring and changes only D2 if he
prefers a package.

**D2 — Vendor `src/core` and build the wasm ourselves; never track the binary.** Curated
subset at `third_party/reference-finder/` (Flat-Folder shape): `src/core/**`, `makefile`
(the authoritative flag list), `LICENSE`, **`package.json`** (the only file stating a GPL
version), `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `.clang-format`, `.clang-tidy`;
omit the React app, locales, icons, `pnpm-lock.yaml`, and upstream's committed
`src/lib/ref.{js,wasm}`. The vendored `makefile` is never driven directly (its
`RFVersion.h` rule shells out to `pnpm gulp`, and it writes inside the vendored tree).
`scripts/build-reference-finder.mjs` (invoked from `apps/web` as
`node ../../scripts/build-reference-finder.mjs`, like the other `build:*-wasm` scripts):

- compiles with `em++` **6.0.9** (pinned in `scripts/reference-finder-emsdk.json`, shared
  with CI) using upstream's flags copied with a comment citing the makefile line,
  **`-sMIN_SAFARI_VERSION=150000`** (upstream's 120000 is rejected by emcc ≥ 6), objects
  under `target/reference-finder-obj/` (gitignored), output to
  `apps/web/src/generated/reference-finder/{ref.js,ref.wasm,ref.d.ts}` (gitignored and
  CI-asserted untracked); `--node` writes a second `-sENVIRONMENT=worker,node` link to
  `artifacts/reference-finder-node/` (gitignored) for tests;
- is up to date when the outputs are newer than every `third_party/reference-finder/src/core/**`
  file and the script itself, so the `pre*` hooks stay cheap;
- when `em++` is absent **and** the output is absent, fetches upstream's committed
  artifact from `https://raw.githubusercontent.com/MuTsunTsai/reference-finder/<pinned
  commit>/src/lib/ref.{js,wasm}`, verifies SHA-256 values recorded beside the pinned commit,
  fails loudly on mismatch with the emsdk install hint, and still wraps the result with our
  `ref.d.ts` (the upstream glue differs: `Module.wasmMemory` read, Safari floor 120000);
  `REFERENCE_FINDER_FORCE_SOURCE=1` in CI so a fetched artifact can never satisfy a shipping
  build. The fallback exists so `npm run dev` works without Emscripten; it is **never a
  distributed artifact**.

CI adds a composite action `.github/actions/install-emsdk` (sibling of
`install-wasm-pack`; pinned version + SHA-256 of the emsdk release, `actions/cache` keyed
`emsdk-<version>-<runner.os>` for the SDK and `EM_CACHE`) before `build:wasm` in `ci.yml`
`web-client`, `deploy-pr-preview.yml`, `deploy-web.yml` and `release.yml` `frontend`.
Tauri's `beforeBuildCommand` and `setup-worktree.sh` flow through `build:wasm` and the
generated-dir copy rules unchanged. The new `.wasm` is **warmed** by the service worker
like every other kernel (~500 KB on cold start against the 7.4 MB already shipped); it is
not added to the `uncacheable` list.

**D3 — Licence posture. Approved by Mu-Tsun Tsai, 2026-09-05:** asked whether vendoring
`src/core` and building the wasm ourselves was acceptable, he answered "as far as the
license goes, that sounds perfectly acceptable" and asked in return whether we would prefer
a published package. So D2's vendored-and-built-from-source path is settled; a package
remains open and would change only D2. The version question below is still worth asking as
a follow-up, but it no longer gates the work.

Lang's original is `GPL-2.0-or-later` by his `README_src.txt`
("either version 2 … or (at your option) any later version"). Tsai's fork ships the bare
GPLv2 text under "distributed under the terms of the GNU GPL" and its `package.json` says
`GPL-2.0` (SPDX v2-only semantics); the modifications by Tsai and Shavit therefore have **no
reliable or-later grant**. Until they confirm or-later, treat the RF wasm as possibly
GPL-2.0-only. That matters because `LICENSING.md` admits the seven Apache-2.0-only runtime
npm dependencies only because the whole "can be taken as GPLv3"; a v2-only component breaks
that reasoning. Tsai has approved the vendoring; **the version question is now a
follow-up to ask him and Shavit**, carried by the outreach draft's follow-up list. GPLv2 §9's "no version stated" clause does
not apply, since a version is stated.

The whole is already GPL, so distribution terms do not change in kind, but two things do:
the RF wasm needs its **corresponding source** published (the vendored `src/core`, the build
script, and the emsdk pin — `LICENSING.md` Publishing Checklist items 1–2), and `NOTICE` /
`LICENSING.md` gain a third category — a bundled third-party binary built from vendored GPL
source — with rows for `third_party/reference-finder`,
`apps/web/src/generated/reference-finder/`, and the dev-only fallback artifact (never
deployed). The intro sentences that say every upstream is permissive become false and are
rewritten; `README.md`'s GPL sentence names both GPL works; the NOTICE section credits
Lang, Tsai **and Shavit** and records the pinned commit.

The planner crate `oristudio-precrease` is original work that consumes ReferenceFinder's
JSON at runtime from a separate worker and links no ReferenceFinder code, so it declares
`MIT OR Apache-2.0` like `oristudio-cp-detect`, with LICENSE-MIT / LICENSE-APACHE files
and a header comment stating three tiers explicitly: (1) behavioural constants and heuristic
definitions adopted from ReferenceFinder **as facts** — `minAngleSine` 0.342, the skinny-flap
aspect 0.1, the visibility rule, the trivial-Haga O5 case, the axiom-ease order, the
pinch-when-only-one-mark-is-used convention; (2) geometry derived from the Huzita–Justin
definitions (including the O6 common-tangent cubic); (3) no expression copied from
`src/core` or `src/app`. This is not a clean room — the author has read `refLine*.cpp` — so
the permissive claim rests on that discipline plus the Node cross-check, whose RF-mimicking
filter predicate lives in the test harness inside the GPL whole, not in the crate. If any
code is transcribed, the crate becomes GPL and gets its own rows.

**D4 — A References workspace, registered where Simulate is registered.** A workspace is a
`WorkspaceId` enumerated by hand in about a dozen closed switches and tables; the compiler
catches the exhaustive ones and the string-compare ones must be found by grep. The full
list is Phase 3's first checklist item; the ones that bite silently are `historySlice.ts`'s
`design-nux || simulate` bail-out (**a `references` context left out of it would run
undo/redo against the TreeMaker document**), `maskCapabilitiesForContext`'s read-only arm
(without a `references` arm the workspace would offer authoring commands), `ALL_LAYOUT_SCOPES`,
the analytics `WorkspaceScreen` and `ContextMenuSurface` unions, `shortcutScopeLabel`'s
`default` fallthrough, and roughly ten tests that hard-code the workspace list (rail order
`['edit','design','simulate']`, the View-pane table). Opening it is
`activatePanel('references')` — from the rail, from View › References (one row in
`menuDefinition.ts`; the native menu follows), or from the selection floating toolbar's
References button, which appears **only when the entire CP is selected** (the same toolbar
that shows the Simulate button; a `useOpenReferences` hook in the `useSimulateSelection`
shape) — and the store→URL sync lands on `/references`. No selected crease carries over;
targets are picked in the References view. Switching workspaces clears and rebuilds the Dockview, so the
Edit canvas is **unmounted** while References is shown: no second live CP surface, none of
the one-surface singletons contended, and nothing to persist — the active workspace never
is (`landingWorkspace.ts` derives it from documents), and the References state is a
transient `referencesSlice` like `simulatorSettings`.

Layout (`applyReferencesLayout`, cloned from `applySimulateLayout` minus the View pane):
one headerless primary panel `references`; **no View pane**, so no `LAYOUT_VERSION` bump
and no touch-drawer body — the few settings (candidate count, good-enough error, landmarks
first, show pinches) live in a toolbar popover. The primary panel composes, on the Simulate
shape: a fixed left **sidebar** (steps or candidates, as a listbox of rows with small
`StepDiagram` SVGs), a `.panel-shell` with a `.panel-toolbar` (title, summary strip
"N folds = M creases + K auxiliary (J visible)", settings popover, Recompute, export menu),
a `.panel-body` holding the CP view with an absolute overlay for loading / empty / error /
stale, and a bottom transport strip (previous/next step, previous/next candidate, a step
scrubber, an exact/approximate readout). `ReferencesPanel.tsx` is a composition site under
the 800-line panel cap; behaviour lives in `cp-workspace/references/` hooks and React-free
modules.

**D5 — The CP view is a small props-driven WebGL component we own, and picking happens in
it.** `CreasePatternWebglCanvas` (4,212 lines) has no read-only mode, takes ~80 tool props
and registers the camera, surface-press and transform-sink singletons on mount; the
simulator viewport is a 3D orbit surface with no 2D CP mode; SVG is fine to ~2k lines but a
10k-segment CP is 10k DOM nodes with Oriedita-mismatched dashes. So `ReferencesCpView`
(~500–800 lines, store-free) reuses the exported pieces: `createReglRenderer` on the
`CpRenderer` seam (probe `cpWebglSupport()` first, render `CpRendererUnavailable`
otherwise; rebuild on context loss), `UserCamera` + `fitUserCamera` + `modelViewFromCamera`,
the scene adapters (`cpGeometryStrokesToScene` with `createCpLineAppearanceResolver` and
`cpLineStyleDashPatterns`, `cpPointsToScene` with `vertexPointsFromTransport`), and
`LineHitIndex`. It must **not** carry the `cp-webgl-layer` class (the editor's floating
toolbars forward wheel events to the first such canvas) and must **not** publish into
`cpOverlayViewStore`, `cpTransformPreviewStore`, `cpCameraRegistry` or `cpSurfaceGestures`.
Input: wheel and drag pan/zoom copied from the editor's ~15 lines, pinch via
`recognisePinch` / `applyPinchToCamera` with a local pointer map; a click (< 4 CSS px
movement) hit-tests **on click only** — vertices first through a `LineHitIndex` of
zero-length vertex segments with `cpHitRadiusModel(…, CP_POINT_HIT_RATIO)`, then creases
with `CP_LINE_HIT_RATIO` — and calls `onPick`. Highlights are props: `highlightLineIds`
(selection-style stroke via the existing `CpSelectionStyle` slot), `highlightVertexIdx`,
`ghostSegments` for not-yet-folded lines through `renderer.setPreview`, markers through
`setOverlayPoints` / `setDiagnosticMarkers` (ring). No new renderer channel is needed. Ids:
vertex requests are keyed on coordinates (or `cpVertexId`), not array index, since the
document can change while a worker request is in flight; crease ids are 1-based in the hit
index and 0-based in `segEndpoints` — convert at the boundary. Expected: scene build well
under 50 ms at 10k segments, one `render()` per input event, click hit-test < 2 ms.

**D6 — Planner geometry in Rust, orchestration in TypeScript.** New crates
`oristudio-precrease` (pure geometry, planner, tests; **no `oristudio-cp` dependency**) and
`oristudio-precrease-wasm` (wasm-bindgen bridge, `Serializer::json_compatible()`), built
through `build:wasm` like the four existing bridges. TypeScript owns the ReferenceFinder
worker, the stuck loop, caching, budgets, and UI. No geometry or canonicalisation lives in
TS — which is why the crate's **frames slice ships before the workspace** (Phase 2),
exposing `sheet_frames()` so the view never computes an outline or a y-flip itself.

**D7 — ReferenceFinder is a memoized service worker with a strict FIFO.**
`apps/web/src/workers/referenceFinderWorker.ts` (comlink; lazy `createModule` with
`locateFile` fed by a `?url` import; `instantiateWasm`, never `wasmBinary`/`wasmMemory`),
owned by `store/workspaceStore/referenceFinderRuntime.ts` mirroring `cpDetectRuntime.ts`
(`getReferenceFinderClient`, `releaseReferenceFinderClient`,
`whileReferenceFinderClientAlive`, `onReferenceFinderClientLost`, `referenceFinderError`).
One command in flight at a time: `main.cpp` clears the stdin queue before printing
`Ready`, so pipelined queries hang forever. **Cancellation**: the module polls `checkCancel`
only inside the statistics command (`ConsoleStatisticsProgress`; `ConsoleDatabaseProgress`
ignores its cancel flag — verified in Phase 1), so neither a build nor a query can be
interrupted cooperatively: the only cancel is `terminate()` and rebuild, rejecting the
orphaned comlink promises first (the `cpExactSolveSession` pattern). The UI models Stop
exactly as `CpRegionSolveState` does (`stoppable` / `stopping`; render no Stop rather than a
disabled one). No `SharedArrayBuffer`, so the COOP/COEP question between `tauri.conf.json`
and `foldCancellation.ts` does not touch this feature. The planner gets **its own**
worker/DB instance so per-target settings can never change what the planner's cache was
computed from. Not an `engineHost` engine (it holds no document). On desktop both new
workers run as wasm inside WKWebView (unlike the CP kernel, which is native there), loading
`ref.wasm` through `locateFile` under the `tauri://` protocol; `npm run check:desktop` and a
Tauri dev-app smoke are in the validation set. Database rank on desktop is decided after the
Phase 4 memory measurements (rank 6 ≈ 200 MB; rank 5 is the fallback).

**D8 — Exactness probe before planning; never fold an approximation into the state.** The
probe and the lattice snap are **new code in `oristudio-precrease`** (pure geometry — the
`oristudio-cp-compiler` exactizer is a Kawasaki least-squares solve that depends on
`oristudio-cp`, returns non-square paper verbatim, and is not a lattice snap; it stays an
optional later route through the existing CP worker). Residuals in unit-sheet units:
collinear merge, vertex coincidence, angle family (nearest k·π/8, k·π/12), offset lattice
(p/2ᵏ, k ≤ 8; (p+q√2)/2ᵏ; small denominators 3, 5, 7). Classes: **EXACT** (all < tol) →
plan; **SNAPPABLE** (residuals < 2e-3 of the sheet side ≈ 0.8 in the 400 space, consistent
after snapping, and no two distinct lines within the snap radius — a merge is not a snap) →
**plan the snapped copy automatically** and show the maximum displacement in the summary
strip; **nothing is written back in V1** (a "Snap crease pattern" action is V1.1 if wanted);
**OFF-LATTICE** (12 of 112 corpus designs by the prototype's residual probe) → the closure
runs and every remaining line is listed as a finding with ReferenceFinder's best
approximation and its error, but those lines never enter the state. The finding message
carries counts of off-lattice lines and vertices. ReferenceFinder solutions count as exact
only at `err ≤ 1e-9` (measured exact solutions carry 1e-8..1e-17). A full approximate mode
that tracks per-step error through a sequence is V1.1.

**D9 — View-only.** The workspace never edits the document. The kernel insert-and-split
operation, Tauri command and store action an earlier draft required are **not** in V1; if
writing auxiliary creases into the CP as Oriedita guide lines (`Cyan3`) is ever wanted,
that work returns as V1.1 together with the fact that `insertLineSegments` does not split
crossings (`append_and_split` is `pub(crate)`) and the false comment at
`oristudioCpRuntime.ts:928-931`.

**D10 — The sheet is derived, per connected component, from border creases; V1 plans
rectangles in any orientation.** Never a bounding box: BP Studio canvases can hold several
disjoint patterns (the iguana `.osf` holds 31, whose union of outlines is 97 lines) and
treating them as one sheet let points on one part "construct" lines on another. Border
(`Black0`) lines are the free references; the border loop gives the sheet frame, and a
rectangular loop at any angle is rotated into it (16 of the iguana's 31 components are
squares rotated 45°; 15 are axis-aligned). Non-rectangular outlines (the hexagonal triad
base) are refused with a message in V1 — polygon sheets with point-in-polygon come in V1.1.
A CP with no border creases falls back to the document's paper frame (Oriedita ±200) with a
warning. **The component** is the one containing the picked vertex or crease; the
whole-pattern breakdown covers every rectangular component in turn (each its own section in
the sidebar) and lists non-rectangular ones as refused. ReferenceFinder receives `(w, h)` of
the component's sheet frame.

### Algorithm: closure + forward-first stuck search, ReferenceFinder as fallback

**Frames.** One explicit mapping Oriedita model space (y-down, default ±200) → component
sheet frame (rotation + translation from the border loop) → planner unit rectangle (y-up,
lower-left origin, longer side 1) → ReferenceFinder rectangle, all in Rust, with a test on
an asymmetric CP that would catch a vertical flip and a test on a rotated-square sheet.

**Targets.** For the breakdown, every distinct line of the component. For a picked crease,
that line (ReferenceFinder line query plus the planner's path to it). For a picked vertex,
ReferenceFinder's point query.

**State** `(L, P)`: `L` = folded lines including the four sheet edges; `P` = in-paper
pairwise intersections of `L` whose crossing angle passes a conditioning floor
(`|sin θ| ≥ 0.342`, ReferenceFinder's `minAngleSine`; `|det|` never below tolerance).

**Constructibility of a target ℓ = inverse candidate + forward certificate.** The inverse
predicates *select* witnesses; a forward construction from those witnesses must reproduce ℓ
within tolerance before the line enters `L`. No step is emitted without a certificate.

| Axiom | Inverse condition on `(L, P)` | Additional executability check |
| --- | --- | --- |
| O1 | two distinct points of P on ℓ | point separation (legibility score) |
| O2 | p ∈ P, p ∉ ℓ, reflect(p) ∈ P | — |
| O3 | m ∈ L whose reflection across ℓ is a different m′ ∈ L | per bisector root: m's in-paper segment must reflect onto m′'s in-paper segment |
| O4 | ℓ ⟂ m ∈ L and a point of P on ℓ | ℓ ∩ m inside the paper |
| O5 | a point of P on ℓ and ≥ 1 lander | — |
| O6 | ≥ 2 landers with distinct points and not the same (point, line) constraint | p₁ ≠ p₂, m₁ ≠ m₂; cubic roots polished and re-checked |
| O7 | ℓ ⟂ m ∈ L and ≥ 1 lander | ℓ ∩ m inside the paper |

A **lander** is (p, m₁) with p ∈ P, p ∉ ℓ, **p ∉ m₁**, and reflect(p) inside the paper and
on m₁ ∈ L (the `p ∉ m₁` rule excludes the vacuous case where m₁ ⟂ ℓ maps onto itself).
ReferenceFinder's further legibility filters — `sVisibilityMatters` (an edge mark or edge
line among the inputs), the "trivial Haga" O5 case, the skinny-flap rule (a flap thinner
than 0.1 of the sheet) — are **scored, not enforced** (decision): a CP line must be folded
regardless, so they set a `hard` flag and feed the ease term. The fallback therefore uses
stricter rules than the closure; this is documented.

**Closure.** Fold every constructible CP line; repeat to a fixpoint. Constructibility is
existential over witnesses drawn from `(L, P)`, so it is monotone and the fixpoint **set** is
order-independent; the *axiom label* per line is not, so the closure records **all**
applicable axioms with witnesses and presentation is a separate pass. Implementation is
incremental and two-tier: a worklist of new-line / new-point events updates per-target facts
for O1/O2/O3/O4 in O(1) per pair (O2 direction-bucketed); lander facts for O5/O6/O7 are
recomputed only when that worklist drains with targets remaining. The fixpoint is the same
in either order (monotonicity). **Measured in Phase 4** (release, M-series), superseding the
earlier estimates: the Scale-Shaping design that took the JS prototype 960 s (7,536 segments
→ 1,575 lines) closes in **1.91 s** at `|P| = 397,491` and 186 MB peak RSS — about 500×
faster. The iguana component 0 plans fully in **0.94 s** (2 auxiliary, one depth-2 stuck
event); all 31 components of `iguana_24.osf` take **3.27 s** together, the slowest single one
1.93 s. From those numbers: a point costs ~450 bytes in practice (stored twice, with an
incidence `Vec` and its own grid cell), not the 16 assumed, so the **`|P|` cap is 600,000**
(~270 MB native, about half that in wasm, with 50 % headroom over the largest design in the
563-design corpus) and the **per-stuck-event budget is 4 s** (twice the measured worst case,
so a real search is never truncated non-deterministically); the overall plan budget stays 30 s.

**Stuck handler** (remaining CP lines, none constructible):

1. **Forward search from the current state.** Enumerate every line one axiom away from
   `(L, P)` (O1–O7 with the executability checks, crossing the paper, not already in `L` or
   the CP); closure-test each candidate on a cloned state; iterative deepening to depth ≤ 2,
   **depth 3 when the candidate count is small** (~≤ 60). Score lexicographically:
   `(auxiliary folds added, visible auxiliary creases after the pinch pass, −CP lines
   unlocked after re-closure, ease sum, canonical key)`. O5/O6 candidate counts scale as
   |P|²·|L|, so the **goal-directed generator** (candidates through some `t ∩ m` or creating
   a lander for a remaining target `t`) is required, not optional, beyond small states.
   Measured in JS at stuck states with |P| = 5–11: 30–209 candidates, 4–250 ms typical,
   1.9 s worst; Rust is expected 10–50× faster (unmeasured).
2. **ReferenceFinder fallback** only when (1) finds nothing within depth/time budget. Query
   each remaining line **once from the bare sheet** with `goodEnoughError = 1e-9`,
   `count = 5` (cached by full configuration hash + line key), extract its lines, and feed
   them into (1) as additional candidates — never applied verbatim. Cost counts only lines
   that are neither folded nor remaining CP lines; a named diagonal is charged only if not
   in `L`; axiom-0 outputs are deduped against `P` (the centre costs ReferenceFinder both
   diagonals but is free once both midlines are folded).
3. **Unsolved.** If neither finds a construction, the line is reported unsolved with the
   failed budget (depth d, rank r). No invented folds.

Apply the chosen auxiliary set, re-run closure, repeat.

**Pinch pass (V1, decision).** After the sequence is fixed, every auxiliary line is
reduced to the smallest crease that still supports its downstream uses: if later steps use
it only through points it creates (intersections consumed as O1/O2/O4/O5/O6/O7 point
inputs), it becomes a pinch — one short segment around each consumed mark, so a line
consumed at two separated marks becomes two pinches; if any later step uses it **as a
line** (O3 reflection, O4/O7 perpendicular, O5/O6/O7 landing line), it stays a full crease,
flagged as a visible auxiliary crease. CP lines are always full creases. ReferenceFinder's
own diagrams follow the same convention ("a line later used only to make one intersection
is rendered as a pinch", upstream v4.1). The pinch pass never changes fold count; visible
auxiliary creases are the secondary objective of the stuck search, so among equal-length
candidate sets the one whose auxiliary lines can all be pinched wins.

**Cost model.** Primary: number of folds. Secondary: number of **visible** auxiliary
creases (full-length after the pinch pass; a pinch counts as zero — they mark the finished
model). Tertiary: the sum over all folds of an axiom-ease penalty in ReferenceFinder's
default order O2 < O3 < O7 < O6 < O5 < O4 < O1 (O2 is the most accurate fold by hand; the
count-optimal routes found in the probes use O1 auxiliary lines such as 3x + y = 1, the
least accurate), plus the `hard` flag. Then canonical line key, for determinism.

**Honest statement (decision: bounded, not exhaustive).** The forward-first handler has no
general guarantee; it matched the exhaustive (no-O6) search on every fixture with a
depth-≤ 2 solution. This is min-cost reachability over an infinite line space and no
polynomial algorithm is claimed. The summary strip shows "N folds = M creases + K auxiliary
(J visible)" plus the lower bound M; it never says "minimum". An exhaustive certify pass
(cheap at real sizes: 167–223 nodes / 5–8 ms in JS on 4–6-line CPs) stays optional V1.1.

### Tolerance policy

- **One epsilon**, `tol = 1e-6` in unit-sheet space (positions) and radians (directions),
  derived from `Epsilon::POINT = 2.5e-4` in the 400 space (`geometry/epsilon.rs`) so line
  identity agrees with the editor; exported from Rust to TS; used by the merge, the point
  index, ReferenceFinder-output dedupe and the exact filter. The prototype used 1e-7
  predicates against 1e-6 hash quanta — two tolerances — and that mismatch was the source of
  its false negatives.
- Line equality by `|n₁ × n₂| ≤ tol` and `|d₁ − s·d₂| ≤ tol` with `s = sign(n₁·n₂)`; the
  `(n, d) ~ (−n, −d)` identification is resolved at compare time, never by component
  snapping (the canonical-sign seam at `|n.x| ≈ 1e-7`).
- Indexes are tolerance-aware: points in a grid hash with pitch 4·tol and 3×3 neighbour
  probing; lines in angle buckets mod π (with wrap), each a sorted offset vector; incidence
  lists per point and per line. No string keys, no exact hashing anywhere.
- ReferenceFinder output lines are snapped to state lines within tol before being counted
  as fresh; the extracted final line must equal the query target within tol or the solution
  is refused.

### Contracts an implementer needs

- **Planner ↔ TS wire shape.** `PrecreasePlanner` is a wasm object handle held in
  `precreaseWorker.ts` across chunks. Lines cross as `Float64Array` of canonical
  `[nx, ny, d]` triples **in the planner unit frame**; `to_rf(lines)` / `from_rf(lines)` on
  the handle do the frame conversion, so TS never does geometry. `fold(lines, tags)` takes
  a `Uint8Array` of `tags ∈ {cp, aux, rf_aux}`; `remaining()` returns triples plus two
  in-frame points per line (for ReferenceFinder queries); `line_keys()` returns `u64` keys
  computed only in Rust; `sequence()` / `explain()` return `json_compatible` JSON. All
  argument types are validated at the worker API boundary in TS (a wrong-typed typed-array
  argument traps opaquely).
- **`Step`** `{ id, kind: cp | aux, line, extent: full | [[a, b], …] (pinch spans), round,
  witnesses: [{axiom, inputs: Ref[], root, who_moves}], chosen, ease, hard, err, direction:
  mountain | valley | unassigned, direction_share, side: front | back, unlocks, cpLineIds }`, `Ref ∈ {Edge, Corner, Line(id), Point(id)}`; typed refs so sentences resolve
  to "the crease from step 12" / "the intersection of steps 3 and 12"; `cpLineIds` are the
  editor's 1-based crease ids the step realises, for the view's highlight and for
  "click a step → highlight its creases".
- **`referencesSlice`** (transient, never persisted): `{ target: { kind: whole | crease |
  vertex, component, lineId?, point? } | null, plan: { steps, groups, totals, findings,
  computedAtRevision } | null, candidates: Solution[] | null, view: { activeStep,
  activeCandidate, landmarksFirst }, run: { status: idle | running | stopping | stale |
  error, startedAt } }`; results also carry `computedAtRevision` and are discarded when
  `foldArtifactRevision` / `oristudioCpDocument.loadSerial` no longer match (the request-id
  guard pattern in `creasePatternSlice.ts`). Store reads after an `await` name the design.
- **CP data.** The view renders `oristudioCpDocument.geometry` (the compact transport) with
  the user's line style, mode, line width and point size from the store. Planner and
  ReferenceFinder input is a FOLD: `parseFoldProjection(await exportOristudioCpDocumentAsFold())`,
  or `foldArtifacts.fold` when `ensureFoldArtifacts()` has already resolved — never the
  simulation-model path, which infers faces and triangulates. Staleness: key results on
  `creaseFingerprint(oristudioCpDocument.document)` (`cp-workspace/cpSegmentationArtifacts.ts`)
  plus `loadSerial`, **not** on `foldArtifactRevision`. That counter is not "every CP
  mutation": a box-, lasso- or polygon-select bumps it while changing no crease
  (`SYNC_CP_LINE_SELECTION_AFTER_OPERATIONS` in `projectSlice`), so keyed on it, selecting
  in Edit marked a valid answer stale; and CP undo/redo bumps it *alone*, so dropping it for
  `oristudioCpRevision` would miss an undo. A content hash covers both.
  On change mark results stale, show "Out of date —
  Recompute" in the panel-body overlay and enable the toolbar Recompute, **never
  auto-recompute** (runs cost seconds); re-check on mount because the dock is rebuilt on
  every switch. Empty state ("No crease pattern") when `oristudioCpDocument` is null, on the
  simulator's pattern.
- **`StepDiagram` primitives** `{kind: sheet | line | arc | point | label, …, style}` with
  `LineStyle` / `PointStyle` enums mapped from ReferenceFinder's `style` codes (lines 1–7,
  points 0–2); `viewBox` in unit-rect units, y-up → SVG y-down flip in one projector;
  planner steps synthesise the same primitives from `witnesses`, pinches drawn as short
  segments. Used only for the small sidebar thumbnails; the CP view itself is the diagram.
- **Budgets.** ReferenceFinder per-query timeout 10 s (covers a lazy 2–6 s build on first
  query); database LRU 2 with 60 s idle teardown; planner overall default 30 s
  (configurable), 4 s per stuck event (measured); `|P|` cap 600,000 points (measured; desktop value
  after the Phase 4 memory measurements). Stop on the CP-wide analysis takes effect after the
  current uncancelable query and keeps partial findings. Long runs surface as a
  `toast.loading` with Cancel (the exact-solve pattern: `createDelayedProgress({delayMs:
  3000, minVisibleMs: 1000})`) and inline in the readout.
- **Analysis cost.** A 641-segment component has ~95 lines; only the closure-unreachable
  remainder is queried at ~70–100 ms per line, so a typical CP-wide analysis is under a
  second and a fully off-lattice design ~10 s.
- **Shortcuts.** A new `references` `ShortcutScope` (fifth value on `ShortcutScope` and
  `ShortcutTarget`; `ReferencesShortcutId = 'references.nextStep' | 'previousStep' |
  'nextCandidate' | 'previousCandidate' | 'recompute' | 'toggleLandmarksFirst' |
  'resetView' | 'zoomIn' | 'zoomOut'`; a `referencesShortcut()` factory with category
  "References"; `registerReferencesShortcutExecutor` + a `case 'references'` arm in
  `executeShortcut`; pushed in `shortcutScopeStackForContext` only while an executor is
  registered; `SHORTCUT_SCOPE_PRECEDENCE` and `findShortcutShadowing`'s conditional-scope
  logic extended like `simulator`; `shortcutScopeLabel` / `shortcutActionLabel` /
  `shortcutCategoryLabel` cases). Default chords avoid the CP's bare letters so no
  duplicate-check exemption is needed: ArrowRight/ArrowLeft steps, Shift+Arrow candidates,
  `0`/Home reset view, `=`/`-` zoom, Mod+Shift+R recompute — verified against the
  `keyboard/` vitest suite. No `keydown` listener anywhere.
- **i18n.** Namespaces `panels.json` (`panels:references.*`, `panels:referencesSteps.*`),
  `common.json` (`common:workspaceRail.references`, `common:workspaceRail.tabReferences`,
  `common:capability.references`, `common:capability.showReferencesWorkspace`), `menu.json`
  (`menu:view.references`), `tools.json` (`tools:references.*` shortcut labels and the
  selection-toolbar action label),
  `errors.json` (`errors:worker.referenceFinder`, `errors:worker.precrease`),
  `toasts.json` (`toasts:references.*`); per phase: `npm run i18n:extract`, translate the
  new keys in `apps/web/public/locales/{de,es,fr,ja,ko,pt-BR,ru,zh-CN}/*.json`,
  `npm run i18n:stamp`, `npm run i18n:check`. Never `count` as an interpolation name.
- **Analytics** (central layer, enums and `bucketCount` only): `workspace viewed` is
  automatic once `'references'` joins `WorkspaceScreen` (fired by the route element, never
  the panel or store); `command invoked` covers the menu/rail/context-menu entry;
  hand-placed: `folding steps completed | cancelled | refused` `{target_kind: whole_cp |
  crease | vertex, lines_bucket, aux_bucket, visible_aux_bucket, duration_bucket,
  exactness_class: exact | snappable | off_lattice, refusal_reason: non_rectangular |
  point_cap | budget}`, `reference target picked` `{target_kind: crease | vertex}`,
  `reference batch completed` `{lines_bucket, unreachable_bucket, duration_bucket}`;
  `ContextMenuSurface` gains `'references'`. `reportError(error, { surface })` for
  swallowed worker failures.
- **Colours.** Two new tokens `--cp-reference-input` / `--cp-reference-new` in `theme.css` /
  `applyTheme.ts` for "existing references this step uses" and "the crease this step
  makes" (`--cp-selection` falls back to `--accent-primary` in themes without
  `selection.cp`, so the two would collapse); crease ink itself is never replaced.

### The References workspace

- **Entering.** The rail button and View › References open it on the whole pattern
  (`activatePanel('references')`; `/references` deep links and reloads work through the
  generic route). From Edit, the selection floating toolbar shows a References button
  **only when the entire CP is selected** — beside the Simulate button, through the same
  action catalog and a `useOpenReferences` hook in the `useSimulateSelection` shape — and it
  simply activates the panel. Nothing carries over: no crease target, no selection. There
  is no vertex picking in the editor; vertices and creases are picked in the References view.
- **Sidebar, whole-pattern mode.** The breakdown grouped by closure round and, within a
  round, by direction + axiom + input pattern into one collapsed row with a count chip
  ("fold the sixteenths horizontally: 7 creases"); auxiliary steps attach to the CP step
  they unlock and are drawn as pinches unless flagged visible; a "landmarks first" toggle
  hoists all auxiliary folds to a phase 0 (valid by monotonicity); approximate findings and
  refused components in their own sections. Selecting a row frames the step on the view,
  highlights its creases and inputs, ghosts the new line if it does not exist yet, and shows
  the step sentence built from typed refs.
- **Sidebar, target mode.** After a vertex or crease pick: ReferenceFinder's ranked
  solutions as cards (rank, step count, error, exact/approximate badge, thumbnail),
  `aria-pressed` selection; the selected candidate's steps drive the view; for a crease
  target the planner's own path to that line from the current breakdown is shown alongside
  ("starting from: bare sheet | this sequence", Phase 5 for the second). A "back to whole
  pattern" affordance returns to breakdown mode; Escape clears the pick.
- **View.** `ReferencesCpView` fills the panel body; pan, zoom, pinch, fit; click picks a
  vertex before a crease; the active step's inputs in `--cp-reference-input`, its new crease
  in `--cp-reference-new` (CP portion vs excess distinguished), a folded-so-far mask, pinch
  spans as short segments. Only one component is framed at a time; the breakdown lists
  components as sections.
- **Toolbar and transport.** Title, summary strip, Recompute (enabled when stale or idle),
  export menu (V1: copy the step list as text; SVG/PDF later); bottom strip with
  previous/next step, previous/next candidate, a step scrubber, and a readout with the
  exact/approximate badge, error and duration; a `ContextMenu` from
  `useContextMenuController('references')` built from the shortcut registry.
- **Settings popover** from the toolbar: candidate count, good-enough error, landmarks
  first, show pinches — a few `control-row`s; no View pane.
- **Empty / loading / error / stale** as an absolute overlay in the panel body on the
  simulator's pattern; Stop only when a run is stoppable; the planner and ReferenceFinder
  workers retained on entry and released on leaving the workspace (`simulatorRuntime`'s
  retain/release), diagnostics through `attachWorkerDiagnostics` and `humanizeError` cases
  for `worker_reference_finder` / `worker_precrease`.
- **"Add as existing reference"** from the upstream app is **not** offered in V1 (seeding is
  too expensive and changes answers); a guarded "Deep search" with bounded seeding is V1.1.

### Testing strategy

- Rust properties: random valid state + random axiom application → the inverse finds it
  (completeness); every inverse hit forward-verifies (soundness); fixpoint set and
  auxiliary count invariant under segment permutation and duplicate/collinear segments;
  the pinch pass never changes fold count and every pinched line's downstream uses are
  point uses inside its spans.
- Rust regressions: O4/O7 crossing outside the sheet, O3 external bisector, O6 same-line and
  same-point pairs, near-horizontal canonical seam, corner reflection, quantum-straddle
  point, x + y = ½ visibility, rotated-square sheet frame, hexagonal-sheet refusal; a
  fixture whose closure exercises O3–O7 (the bird base and the post-diagonal frog do;
  kabuto, grid6 and `solution_sample_1` reach the bare-sheet closure through O2 only).
  Fixture auxiliary counts are recorded in a manifest with the prototype's upper bound and
  the panel's best-found value; the crate **re-derives** the expected value with the
  corrected predicate (counts can move either way — removing the O3/O4/O7 false positives
  can raise them, fixing the index false negative can lower them), the manifest records the
  crate's value with a note on any difference.
- Workspace registration: `workspaces.test.ts` (rail order and labels updated
  intentionally), `layoutStore.test.ts` (defaults, coarse pointer),
  `paths.test.ts`, `menuActions.test.ts` call counts, `capabilityMask.test.ts` and
  `workspaceCapabilities.test.ts` oracles for the `references` read-only arm,
  `CanvasHistoryPills.test.tsx` "renders nothing" for `references`, `registry.test.ts`
  contexts no design owns, `shortcutRegistry.test.ts` / `shortcuts.test.ts` /
  `shortcutRuntime.test.ts` for the new scope (no duplicate-chord exemption needed).
- `ReferencesCpView`: pure pieces unit-tested (highlight-set derivation, vertex-before-line
  hit order, 1-based/0-based id conversion, pan/zoom camera math); a press test modelled on
  `CreasePatternWebglCanvas.press.test.tsx` if its regl stub is reusable; a WebGL-unavailable
  render test.
- ReferenceFinder client: the numeric encoder, JSON-line decoder, extractor and cache are
  plain modules with vitest coverage against **replay fixtures** captured from the real
  module (a line query, a mark query with its trailing diagram, a diagonal target, the
  centre, a consecutive-marks solution); the TS orchestration depends on a
  `ReferenceFinderClient` interface. The Emscripten-facing worker stays thin and is never
  imported by a vitest file (`-sENVIRONMENT=worker` refuses jsdom/Node). The `--node`
  build variant drives a Node cross-check — depth-1 constructible lines that pass
  ReferenceFinder's filters are returned by it with `err < 1e-9` — as a **`web-client` CI
  step after `build:wasm`** (same objects, second link), excluded from vitest's jsdom run.
- Web: lint (the new panel sits under the 800-line cap and the no-`keydown` rule),
  typecheck (the exhaustive switches list every missed registration), unit tests from
  `apps/web`, `i18n:check`; `npm run build:web && npm run preview` for the worker/wasm
  asset path; browser verification of the rail, View › References, the CP entry point,
  `/references` deep link and reload, stale → Recompute after editing in Edit, the View
  pane dropping into the drawer under `resize_window` mobile, and the phone bottom tab bar
  fitting four tabs; WebKit module-worker + ASYNCIFY check on the iOS simulator; the PWA
  lane's kernel assertion extended; `npm run check:desktop` and a Tauri dev-app smoke.
- Vendoring-time oracle: `tools/reference-finder-oracle/equiv.mjs` with its query-set file
  compares the from-source wasm to upstream's committed artifact (identical solutions
  expected — verified once already); runs as a `web-client` step and on every upstream bump.

### Open questions for Zach

None blocking. Settled 2026-09-05: Tsai approved vendoring and building from source. Still open with him,
as follow-ups rather than blockers: whether he would rather publish a package (changes only
D2), and the GPL version for his and Shavit's modifications (D3; if v2-only, the seven
Apache-2.0-only runtime dependencies need a decision). Desktop database rank is decided from
the Phase 4 measurements.

## Affected Areas

- `third_party/reference-finder/` (new, curated subset incl. `package.json`),
  `upstream-sync.json` (all fields the manifest test requires: `vendored_commit`,
  `vendored_commit_note`, `vendored_subset_note`, `last_checked_commit`,
  `last_checked_date`, `oracle` → `tools/reference-finder-oracle`, `watch_paths`,
  `port_map`), `.agents/skills/upstream-drift/references/reference-finder.md` + `SKILL.md`
  row, `NOTICE`, `LICENSING.md`, `AGENTS.md` (porting-discipline table), `README.md`,
  `PORTING.md`.
- `scripts/build-reference-finder.mjs`, `scripts/reference-finder-emsdk.json`,
  `.github/actions/install-emsdk/action.yml` (new); `apps/web/package.json` (two new
  `build:*-wasm` scripts chained into `build:wasm`); `.github/workflows/{ci,deploy-web,
  deploy-pr-preview,release}.yml`; `.gitignore` (`target/reference-finder-obj/`,
  `artifacts/reference-finder-node/`); `tools/reference-finder-oracle/` (new);
  `scripts/setup-worktree.sh` (verify the copy step).
- `crates/oristudio-precrease/`, `crates/oristudio-precrease-wasm/` (new, with
  LICENSE-MIT / LICENSE-APACHE), root `Cargo.toml` members + workspace dependency,
  `Cargo.lock`.
- Workspace registration: `apps/web/src/workspaces/{workspaces.ts,editingContext.ts}`,
  `apps/web/src/routing/{paths.ts,appRouter.tsx}`, `apps/web/src/store/layoutStore.ts`
  (`applyReferencesLayout`, `ALL_LAYOUT_SCOPES`),
  `apps/web/src/components/panels/PanelComponents.tsx`,
  `apps/web/src/components/WorkspaceShell.tsx`,
  `apps/web/src/commands/menuActions.ts` (`MENU_ACTION_IDS`, `VIEW_PANEL_ACTIONS`),
  `apps/web/src/menus/menuDefinition.ts`,
  `apps/web/src/lib/workspaceCapabilities.ts` (id, capability, read-only mask arm),
  `apps/web/src/store/workspaceStore/slices/historySlice.ts` (bail-out),
  `apps/web/src/store/workspaceStore/slices/referencesSlice.ts` (new) + `types.ts` +
  `store.ts`, the CP selection floating toolbar's action catalog + `useOpenReferences`
  hook beside `useSimulateSelection`,
  `apps/web/src/analytics/events.ts` (`WorkspaceScreen`, `ContextMenuSurface`, events),
  `docs/analytics.md`, `apps/web/src/keyboard/{shortcuts.ts,shortcutRuntime.ts,
  shortcutDispatcher.ts}`, `apps/web/src/i18n/shortcutLabels.ts`, and the tests named in
  "Testing strategy".
- Workspace UI: `apps/web/src/components/panels/ReferencesPanel.tsx` (composition site), `apps/web/src/cp-workspace/references/`
  (new concern: `ReferencesCpView.tsx`, `referencesActions.ts` catalog + tests,
  `useReferencesView.ts`, `useReferencesTarget.ts`, `useReferencesRun.ts`,
  `useReferencesShortcuts.ts` + `runReferencesShortcut`, `referencesContextMenu.ts`,
  `ReferencesStepsSidebar.tsx`, `StepDiagram` + `stepDiagramGeometry.ts`, adapters for
  ReferenceFinder and planner steps, `ReferenceFinderClient` + replay fixtures),
  `apps/web/src/styles/theme.css` (`.references-*` rules, reference tokens) +
  `apps/web/src/themes/applyTheme.ts`, `apps/web/src/lib/toastMessages.ts`,
  `apps/web/src/components/GlobalToasts.tsx` (long-run toast), `apps/web/public/locales/*`.
- Workers: `apps/web/src/workers/{referenceFinderWorker.ts,precreaseWorker.ts}` (new),
  `apps/web/src/store/workspaceStore/referenceFinderRuntime.ts` (new),
  `apps/web/src/lib/workerDiagnostics.ts` (`WorkerName`).
- Orphan cleanup: `crates/oracle-tests/tests/folding_sequence_phase0.rs` (its live
  `solve_flat_fold` assertions moved to the new `flat_folder_controls.rs`),
  `tests/fixtures/folding-sequence/{expected,manifest.json,visual-review.html}` (the
  `fold/*.fold` inputs stay — live 3D tests use them).
- `research/reference-finder-spike/` — the prototype, the RF driver and the design panel's
  probes. Its crease-pattern fixtures graduated to `tests/fixtures/precrease/` in Phase 4 and
  the directory was then removed; the evidence it produced is recorded in this plan.

## Checklist

### Phase 0 — prerequisites (no product code)

- [x] Ask Mu-Tsun Tsai the one question first: is he okay with vendoring `src/core` and
      building the wasm ourselves? **Yes — 2026-09-05, "as far as the license goes, that
      sounds perfectly acceptable."** He asked whether a published package would be
      preferred; answered that vendoring already works and publishing would be his burden,
      so it is his call. Still to raise, one or two at a time: the GPL version for the
      Tsai/Shavit modifications (D3), attribution wording, the `line`-on-steps and
      keyed-database-path PR offers, the two emcc-6 build notes.
- [x] Vendor `third_party/reference-finder/` at upstream `e2163f0` (v4.8.1) as a curated
      subset incl. `package.json`, with `README.treemaker.md`; `upstream-sync.json` entry
      with every required field; upstream-drift reference note + `SKILL.md` row;
      porting-discipline row in `AGENTS.md`.
- [x] `scripts/build-reference-finder.mjs` + `scripts/reference-finder-emsdk.json` (6.0.9)
      per D2 (flags, Safari floor, up-to-date check, object dir, `--node` variant,
      SHA-verified fallback fetch, `REFERENCE_FINDER_FORCE_SOURCE`), hand-written `ref.d.ts`
      incl. the `get/checkCancel/clear/print/printErr` hooks; `build:reference-finder-wasm`
      chained into `build:wasm`.
- [x] `.github/actions/install-emsdk` composite action (pinned version + SHA, cached SDK and
      `EM_CACHE`) wired into the four bundle-building workflows before `build:wasm`.
- [x] `tools/reference-finder-oracle/equiv.mjs` + query set: from-source wasm vs upstream
      artifact, identical solutions; `web-client` step.
- [x] `NOTICE` section 6 (Lang, Tsai, Shavit; pinned commit; ExplOri → 7) + intro rewrite;
      `LICENSING.md`: rewrite the "every upstream is permissive" text, add the bundled-binary
      category and rows (vendored source, generated wasm, dev-only fallback), Publishing
      Checklist items 1–2 naming the RF corresponding source (planner crate rows land with
      the crates in Phase 2); `README.md` GPL sentence names both works; `PORTING.md`
      boundary entry.
- [x] Orphan cleanup: move `folding_sequence_phase0.rs`'s live `solve_flat_fold`
      assertions into the new unconditional `flat_folder_controls.rs`, then delete the
      manifest/expected halves and `visual-review.html`; rewrite that README.

### Phase 1 — ReferenceFinder worker and client

- [x] `referenceFinderWorker.ts`: lazy module init (`locateFile` from `?url`,
      `instantiateWasm`), numeric stdin queue, `Ready`-delimited JSON-line collection,
      strict one-command FIFO (documented: `clear()` runs before `Ready`), no cooperative
      cancel (`checkCancel` is statistics-only), terminate-and-rebuild on timeout with
      orphaned promises rejected first, `WasmErrorEnvelope` normalisation.
- [x] `referenceFinderRuntime.ts` mirroring `cpDetectRuntime.ts`'s exports plus
      `simulatorRuntime`'s retain/release; database registry keyed by the full
      configuration hash, LRU 2 with idle teardown, `useDatabase = 0`; separate planner
      instance; `WorkerName` + `humanizeError` cases + i18n.
- [x] Typed client: `solvePoint`, `solveLine`, `batch` with progress; extractor per the
      rules in "ReferenceFinder client facts" (per-line-step diagram index, trailing mark
      diagram, originals, every axiom-0 step, pinch segment → line, one style-3/7 element
      asserted, final line equals target within tol); per-line cache.
- [x] Replay fixtures captured from the real module (line, mark, diagonal, centre,
      consecutive marks); vitest for encoder/decoder/extractor/cache; Node cross-check on
      the `--node` variant as a `web-client` step.
- [ ] WebKit check on the iOS simulator (module worker + ASYNCIFY); `npm run build:web &&
      npm run preview` smoke; PWA kernel assertion extended (the wasm is warmed); Tauri
      dev-app smoke of the wasm worker under `tauri://`.

### Phase 2 — planner crate A: frames, merge, exactness probe

- [x] `oristudio-precrease` (`MIT OR Apache-2.0`, three-tier header comment, LICENSE
      files): `Frame`, canonical `Line`, tolerance-aware merge, border loop → rectangle in
      any orientation → sheet frame (rotation) → per-component split, no-border fallback,
      exactness probe (EXACT / SNAPPABLE / OFF-LATTICE with residuals and the snap).
- [x] `oristudio-precrease-wasm`: `sheet_frames(segments, colors) → [{component, rect,
      to_sheet, from_sheet, exactness}]`, `to_rf` / `from_rf`; npm build script + `build:wasm`
      chain; TS-side argument validation; `wasm-pack test --node` for the JsValue round-trips;
      `LICENSING.md` rows for both crates + the "no LICENSE file of their own" paragraph
      update.
- [x] Tests: asymmetric-CP flip test, rotated-square sheet, hexagonal-sheet refusal,
      multi-component split on the iguana `.osf`, probe classification on the 12 off-lattice
      corpus designs (external, run locally) and the panel fixtures.

Phase 2 outcomes (2026-09-05): the probe also admits **rational-slope directions** (coprime
integer normals — `x13_diag_pair` and an iguana component contain slope-1/3 lines that are
exactly constructible but in neither angle family), tests offsets in ℚ, ℤ[√2] **and ℤ[√3]**,
and infers each component's odd grid factor from its axis lines instead of admitting every
odd denominator globally; snapping is limited to the finest denominator whose candidate
pitch keeps nearest-element snapping unambiguous. Wasm exports are `sheet_frames`,
`model_to_rf(frame, x, y)`, `rf_to_model(frame, x, y)` and `precrease_tolerances`.

### Phase 3 — the References workspace (vertex and crease targets, bare-sheet queries)

- [x] **Register the workspace** — every site, in one PR: `WorkspaceId` /
      `WORKSPACE_DEFINITIONS` / `WORKSPACE_BY_PANEL_ID` / `workspaceForCommandId`
      (`workspaces.ts`); `EditingContext` + `STATIC_PANEL_CONTEXTS` (`editingContext.ts`);
      `REFERENCES_PATH` + `workspacePath` / `parseWorkspacePath` + the route
      (`paths.ts`, `appRouter.tsx`); `applyReferencesLayout` + `applyDefaultLayout` arm +
      `ALL_LAYOUT_SCOPES` (`layoutStore.ts`; no View pane, so no `WORKSPACE_VIEW_PANELS`
      entry and no `LAYOUT_VERSION` bump); `panelComponents` entry;
      `workspaceIcons` / `workspaceTooltip` / `workspaceTabLabel` (`WorkspaceShell.tsx`);
      `view.references` in `MENU_ACTION_IDS` + `VIEW_PANEL_ACTIONS` + the View menu row;
      `view.references` capability + the **`context === 'references'` read-only mask arm**;
      the **`historySlice` bail-out**; `WorkspaceScreen` + `ContextMenuSurface`; then run
      typecheck and update the ~10 hard-coded tests intentionally; phone tab-bar width check.
- [x] `referencesSlice` (transient) + the selection floating toolbar's References button
      (visible only when the entire CP is selected, beside Simulate; action-catalog entry +
      `useOpenReferences` hook) that activates the panel.
- [x] `ReferencesCpView.tsx`: regl renderer on the `CpRenderer` seam with WebGL probe and
      context-loss rebuild, `UserCamera` fit/pan/zoom/pinch, scene upload through the
      existing adapters with the user's line style, click-only hit test (vertex before
      crease), highlight / ghost / marker props via existing renderer channels, imperative
      `{zoomIn, zoomOut, fit, frameModelBounds}`; no `cp-webgl-layer` class, no global
      camera/press/transform registrations; tests per "Testing strategy".
- [x] `ReferencesPanel.tsx` (composition only): sidebar + panel shell + toolbar (with the
      settings popover) + view + overlay states + transport strip + context menu;
      `.references-*` CSS copied from the `.simulator-*` / `.segments-*` rules; reference
      colour tokens.
- [x] Hooks and modules in `cp-workspace/references/`: `referencesActions.ts` catalog +
      tests, `useReferencesView`, `useReferencesTarget` (pick → ReferenceFinder point/line
      query, cards, candidate/step navigation, framing), `useReferencesRun` (`running` /
      `stoppable` / `stopping`, long-run toast, Stop = terminate + rebuild),
      `useReferencesShortcuts` + the `references` shortcut scope wiring, staleness on
      `foldArtifactRevision` / `loadSerial` with "Out of date — Recompute" and never
      auto-recompute, empty state, worker retain/release on enter/leave.
- [x] `StepDiagram` SVG component + `stepDiagramGeometry.ts` (DOM-free, tested) +
      `referenceFinderDiagramToPrimitives` adapter for the sidebar thumbnails.
- [x] Analytics events per the contract (fired from the view hooks); i18n sequence;
      `docs/analytics.md`; browser verification list from "Testing strategy".

### Phase 4 — planner crate B: closure, certificates, stuck search, pinch pass, orchestration

- [x] State with grid-hash points, angle-bucket lines, incidence lists, conditioning
      floor; inverse predicates returning all witnesses; forward constructors O1–O7 derived
      from the axioms (O6 cubic with polished roots) with the executability checks; two-tier
      incremental closure with the written monotonicity argument; `close(budget_ms)`
      (resumable), `order()`, `explain()`; typed status
      (`complete | partial_unsolved | partial_off_lattice | refused_sheet | invalid_input`)
      and diagnostics.
- [x] Forward candidate generator (full and goal-directed, capped) and the forward-first
      stuck search (IDDFS depth ≤ 2, depth 3 when candidates ≤ ~60, lexicographic score with
      visible-auxiliary as the second key, per-event time cap); `score(lines)` /
      `fold(lines, tags)` for ReferenceFinder-supplied candidates.
- [x] Pinch pass (downstream-use analysis → `extent` per auxiliary step; visible-auxiliary
      count) with the property tests above; ordering and grouping passes with stability
      tests; `sequence()` JSON per the `Step` contract incl. `cpLineIds`.
- [x] **Measure before fixing budgets:** Rust closure on the iguana component 0, on a
      Scale-Shaping-class design (~1,600 lines / 400 k points — external corpus, run
      locally) and on the 1,036-line canvas; memory on desktop (WKWebView) for rank 6 vs
      rank 5 plus the point store; set the `|P|` cap, default budget and desktop rank from
      the measurements; release-mode time ceiling test for the iguana closure.
- [x] Tests: properties (completeness, soundness, permutation invariance, pinch pass),
      regressions listed in "Testing strategy", fixture manifest (prototype upper bound,
      panel best-found, crate-derived expected) for bird 0, frog 1, grid6 1, kabuto 1,
      solution_sample_1 1, g3d_x19 2, x13_x38 3, x13_diag_pair 3, g3d_x112 2,
      claim7-cand9 2, {x = 1/5} 3, thirds_and_fifths 3, iguana c0 ≤ 2 (panel values; the
      crate's re-derived value is recorded beside them); fixtures moved from
      the spike directory to `tests/fixtures/precrease/` (noting c1/c4 were
      extracted in the canvas frame); Node cross-check against the vendored wasm.
- [x] `precreaseWorker.ts` + orchestrator: chunked `close()`, stuck loop (forward search →
      cached RF fallback → unsolved), budgets, cancel, partial results, results keyed on
      `computedAtRevision`; `research/reference-finder-spike/` removed.

### Phase 5 — whole-pattern breakdown, CP-wide analysis, sequence-state queries

- [x] Breakdown mode in the sidebar: rounds, grouped rows with count chips, auxiliary
      call-outs drawn as pinches unless visible, totals with the lower bound (no
      "minimum"), "landmarks first" toggle, approximate findings and refused components as
      sections, step scrubber; `plannerStepToPrimitives` for the shared `StepDiagram`;
      step → view highlight with ghosted new lines and the folded-so-far mask.
- [x] SNAPPABLE handling: plan on the snapped copy, show the maximum displacement in the
      summary strip (no write-back).
- [x] CP-wide analysis (closure-first, ReferenceFinder for the unreachable remainder) with
      progress/Stop, findings list with click-to-frame, summary strip.
- [x] "Starting from: this sequence" for crease targets using the shared from-state scorer.
- [ ] Export: copy the step list as text. (Analytics for the breakdown/analysis events and
      the `docs/` user note landed; the text export did not.)

Phase 5 outcomes (2026-09-05):

- The orchestrator is `apps/web/src/cp-workspace/references/precreasePlan.ts`, over a
  `PrecreasePlannerHandle` interface, so it is unit-tested against a fake planner and the
  replay ReferenceFinder client, and separately against the real bridge
  (`precreasePlan.wasm.test.ts`). Through the bridge from TypeScript, **grid6 plans in
  ~9 ms with 1 auxiliary fold and iguana component 0 in ~930 ms with 2** — the values
  `tests/fixtures/precrease/manifest.json` records for the crate itself. iguana c0 reaches
  its closure fixpoint in the **first** `close()` chunk (2 of 89 lines) and spends the rest
  of that second in one depth-2 stuck search, which is why the abort check sits before the
  search and not only at the top of the loop.
- The ReferenceFinder fallback mines a solution's *step lines*, scores them against the
  planner's state and folds the one that unlocks the most as `rf_aux`; a candidate scoring
  1 (constructible but unlocking nothing) is refused, which is also what makes the loop
  terminate. Neither fixture needs the fallback — both were planned with
  `referenceFinder: null` on purpose, to test that claim rather than assume it.
- "Landmarks first" is a **selection, not a recompute**: both presentation orders are
  computed when a plan lands (`sequence()` is a presentation pass over a closure the
  planner already holds), so the toggle is instant and needs no live planner.
- "Starting from: this sequence" scores against the planner the breakdown left behind, and
  only a **single-sheet** plan keeps one — after several sheets the surviving planner would
  be the last one planned rather than the one a target belongs to. It falls back to
  ReferenceFinder's own ranking whenever the planner is gone.
- Not measured: the CP-wide analysis on a 641-segment design (only iguana c0's plan was
  timed), and no browser or desktop verification was run in this phase.

### V1.1 (planned, not in this plan's checklist)

- Writing into the document, if ever wanted: auxiliary creases as `Cyan3` guide lines
  (needs the insert-and-split kernel op, its Tauri command and a store action under one
  undo entry) and "Snap crease pattern" write-back.
- Optional certify mode (exhaustive IDDFS to k with memoisation and time cap) so the UI can
  say "no shorter sequence exists to depth k".
- Polygon sheets in the closure (point-in-polygon, edges as segments).
- Symmetry pairing; equal-spacing family naming; rank histogram; SVG/PDF export of grouped
  instructions.
- "Pin as reference", guarded "Deep search" with bounded seeding (≤ 5 lines / ≤ 20
  points, time estimate shown).
- Keyed ReferenceFinder database persistence if import beats a 2 s build (needs upstream's
  keyed path); Kawasaki exact-solve as an alternative snap route.

### Later

- Approximate mode with constructed-geometry state and per-step error.
- Cost toggles ("+1 fold for easier axioms"); beam over stuck events; 5k-line scaling.
- Fold-through-layers model; folded intermediate previews via `folding3d`.

---

## Revision 2 — the workspace reads as a diagram

Seven pieces of feedback from the first browser session, all on the References workspace's
presentation rather than on the planner or the ReferenceFinder bridge. The engine work in
this plan stands; what follows replaces the workspace's layout, its picking feedback and
its per-step rendering.

### What was wrong

1. **Multiple crease patterns at once.** `run()` planned every plannable sheet in the
   document and `flatPlanSteps` concatenated them into one scrubber. There is no reason to
   ask for references for several patterns at once, and the concatenation made the step
   numbering meaningless.
2. **Clicking a vertex failed** with ReferenceFinder's `y coordinate should lie between 0
   and 1`, and the cursor never changed over a click target.
3. **Selecting a step moved the camera**, so reading the sequence walked the pattern around
   the viewport.
4. **Every crease drew at full strength in every step**, so a step's own crease was lost in
   the finished pattern behind it.
5. **The steps were a vertical sidebar list of 44 px thumbnails**, not a diagram.
6. **No visible way out of a vertex/crease pick** — clicking empty paper cleared it, which
   nothing said.
7. **No pointer cursor over a crease either.**

### D11 — the vertex bug is a one-ULP frame inconsistency, not a mis-picked sheet

`ReferenceFinder::ValidateMark` (`third_party/reference-finder/src/core/ReferenceFinder.cpp:358`)
tests `ap.y < 0 || ap.y > sPaper.mHeight` with **no epsilon**, and only the point command is
validated — `ValidateLine` checks distinctness only. That is why a vertex pick failed while
a crease pick and the whole-pattern breakdown (all line queries) did not.

`outline.rs::rectangle_frame` measures the sheet's `width`/`height` by projecting the loop's
corners onto `units[longest]`, then hands that axis to `Frame::new`, which **re-normalises
it**. For a rotated sheet the pre-normalised vector has a float norm of `0.9999999999999999`,
so the frame maps with a very slightly longer axis than the one its own extents were measured
with, and every projection comes out one ULP large. Measured on a 45° diamond sheet: 9 of 16
border vertices map to `1.0000000000000002`; the same pattern drawn axis-aligned rejects none.
Multi-component documents are a red herring — `componentForVertex` attributes by segment
ownership and was verified correct on a two-sheet document.

Two fixes, both wanted:

- **Rust**: normalise the axis *before* measuring, so a frame is self-consistent. Removes the
  systematic inflation.
- **TypeScript**: clamp on the *input* side of the ReferenceFinder boundary, in
  `protocol.ts`, where the paper rectangle is already known. `extractor.ts` has clamped the
  *output* side since Phase 1 for exactly this class of overshoot; the input side had no
  counterpart. Round-off is not the only way a point can land a hair outside, so the clamp
  is the invariant and the Rust fix is the cause removed.

### D12 — one sheet at a time, chosen in a sidebar

The left sidebar becomes the pattern picker, on the Simulate workspace's shape
(`SimulatorSegmentsSidebar`): one card per plannable sheet, a thumbnail and a 1-based badge,
`selectedSheet` in the workspace store. The breakdown plans **only** the selected sheet, the
CP view draws only that sheet, and the camera fits it.

Unlike the simulator's, this sidebar stays mounted for a single sheet: it is also where the
run affordance and the notes (hint, warnings, unreached lines) live, so hiding it would leave
them homeless.

### D13 — the steps are a filmstrip, the CP is the stage

Above the CP view, a horizontally scrolling strip of numbered step cards with a chevron at
each end; below it, one caption line carrying the active step's sentence. The CP view fills
the rest. Selecting a step scrolls the strip, never the camera.

### D14 — a step shows the sheet as it stands

At step *k* the view draws the sheet outline always, the creases made by steps 0…*k* and
nothing later. The current step's creases take the reference colour at full strength;
everything earlier is dimmed. Implemented as an alpha pass over the stroke buffer
(`applyStepVisibility`) rather than a new channel on the shared adapter, which is
parity-gated against `cpSnapshotToScene`.

In targeted mode the document's creases are dimmed uniformly so ReferenceFinder's
construction reads over them; nothing is hidden, because an RF solution's steps are folds on
a blank sheet and have no relation to the pattern's creases.

### D15 — planner steps get upstream's arrow

`plannerStepToPrimitives` drew no arrow and no letter labels, so the breakdown's thumbnails
had no way to show motion. `RefDgmr::CalcArrow` (`refDgmr.cpp:29`) is ~20 lines and is ported
verbatim, so a synthesised arrow is geometrically the same construction Tsai's app draws. The
moving input comes from the witness's own `who_moves`, which the crate already computes per
axiom (`predicates.rs:216`); its image is its reflection across the step's line. An empty
`who_moves` (O1, O4) draws no arrow, which is honest rather than invented.

Upstream computes two arrowhead directions and draws neither; we drew one. Both ends now get
a head, matching `CalcArrow`'s `fromDir`/`toDir`.

### Revision 2 checklist

- [x] Phase R1 — picking: the frame fix, the input-side clamp, hover cursor
- [x] Phase R2 — the sheets sidebar and one-sheet scoping
- [x] Phase R3 — per-step crease build-up, and no camera jump on step change
- [x] Phase R4 — the filmstrip, the caption bar and the way out of a pick
- [x] Phase R5 — arrows and labels for planner steps
- [x] Phase R6 — validation and browser verification

### What Revision 2 did not verify

- **The hover cursor, in a browser.** The Browser pane runs with
  `document.visibilityState === 'hidden'`, where `requestAnimationFrame` never
  fires — and the hover probe is rAF-coalesced, on the Edit canvas's precedent,
  because `LineHitIndex` falls back to a linear scan at fit zoom. The decision
  itself is unit-tested through `cpCanvasCursor` (`ReferencesCpView.test.tsx`);
  what is untested is that a real pointer moving over a real canvas reaches it.
- **Desktop / WebKit**, which Revision 1 also left open.
- The strip is a single scrolling row. A hundred-step sequence is a hundred
  cards wide; the sidebar's grouped outline is the answer for that shape today,
  and whether the strip needs its own grouping is a question for a real
  hundred-step pattern rather than for this plan.

---

## Revision 3 — the sequence is a fold sequence, not a line-drawing order

Eight more from a second browser session. Seven are presentation; the eighth changes what the
sequence *is*.

### D16 — a crease's direction is recoverable, and most lines carry both

The crate reads Oriedita's colour codes once, to split border from non-border, and keeps the
assignment only on `MergedLine.kinds`. `Planner::new` builds its `Target` from a merged line and
never reads them, so from `Target` onward — `FoldedLine`, `Placed`, `Step`, `Sequence` — the
assignment is gone; `LineTag` is provenance (`edge`/`cp`/`aux`/`rf_aux`), not mountain/valley.

It is recoverable by the consumer in one hop: `Step.cp_line_ids` are 1-based indices into the
same `segEndpoints`/`segAttr` the sheet thumbnails already colour from. So this is a
presentation change, not a crate change.

**Measured, on the planner's own fixtures** (a throwaway probe over `runPrecreasePlan`):

| fixture | mountain | valley | **mixed** | no CP crease | steps |
| --- | --- | --- | --- | --- | --- |
| `grid6.fold` | 7 | 7 | **0** | 1 | 15 |
| `iguana-c0.fold` | 16 | 16 | **57** | 2 | 91 |
| `x13_x38.fold` | 2 | 0 | **0** | 3 | 5 |
| `g3d_x19.fold` | 7 | 0 | **0** | 2 | 9 |

On a real design, **most steps make a chord that is mountain along some spans and valley along
others** — 57 of 91 on iguana, and step 1 alone is both over 20 crease ids. One fold along that
chord cannot produce both.

### D17 — one front pass, then reverse the mountains from the back

> **Superseded by Revision 4.** Reversing at the end is not a step a folder can make;
> D20–D25 replace it with a side-grouped schedule.

That measurement rules out the obvious designs. Folding each step from the side that gives its
direction is impossible for a mixed step and, with 64% mixed, would flip the paper on nearly
every step. Grouping the sequence by side is also not available: the order is a topological
order over "the chosen witness's inputs must already be folded", and `extent`, `visible`,
`unlocks`, `Step.id` and `LineEntry.step` are all computed from the emitted order, so a consumer
cannot reorder even within a round.

What makes this tractable is that **a reference needs the crease to exist, not to point a
particular way**. So:

1. The planner's sequence, unchanged, folded from the front. Bringing paper up and over makes a
   valley on the face you are looking at, so every crease lands as a valley.
2. **Turn the paper over.**
3. **Reverse the creases that must be mountains** — from the back they are valleys, which is why
   this is one operation rather than a fight.
4. **Turn it back over**, so the pattern is read from the front, which is the side its
   mountain/valley assignment is stated in.

Two flips, whatever the pattern, and it is what a folder does anyway. Steps 2–4 appear only when
the sheet actually has mountain creases.

The presentation list therefore stops being `{component, step}` and becomes a tagged union
(`referencesSequenceView.ts`): a fold, a turn-over, or a reverse. The filmstrip, the caption, the
crease visibility and the chords all address that list; `flatPlanSteps` still describes the
planner's own steps underneath it.

While the paper is on its back the canvas draws the pattern **mirrored**, because that is what
you would see. The folded figure already does this (`mirror: -1` plus a `flipped` parity flag);
here it is one x-negation folded into the `modelToSvg` the camera is built from, so picking
inverts with it for free.

### D18 — the step's crease keeps its own ink

The canvas drew a step's crease twice: once as a document crease recoloured to
`--cp-reference-new` at 2.6× width through the `selection` channel — which also discards its dash
slot, fold-angle ramp and direction hint — and again as a full-chord green ghost over it. That is
where the green came from, and the ghost is why a crease that was only pinched still showed as a
line across the sheet on every later step.

Now: a step's creases keep the Edit canvas's own mountain/valley ink and are emphasised by
**width and opacity** instead of by hue. `selection` is left to the *picked* crease, which is a
different question. Earlier steps' auxiliary lines are the only ghosts that survive, and only
over the spans that were actually creased.

### D19 — the step diagram was light ink on white paper

`--bg-paper` is `#f2f0e7` in every dark theme (`applyTheme.ts` branches on theme *type* and picks
between two near-whites), while `--fold-border` is the theme's `text.primary`. In a dark theme
that pairing is light ink on a near-white sheet: 1.07:1 in dracula and monokai, 1.87:1 in the
default one-dark. And `.step-diagram__label`'s halo is `--bg-paper`, painted into the 10% padding
band `labelPlacement` deliberately pushes labels into — a near-white ring on the dark card.

The diagram now draws on the canvas's own ground so it matches the pattern below it, and the halo
follows the ground it sits on. Earlier steps' creases are drawn grey in the diagram too, so a card
shows the sheet as it stands rather than a bare square.

### Revision 3 checklist

- [x] Phase S1 — the step's own ink, pinch extents, and vertices that build up
- [x] Phase S2 — the rail is only a pattern picker, and the plan runs on arrival
- [x] Phase S3 — the step diagram: theme, earlier creases, mountain/valley
- [x] Phase S4 — turn over, reverse the mountains, turn back
- [x] Phase S5 — validation and browser verification

### What Revision 3 did not verify

The **crease-pattern canvas** could not be checked in a browser this session. The Browser pane
stopped delivering layout: `dv-groupview` measures 100 × 0, so Dockview never sized its panes,
`ResizeObserver` never fired, and `applySize` ran against a zero rect — `renderNow` reports a
1 × 1 viewport and draws nothing, on a fresh tab as much as on the working one. It is the whole
app, not this workspace (the Edit canvas is equally blank once the pane is in that state), and
nothing in the page can force a layout pass from JavaScript.

So the per-step build-up, the mountain/valley ink on the canvas, the faint uncreased remainder
and the mirrored back view rest on their unit tests and on the DOM, which *was* checked: the
plan runs on arrival with no button, the strip carries the four folds and then Turn over /
Reverse 3 creases / Turn back, each card is reachable, and the diagrams draw on the theme's own
ground with earlier creases in grey and the new crease in its own direction.

One defect the DOM check found and this revision fixes: the step index was clamped to the
planner's fold count, so the three closing cards were unreachable — every press on one landed
back on the last fold. The presentation list now lives in `useReferencesBreakdown`, which is the
one place that knows how long it is.

---

## Revision 4 — mountain and valley, done properly

Revision 3's mountain/valley pass is wrong in the way that matters. It creases one
line red along part of its length and blue along another — which is not a fold anyone
can make — and it ends an 82-step sequence with "reverse 107 creases". D16–D18 above
are **superseded by everything in this section.**

This is the plan for replacing it. **Built**, in `0f37bcb9` (the crate) and
`5197c615` (the workspace); the notes below record where the plan was wrong and
what was done instead.

### Measured first

Revision 4's first draft generalised from three patterns. This one is measured over the
benchmark corpus at
`~/Documents/datasets/create-pattern-detector/real_benchmark`, through a throwaway
`.wasm.test.ts` harness driving `runPrecreasePlan` with the ReferenceFinder disabled and
an 8 s per-design budget.

**Sample.** 442 designs attempted — all 42 under `curated/`, plus the first 400 of
`cpoogle/` by name. **395 planned and were profiled**, covering **35,169 steps**. The 47
that did not: 27 over a 1,600-edge harness cap, 10 `refused_sheet` (the outline is not a
rectangle — hex paper and friends), 10 `partial_off_lattice` (corpus coordinate
precision, cf. `fold-corpus-precision-cleanup`). None of the 47 failed for a reason that
has anything to do with mountain and valley.

| over 395 designs / 35,169 steps | | |
| --- | --- | --- |
| pure mountain | 13,142 | 37.4% |
| pure valley | 10,790 | 30.7% |
| **mixed along the chord** | **11,159** | **31.7%** |
| no CP segments (auxiliary) | 78 | 0.2% |
| axiom chosen: O2 | 25,374 | 72.1% |
| O7 / O3 / O4 | 3,557 / 3,189 / 2,049 | 10.1 / 9.1 / 5.8% |
| O5 / O6 / **O1** | 347 / 223 / **430** | 1.0 / 0.6 / **1.2%** |
| an O1 witness was *available* | 19,062 | 54.2% |
| corner-to-corner chords | 661 | 1.9% |
| axis-parallel chords | 10,603 | 30.1% |
| mixed chords with one M/V boundary | 5,072 | 45% of mixed |
| … 3–4 alternations | 3,539 | 32% |
| … 5–8 | 1,710 | 15% |
| … 9–16 | 644 | 6% |
| … 17 or more | 194 | 2% |
| mixed chords under 60% one way | 4,650 | 41.7% of mixed |
| creased length that ends up the wrong way | | **14.8%** |

And the number that decides the architecture — turn-overs, if a mountain is creased from
the back and a valley from the front:

| scheduling policy | total flips | median / design | p90 | max |
| --- | --- | --- | --- | --- |
| the emitted order, majority direction per step | 15,417 | 28 | 67 | 172 |
| the emitted order, weak majorities float | 13,063 | 28 | 67 | 172 |
| **reorder inside each round, grouped by side** | **1,552** | **4** | **6** | **12** |
| reorder globally, grouped by side | 1,199 | 3 | 4 | 9 |

The reorder model is the crate's own dependency predicate: a line is available once its
step is folded, a point once two of its lines are, a step once every input of its chosen
witness is available. That is `order.rs::witness_available` transcribed, minus its
`MIN_ANGLE_SINE` conditioning floor — which cannot matter here, since two distinct
folded lines through one point are never parallel. All 395 designs scheduled to
completion under it, which is the model checking out.

### What the measurements settle

1. **O2 dominance is correct, not a gap.** The planner picks a point-to-point alignment
   72% of the time, and that is the preferred precreasing action. The first draft's idea
   of *preferring* O1 to buy direction freedom is dropped: O1 is what you reach for when
   there is no clean point-to-point reference, not a lever to pull.
2. **The flips are an ordering problem, and only an ordering problem.** Choosing
   directions better is worth almost nothing — freeing the 41.7% of mixed chords that are
   near coin-flips moves 15,417 flips to 13,063, still ~28 per design. Reordering moves
   it to 4. Every direction policy below is a rounding error next to the schedule.
3. **Round-local reordering is the right stopping point.** Global reordering is one flip
   per design better and costs the thing Revision 2 was about: `order_round` sweeps
   direction clusters across the sheet in the order a folder works, and a global regroup
   shreds that. 4 flips instead of 3, with the sweep intact, is the trade.
4. **Two of the three proposed heuristics are subsumed.** "Many tight alternations ⇒
   crease one way" and "special-case the basic starting folds" both fall out of the
   never-split constraint plus majority-by-length; neither needs its own rule. The 838
   chords that alternate 9 or more times are exactly the box-pleated axial/hinge lines,
   and the constraint already creases them one way.
5. **14.8% of creased length ends up the wrong direction, and the UI has to say so.**
   That is what precreasing *is* — the diagram's job is to put the crease in the right
   place with a direction that makes the collapse natural — but the workspace may not
   imply the finished assignment falls out of the precrease sequence.

### D20 — a step never carries two directions

The hard constraint, and the one Revision 3 breaks: **the crease a step makes has exactly
one direction along its whole creased extent.** There is no step that says "crease this
line in multiple directions". Nothing below may relax this.

### D21 — direction by creased length, never by count

A step's direction is the majority of its CP segments' **length**, not their number.
Where the majority is under 60% — 41.7% of mixed chords — the direction is not decided
here; the step is marked `Either` and the scheduler decides it. That is worth ~9% of the
remaining flips (1,552 → measured 1,199 globally, same shape round-local) and costs one
branch, so it is in, but it is a tie-break and not a policy.

Splitting a mixed chord into per-direction sub-steps is **out**, by D20. It is also
unbuildable: the marks that would justify a split are the crossings of creases the plan
has not made yet.

### D22 — only O1 is direction-free

An alignment fold — bring a point to a point, a line to a line, a line onto itself — is
made as a valley on the face you are working from. So a step whose crease must end up a
mountain has to be made with the sheet turned over, and the side a step needs is forced:

| chosen axiom | side |
| --- | --- |
| O1 (crease through two marks) | either — no alignment to sight |
| O2, O3, O4, O5, O6, O7 | the face the crease's direction wants |

O1 is 1.2% of steps, so in practice the direction decides the side for essentially every
step. That is the whole reason the schedule matters.

A related claim in the first draft of D25 was already false: "every other axiom
keeps the arc". **O4 has no arrow either** — `predicates.rs::who_moves_and_visible`
returns an empty `who_moves` for axioms 1 *and* 4, because a perpendicular is
sighted rather than swung. That is 5.8% of steps, it was correct before this
revision, and the diagram needed no change for it.

### D23 — the schedule belongs to `order.rs`

A consumer cannot fix this. `extent` (the pinch pass), `visible`, `unlocks`, `Step.id`
and `LineEntry.step` are all computed *from* the presentation order, and the pinch pass
is only valid for the order it ran against. Reordering in TypeScript would invalidate
every one of them — which is exactly why Revision 3 deferred the mountains to one closing
step instead.

So: `order()` grows a side-grouping pass, run after the round skeleton is laid out and
before `pinch`/`sequence` consume it.

**And it is a partition, not a schedule.** The pseudocode this section first
carried ran a readiness loop over `witness_available`, which is unnecessary:
`closure.rs`'s "# Rounds" note says every fold in a round was certified against
the state *before* the round began, so any order inside a round is executable.
`Closure::close` proves it — the tier-1 sweep and the lander enrichment both run
before `self.round += 1` and before any fold. So:

```
for each round, in round order:
    turn := the round's steps that need the other side
    stay := everything else — the ones that want this side, and the ones that
            do not care, which cost nothing by going first
    emit stay on the side already up, in order_round's sweep
    if turn is non-empty: turn the sheet over and emit it, same sweep
```

At most one turn-over per round, the sweep intact inside each block, and no
availability array. The running side is declared above phase 0 and threaded
through every round: resetting it per round would turn the paper over at every
boundary.

### D24 — what the crate carries

Direction is dropped today at `Planner::new`. It comes back as **evidence in `merge.rs`,
policy in `closure.rs`, decision in `order.rs`** — three separate places on purpose.

| where | change |
| --- | --- |
| `merge.rs` | `MergedLine` gains `mountain_length: f64`, `valley_length: f64` — raw, no policy. `kinds` (a sorted set) cannot express a majority and stays as it is. |
| `direction.rs` (new) | the policy, and the whole of it: `Direction`, `Side`, `FIRM_MAJORITY`, `majority()` and `share_of()`. It depends on nothing, so `merge`, `closure`, `order` and `sequence` can all name it. |
| `closure.rs` | `Target` gains `direction: Direction` and `direction_share: f64`, through `Target::new` / `Target::unassigned` / `Target::forces_side`. Two production construction sites, not one — the **snappable** arm builds from `SnappedLine`, which carries no kinds, so the evidence sums over its `source_lines`. Nine more are test helpers. |
| `order.rs` | the D23 pass. `Placed` gains `side: Side`; weak and unassigned steps record the side they were folded on. `group()`'s merge test gains `side`, so a group never spans a turn-over. |
| `sequence.rs` | `Step` gains `direction: Direction` (**resolved**), `direction_share: f64` — the share of the line *that direction* gets right, so a weak line creased the other way reports `1 − share` — and `side: Side`. `Step.side` is carried rather than derived, because an `Unassigned` step has a side but no direction. |
| `oristudio-precrease-wasm` | nothing — serde carries it. Verified by hand against a real `sequence()`, since the generated `.d.ts` says `sequence(): any` and nothing downstream would catch a renamed field. |

`group()` groups *consecutive* steps, so side-grouping splits some rounds into more,
smaller groups. It also has to gain `side` in its merge test, or the last step of
one block and the first of the next merge into one group across the turn-over.

### D25 — the diagram

- A turn-over card appears wherever `Step.side` changes, drawn with the standard
  turn-over symbol (`plannerTurnOverDiagram`, already written). The `reverse` step kind
  and everything that renders it are **deleted** — `referencesSequenceView.ts` loses its
  `reverse` variant.
- If the last block is on the back, one closing turn-over is appended, so the finished
  pattern is always viewed from the front.
- Back-side steps render mirrored — `ReferencesCpView`'s `mirrored` prop, already
  implemented as a reflection folded into `modelToSvg`.
- An **O1** step draws the crease between the two marks, with no motion arrow — on
  the card *and* on the canvas, or the two disagree. (The no-arrow half was already
  true, and true of O4 as well; see D22.)
- A turn-over card shows the **build-up as of the fold before it**, not the finished
  pattern. `plannerTurnOverDiagram` took the whole sequence, which was right when the
  only turn-over came last; now it takes the step index. The same applies to
  `referencesCreaseVisibility`, which had one rule for folds and another for the
  closing cards and now has one for both.
- Cards on the back are **mirrored**, like the canvas beside them. The mirror is in
  `createDiagramProjector` rather than a transform on the SVG, so the labels stay the
  right way round, and the arc sweep flag flips with it.
- The crease is drawn in the Edit tab's own mountain/valley ink at full strength; the
  uncreased remainder of the chord stays that same ink at lower opacity. No third colour.

### D26 — say what the plan is

The workspace states, once and plainly, that these are precreases: the sequence puts
every crease in the right place, and the direction shown is the one that step is made
in. The summary strip never implies the finished assignment is what the sequence
produces — it states the turn-over count and how many lines are creased both ways.

**The step sentence fires whenever `direction_share < 1`, not only under 60%.**
An 84%-mountain line is dishonest in the same way a 55% one is, just less often,
and the statement is true exactly when the share is below 1. Both counts also
ship as bucketed analytics: the whole schedule was chosen on the turn-over
count, so it is the number to watch in the field.

### Open questions

None outstanding. Zach's answers, folded in above: O2-preferred (D-list item 1);
never-splitting is a constraint, not a preference (D20); sub-60% resolved by whatever
minimises flipping (D21 + D23); O1 drawn as a plain crease between its two marks, no
arrows (D25).

### Revision 4 checklist

- [x] `merge.rs` — `mountain_length` / `valley_length` on `MergedLine`, with tests
- [x] `direction.rs` — `Direction`, `Side`, `FIRM_MAJORITY`, `majority`, `share_of`
- [x] `closure.rs` — `Target.direction` / `direction_share`, including the snappable arm
- [x] `order.rs` — the D23 round-local side partition; `Placed.side`; `Group.side`
- [x] `sequence.rs` — `Step.direction` / `direction_share` / `side`
- [x] Rust regression: exact per-step sides, not a bound — see below
- [x] `precreaseSequence.ts` — the three new fields
- [x] Delete the `reverse` step kind and `referencesFoldDirection.ts`
- [x] Turn-over cards from `side` changes, opening and closing ones included
- [x] Cards mirrored on the back
- [x] O1 steps drawn between their marks, card and canvas
- [x] D26 sentences and summary counts, translated for all 8 locales
- [x] Analytics: `turn_overs_bucket`, `mixed_steps_bucket`
- [x] Browser verification on markhor

### The regression is two-sided on purpose

Every way of getting this wrong makes the turn-over count go **down** — a path
that forgets to read the evidence, an inverted mountain-is-the-back convention, a
majority taken by count instead of length. A `flips <= measured` bound would pass
on every one of them. So `tests/planner_direction.rs` pins the exact side of
every step: `grid6` (7 M / 7 V, no mixed line, one right answer),
`claim7-cand9` (the minimal two-block case), `bird_base` (all mountain, so it
turns over once and stays), `iguana-c0` (91 steps, 6 turn-overs), and a
**snapped** component — nothing in the repo planned one before, and the snappable
arm is the one place the evidence has to be summed rather than read.

Checked by mutation: inverting mountain/back fails 5 of the 8, dropping the
snappable path's evidence fails exactly the test written for it, and never
forcing a side fails 5.

### What the browser showed, on markhor

82 folds, **4 turn-overs**, 30 lines creased both ways. The turn-over cards draw
12, 56, 75 and 82 creases — each the build-up as of that point, not the finished
pattern. The closing card is the mirror image of the finished one across all 82
lines, which is the card mirroring end to end. And step 1, the one that started
this revision, now reads:

> Fold the bottom-left corner onto the bottom-right corner. This line is creased
> both ways in the pattern — the rest reverses as the model collapses.

One fold, one direction, and the diagram says what it is not doing.
