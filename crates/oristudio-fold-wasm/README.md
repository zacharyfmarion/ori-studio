# oristudio-fold-wasm

The wasm-bindgen bridge for `oristudio-fold`, the Fold workspace's engine
(`implementation-plans/fold-workspace.md`, D1 and Phase 4a). The web app
runs it in `apps/web/src/workers/foldSequenceWorker.ts`; the TypeScript
shapes are `apps/web/src/fold/engine/foldEngineWire.ts`.

- **States stay here, by handle.** `FoldEngine` holds every landed state
  under a `u32` until it is released, so a step is one call whatever the
  state's size and a replay's cache holds handles, not copies. A worker that
  is terminated and respawned starts a new engine, which holds none of the
  old handles (`unknown_state`); the web side stamps each handle with its
  worker's generation so an old one is never sent to a new engine.
- **Coarse calls.** `sheet(paper)`; `apply(state, op, choices)` for valley,
  mountain, precrease, unfold, refold, turn and rotate (by a part of a turn,
  or `amount: "degrees"` with its `degrees`, in (0, 180]), along a free line, a
  crease or an axiom; `summary`; `canonical_keys` for the `fs1` fingerprint;
  `release`, `clear`, `live`.
- **Partial precreases** (`src/partial.rs`): a precrease op with an
  `extent` — a segment between two point inputs, or a pinch of a `length`
  centred on one — creases only that stretch of its line and lands crease
  marks. `apply`, `analyse` and `action` answer it (its refusals by code:
  `extent_off_paper`, `extent_too_short`, `extent_misses_paper`,
  `extent_misses_layers`); the summaries, the scene, the landmarks and the
  `fs1` keys (`m:`) carry its marks; `default_pinch_length(state)` is the
  length the tools offer.
- **Queries on a handle** (plan D12, D14): `analyse(state, op, choices)`, what
  a fold would move (the moving set, the flaps, which the seed picked and
  which the closure added); `action(state, op, choices)`, its picture before
  it lands; `depth_choices(state, op, choices, at)`; `cross_section(state,
  line, side)`, the engine's section plus the `joins` where a bend meets the
  line between two rows (`src/joins.rs`); `axiom_candidates(state, line)`,
  each root's number, line and who moves, for the candidate chooser; `scene`;
  `landmarks(state, marks)`, Divide-line marks passed in as sheet points;
  `top_visible_at(state, at)`. A held state remembers the step that landed
  it, so `step_summary(state)` (counts, the crease-pattern diff, "Layers")
  and `step_action(state)` (the step's picture with the landed cover) are
  asked of the child alone, while its parent is still held
  (`parent_released` otherwise). An import keeps no parent: it replaces the
  state, so its summary is the pattern it brings (its counts, an empty diff,
  no layers) and it has no picture.
- **The document's shapes in** (`src/wire.rs`). A stored step crosses
  unchanged and resolves in its parent (`src/resolve.rs`) through
  `oristudio-fold`'s anchored folds: a free line through two sheet points'
  images, an existing crease by a point on it, an axiom on its inputs in the
  shared crate's slot order with its stored root (`choices.root`) replayed to
  the nearest candidate; sheet points through `State::resolve_point`; the
  moving side from the axiom, `moving` or the seed. The tools may also send a
  line already in the model frame (`via: 'model'`) with a `side`, a tuck's
  `placement` and the `closure` policy.
- **Refusals are values**: `{ status: 'refused', refusal: { code, … },
  fixes, faces, vertices }`, never a sentence. Codes are the engine's
  (`FoldRefusal`), an anchored line's (`LineRefusal`: `point_off_paper`,
  `free_line_too_short`, `no_root`, `no_side`, `side_on_line`,
  `mover_stays`, …) and the bridge's own (`unexpected_choice`,
  `root_missing`, `crease_not_found`, `crease_not_flat`,
  `crease_not_folded`, and Import CP's `import_*` for a stored `cp-jump`
  that no longer lands); they never collide. A sliver
  remedy's `use_line` fix also carries `step`, the document's op and
  choices that fold along it. Only a caller's mistake — malformed input, a
  handle this engine does not hold — throws, as the `{ code, message }`
  envelope every bridge uses.
- **Compound folds** (plan D4, `src/compound.rs`) — the reverse folds, the
  crimp and the tuck, the vertex folds and the sinks — are steps like any
  other — `apply`, a step's summary and picture — through one seam: a
  family's op resolves to a `CompoundOp`, and what it lands is held as a
  `CompoundLanded` (one held state, whether `apply` landed it or the
  family's own call), so each family is a module of its own
  (`src/ops_<family>.rs`) with an arm in `wire.rs` and `resolve.rs`. A
  landed one reports beside a plain fold's `report` as `compound`, tagged
  by its `family` (`reverse`, `crimp`, `tuck`, `vertex`, `sink`), its
  motion's legs in every family's. Their choices are the engine's own
  (plan D6): `opening`, per flap, its upper block by witnesses;
  `completion`, the free pairs as FOLD `faceOrders` over witnesses; a closed
  sink's `pocket`. Which choices an op takes is one rule for every op
  (`Op::takes`, `Choices::unexpected`), checked before anything resolves.
  Every family's outcome takes one path to the wire (`compound::landed`): a
  step whose stored choices leave several results is refused as
  `choice_needed` (naming `opening`, `pocket` or `completion`), and one whose
  stored choice no longer resolves as `choice_broken` with the engine's
  cause; a replay marks either broken. `compound_analysis(state, op,
  choices)` is the tools' one question before a step lands, answered with
  the family's own answer tagged by `family`: a reverse fold's tip and each
  flap's openings, the kinds that land and the choice still needed — an
  opening, or, per kind, up to eight orders, each the `completion` that
  picks it — of both kinds at once; a crimp's tip and the kinds that land;
  a tuck's targets; a vertex op's flap, petal or fan; a sink's point and
  pockets (an unsink has no point to analyse: asking it is the caller's
  mistake, and its tool asks `sunk_points` instead). The families that fold
  along one line — the reverse folds, the crimp, the tuck and the sinks
  (open, closed and the unsink) — also answer `analyse`, `action` and
  `depth_choices`, and have a step picture (`step_action`): a crimp of its
  tip at ℓ1, its picture ℓ1 with a pleat arrow across both lines; a tuck of
  its block against its target, as a plain fold's; a sink of its point's
  faces, seen as a mountain with the push onto its crown, and an unsink
  seen as a valley, pulled. The vertex folds (squash, petal fold, rabbit
  ear, swivel) fold along no one line, but each answers `action` and has a
  step picture too, drawn along the one crease that tells it best (a
  squash's lower crease with the push onto its spine, a petal fold's H, a
  fan's crease from its center); asking them `analyse` or `depth_choices`
  is the caller's mistake. A crimp or a tuck keeps its step's summary as it
  lands, so it answers that after its parent is released; its picture is
  drawn on its parent.
- **Each family's own calls**, besides `apply` and `compound_analysis`:
  - the reverse folds have none: a tool chooses an opening or an order from
    `compound_analysis` and commits the step through `apply`;
  - `crimp(state, op, choices)` and `tuck(state, op, choices)` fold it and
    answer landed, an opening to choose (a crimp), or every order already
    landed under its own handle with what its step stores;
  - `vertex_fold(state, op, choices)` answers landed, or a choice of orders
    held under a `pending` handle of its own; `vertex_pick(pending,
    choice)` lands one listed order per component, and
    `release_vertex_choices(pending)` lets held choices go;
  - `sink_orders` and `sink_pick` count and pick a sink's orders (below),
    and `sunk_points(state, op, choices)` lists the sunk points an unsink's
    line and side can pull back out, for an unsink tool whose folder has
    named none.
- **`fs1` keys** (`src/canonical.rs`): one per fact of the state, none naming
  a face, vertex or crease by its number; the digest over them is
  TypeScript's `keyDigest`.
- **Import CP, Send to Edit and the FOLD export** (`src/io.rs`; plan D10,
  D16), through the CP kernel's own loaders and writers (below):
  - `import_cp(file, bytes, target, limits)` reads a `.cp`, `.fold`, `.ori`
    or `.orh` file (`file` is its format, and whether it is one of the
    samples, `tests/fixtures/fold-samples`), imports it into an empty
    sequence (which adopts its square or rectangle) or after a state, and
    completes its layer order
    from its letters: a true ‹ n of m ›, within a node budget, held under an
    import handle. `import_pick(import, choice)` lands one order as a step
    and returns the `cp-jump` op that stores it, landed by `apply` exactly
    as every replay will land it; `release_imports`, `live_imports`.
  - `import_edit_folded_figure(scene, target, limits)` starts from Edit's
    folded figure: the kernel's folded paper scene, whose stacks decide the
    order (Oriedita's relations, `ImportedPattern::from_oriedita`).
  - `send_to_edit(state, title)` is the state's crease pattern as the FOLD
    text Edit's import takes; `export_fold(states, title)` a path of states
    as one FOLD file.
  - A stored `cp-jump` — `cpJson`, the pattern as the kernel's FOLD writer
    writes it; `orderJson`, the order by sheet-point witnesses — is applied
    like any op: imported after its parent, its witnesses deciding the
    order, or refused (`import_*`) and the step broken.
  - **The face cap.** A pattern of more than
    `oristudio_layer_order::MAX_FACES` (4,096) faces is refused
    `import_too_many_faces` (`face_count`, `limit`) as soon as its faces are
    counted, by every one of these calls, a replay's included; any other
    state over it is refused `too_many_faces`. The layer order's tables are
    over every pair of faces, about `7n²` bytes, and a wasm heap never gives
    them back: 10,000 faces took 700 MB and 25,600 trapped at wasm32's 4 GB.
  - **The stacking cap.** A pattern whose faces overlap one another in more
    than `oristudio_layer_order::MAX_STACKED_TRIPLES` (12,000,000) triples —
    one stack 418 layers deep, or several shallower — is refused
    `import_stacked_too_deep` (`deepest`, `triples`, `limit`) as soon as its
    overlaps are counted, before its constraints or any order, by every one
    of these calls, a replay's included; any other state over it, a fold's,
    is refused `stacked_too_deep`. Working out the order grows with the
    triples whatever the face count; the cap is where a step it admits still
    replays in about 3 s through this bridge in Node (the constant's docs
    have the measurement). A count, not a clock, so a saved step is refused
    alike on every machine. `tests/stacking_corpus.rs` weighs the fixtures'
    models, and an external corpus, against it.
- **Sinks** (`src/ops_sinks.rs`; plan Phase 11): `open-sink`, `closed-sink`
  and `unsink` ops land through `apply`, their line resolved as a fold's,
  the seed naming the point (or the sunk tip), and `choices.pocket` (a
  sheet point either side of a closed sink's pocket) and
  `choices.completion` (the engine's `WitnessOrder`, as `orderJson` holds a
  whole order) stored as results. `apply`'s answer carries the engine's
  sink report as `compound` (`family: 'sink'`), its motion's legs among it.
  A sink that needs a choice the step does not store is refused
  `choice_needed` (`pocket` or `completion`); a stored one that no longer
  resolves, `choice_broken` — the compound folds' own codes
  (`src/compound.rs`). `compound_analysis` previews the point (its outline,
  outside letter, apex, the square line, why an open sink is refused, the
  pockets with what a step stores), `sink_orders` counts what a completion
  leaves, `sink_pick` gives the completion a step stores, and `sunk_points`
  names the points an unsink can pull out.

## The `kernel` feature

`oristudio-fold`'s `kernel` feature is on (plan D1), so the browser reuses
the CP kernel's loaders and writers rather than a second copy of them: Import
CP reads files with them, Send to Edit and the FOLD export write with them,
and a step's `cpJson` is the kernel's FOLD. The bridge now links
`oristudio-cp` (the Oriedita port) and `treemaker-fold`, both MIT OR
Apache-2.0; nothing it reaches has an edge to `treemaker-core`.

## Size

`npm --workspace @treemaker/web run build:oristudio-fold-wasm` (release,
`wasm-opt` by wasm-pack's default), 2026-10-08:

| Build | `.wasm` raw | gzip -9 |
|---|---|---|
| Without `kernel`, before the queries (sheet, analyse, apply, summary, keys; the same engine) | 641,223 B (626 KiB) | 236,181 B (231 KiB) |
| Without `kernel`, with the queries and axiom ops | 907,733 B (886 KiB) | 336,478 B (329 KiB) |
| With `kernel` and the io calls, before the queries | 1,594,829 B (1,557 KiB) | 655,855 B (640 KiB) |
| With `kernel`, the io calls, the queries and axiom ops | 1,879,638 B (1,836 KiB) | 752,479 B (735 KiB) |
| The same at `d0990bbde`, with the compound pipeline and the reverse folds (2026-10-09) | 1,916,660 B (1,872 KiB) | 768,949 B (751 KiB) |
| With the vertex folds: squash, petal fold, rabbit ear, swivel (2026-10-09) | 2,162,136 B (2,111 KiB) | 862,907 B (843 KiB) |
| Every Phase 11 family: with the compound motions' legs, the crimp and tuck, and the sinks (2026-10-11) | 2,697,550 B (2,634 KiB) | 1,064,672 B (1,040 KiB) |
| With the vertex folds' pictures and the tuck listing's deadline (2026-10-11) | 2,711,257 B (2,648 KiB) | 1,072,623 B (1,047 KiB) |
| Shipped at `94082c8d3`, the merge of the petal fold and swivel UI (2026-10-12) | 2,926,227 B (2,858 KiB) | 1,143,295 B (1,116 KiB) |

The vertex folds add **245,476 B raw (+240 KiB), 93,958 B gzipped
(+92 KiB)**: the staged motions, the fan scoring and the general pieces
pipeline in the engine, and the four ops, the held-choice store and their
serializers in the bridge.

The Phase 11 row is the bridge that shipped, built by `npm run build:web` at the
merge of the crimp and tuck, the vertex folds and the sinks (the same bytes
as `dist/`'s hashed copy; a `wasm-pack build` of `af859d5cb` on 2026-10-11
reproduced it byte for byte). Since the vertex row it adds **535,414 B raw
(+523 KiB), 201,765 B gzipped (+197 KiB)**: every compound family's motion
legs (Wave 5's compound motion), the crimp's and the tuck's analysis, orders
and fixes, the sinks' points, pockets and unsink, the sink and crimp/tuck
pictures (`step_action`), and their serializers. It is **over the two
budgets' 800 KiB sum by 245,472 B (240 KiB) gzipped**; the open question
below covers it.

The last row adds each vertex fold's picture (`action`, `step_action`: a
squash's crease, arrow and push, a petal fold's H, a fan's crease from its
center) and the tuck listing's reads of its deadline: **13,707 B raw
(+13 KiB), 7,951 B gzipped (+8 KiB)**.

The 2026-10-12 row is the bridge `npm run build:web` built at the merge of
the petal fold and swivel UI, the same bytes as `dist/`'s hashed copy. That
branch changed no Rust: the row measures what the engine and the bridge
gained in the merges before it. These are the partial precreases and their
crease marks, the crimp's two lines folding together, the rabbit ear's
fourth crease as its ridge, the petal fold's hinge by its precrease or its
two ends, the swivel by its edge, and the turn by an exact angle. Together
they add **214,970 B raw (+210 KiB), 70,672 B gzipped (+69 KiB)** over the
row before. That leaves the bridge **324,095 B (316 KiB) gzipped over the
two budgets' 800 KiB sum**.

The fourth row was the bridge that shipped when the budget was set. Rebuilt at `44005c2d9`, with the
Fold workspace's UI merged, it is the same 1,879,638 B raw, and 752,480 B
through this machine's `gzip -9`. The rows without `kernel` cannot be
rebuilt at that commit: `kernel` has been linked since the io branch
merged, and the bridge has no switch to leave it out. They were measured on
branches before it, the second in another worktree.

The io branch measured `kernel`'s cost before the queries, against the
Wave 2 bridge built in the same worktree (638,301 B raw, 236,078 B
gzipped): **+956,528 B raw (+934 KiB), +419,777 B gzipped (+410 KiB)**.
After both merged, the fourth row is +971,905 B raw (+949 KiB) and
**+416,001 B gzipped (+406 KiB)** over the row without `kernel` with the
queries; that row was built in another worktree the same day, so read the
difference as approximate.

Phase 4a first measured the bridge without `kernel` at 609 KiB raw (228 KiB
gzipped); the calls added since bring it to the first row. By `twiggy` on an
unoptimized build, most of `kernel`'s difference is
`serde_json` (with the workspace's `float_roundtrip` parser), the serde code
for FOLD documents and the folded paper scene, the kernel's loaders and FOLD
writer, and `encoding_rs`'s decoders and tables for `.orh`'s Japanese and
Chinese charsets.

The queries and axioms link in the engine they reach — the scene, the
cross-section and depth choices, landmarks, the constructions, anchored
folds and the sliver remedy — and the serializers of their results. The
bridge crate's own code is about 75 KB of it before `wasm-opt`. Neither
lever tried moved it: results through `serde_json` and `JSON.parse`
(941,911 B, larger) and `wasm-opt -Oz` (904,380 B).

For scale, built with the shipped fold bridge (2026-10-11): the precrease
bridge is 925,078 B raw (903 KiB) and 359,733 B gzipped (351 KiB), the CP
kernel's bridge 3,312,093 B (3.2 MiB) and 1,481,773 B gzipped (1.4 MiB). The
PWA warms the other kernels for every installed visitor, but not this one:
the Fold worker and its `.wasm` are in `UNWARMED_PATTERNS`
(`apps/web/vite.config.ts`), so a visitor who never opens Fold downloads none
of it, and the first Fold session caches it like any other asset.

**What the shipped bridge is made of** (2026-10-11). `twiggy` over the same
build with its name section kept (wasm-bindgen 0.2.121, then `wasm-opt -O
-g`, both from wasm-pack's cache): its items, names left out, sum to
2,697,799 B, within 249 B of the shipped module. Each item is counted once,
by the crate of the type it belongs to, so a derived `Serialize` for an
engine type is the engine's and a std routine monomorphised for it is std's.
An item includes whatever was inlined into it, so a module's share is
approximate. The sizes are raw; the module as a whole gzips to 39.5%.

| Owner | Raw | Share |
|---|---|---|
| The engine, `oristudio_fold` | 700,857 B | 26.0% |
| — its compound pipeline (`compound::*`, every family) | 340,967 B | 12.6% |
| std's generic code (`core`, `alloc`, hashbrown, the allocator) | 652,539 B | 24.2% |
| — 228 monomorphised `sort`/`sort_unstable` routines | 313,396 B | 11.6% |
| — B-tree maps and sets | 97,489 B | 3.6% |
| The bridge, `oristudio_fold_wasm`: its own code, and its exported calls with what was inlined into them | 495,987 B | 18.4% |
| serde, `serde_json`, `serde_wasm_bindgen` | 317,953 B | 11.8% |
| Data segments (strings, tables) | 233,431 B | 8.7% |
| `oristudio_layer_order` | 69,603 B | 2.6% |
| The kernel's own crates: `oristudio_cp`, `treemaker_fold`, `encoding_rs` | 151,958 B | 5.6% |
| `oristudio_geometry` (15,054 B), `treemaker_flatfold` (11,103 B), wasm-bindgen's glue and the rest | 75,471 B | 2.8% |

The compound pipeline's largest families: the sinks 80 KB, the reverse folds
56 KB, the rabbit ear's and swivel's fans 46 KB, the crimp 43 KB, the squash
32 KB, the tuck 23 KB, the petal fold 18 KB, the shared pieces 18 KB. Every
item that names serde — the serde crates, and the `Serialize` and
`Deserialize` impls in ours — is 484,081 B (17.9%). `wasm-opt -Oz` over the
shipped module takes 108,453 B off the raw size (2,589,097 B) and adds
1,069 B gzipped (1,065,741 B), so it does not help the line that matters.

**Budget.**

- Without `kernel`: **768 KiB raw, 288 KiB gzipped**, set before the queries
  as a quarter of headroom for the scene, cross-section and axioms. **The
  build with them is over it** by 118 KiB raw, 41 KiB gzipped (907,733 B
  and 336,478 B against 786,432 B and 294,912 B).
- `kernel` may add at most **512 KiB gzipped** over the build without it
  (about a third of the CP bridge every visitor already downloads). Past
  that, take D1's fallback: `kernel` stays native and test-only, and Send to
  Edit, export and Import CP go through the existing CP worker as FOLD text.
  It adds about 406 KiB, within it.

Together the two allow 800 KiB (819,200 B) gzipped. The bridge that shipped
when they were set was 735 KiB, inside their sum only because `kernel` used
less than its allowance; the engine's own share was over its line. With the
vertex folds it was 843 KiB, and with every Phase 11 family it is 1,064,672 B
(1,040 KiB), over the sum by 245,472 B (240 KiB); with the vertex folds'
pictures (the last row) it is 1,072,623 B (1,047 KiB), over by 253,423 B
(247 KiB). **The budget has not been raised, and nothing here changes it.**

**Open, for the owner: the budget without `kernel`** — now a question
about a Fold user's first load only (the decision below). Raise it, or trim
the engine side to fit; until that is decided the shipped bridge is over its
budget. Taking `kernel`'s 406 KiB as fixed, the engine side is now about
634 KiB gzipped against its 288 KiB line. What moved it since the line was
set: the compound pipeline (16 KiB), the vertex folds (92 KiB) and the rest
of Phase 11 (197 KiB), gzipped. Of the levers, the two tried on the build
without `kernel` with the queries (results through `serde_json`, `wasm-opt
-Oz`) did not move it, and `-Oz` still does not on the shipped one (above).
Not yet measured as levers, and the largest items the breakdown above names:
std's 228 sort routines (313 KB raw), the serde code (484 KB raw), and the
compound pipeline itself (341 KB raw).

**Decision (2026-10-08): `kernel` stays in the bridge.** Measured before the
queries it added 410 KiB gzipped, within the 512 KiB allowance, so D1's
fallback is not taken. After the queries it adds about 406 KiB (the
difference between two worktrees' builds, so approximate), which leaves
about 106 KiB gzipped for the kernel's other writers (`.cp`, `.ori` and
`.orh` export, D10), not linked yet.

**Decision (2026-10-11): the bridge is fetched on first Fold use, not
warmed for every visitor.** The PWA used to warm every kernel for every
installed visitor, this one among them. The owner chose otherwise for the
Fold engine (`519aacf96`): its worker and its `.wasm` are in
`UNWARMED_PATTERNS` (`apps/web/vite.config.ts`), so they are downloaded the
first time someone opens Fold and cached like any other asset after that.
A visitor who never opens Fold downloads none of it, and a Fold user pays
for it once. So the budget question above is about a Fold user's first load
only — not every visit to the site, and not any Fold session after the
first.

## Performance

Measured through the built bridge in Node 22 (2026-10-08, load average
about 30 on a shared machine), on random all-layer folds along lines near
the middle of the sheet, 80 runs, 1,006 folds. Tier 2 (plan D14, once per
line, side and direction) is bucketed by the parent's faces; tier 3 by the
landed state's. Times include crossing the boundary.

| Call | 33–64 faces mean / p95 | 129–256 faces mean / p95 |
|---|---|---|
| `analyse` | 0.12 / 0.25 ms | 0.96 / 2.75 ms |
| `cross_section` (with joins) | 0.16 / 0.41 ms | 0.64 / 2.34 ms |
| `action` (the preview's picture) | 0.20 / 0.44 ms | 1.46 / 3.69 ms |
| `depth_choices` | 1.19 / 3.88 ms | 18.3 / 74.8 ms |
| `landmarks` (per state) | 2.25 / 3.66 ms | 15.7 / 25.1 ms |
| `scene` (per state) | 1.75 / 3.31 ms | 29.2 / 66.4 ms |
| `apply` (the fold and `State::make`) | 1.55 / 2.45 ms | 9.91 / 15.9 ms |
| Tier 3: `apply`, then the child's `step_summary` and `scene` | 3.30 / 5.73 ms | 40.0 / 79.7 ms |

An earlier run (40 runs, seed 7) agreed within a few tenths at 33–64 and
within 15% at 129–256.

**Since then** the scene stacks its cells through a table of the order on
face positions (`oristudio_layer_order::OrderTable`) instead of the order's
map, and `depth_choices` grows one closure layer by layer instead of
analysing every depth. Both give the same output: an A/B of the two builds
over the same folds (80 runs, two interleaved passes, load average about
15–20) hashed every landed state's subfaces and every depth answer, the same
for both. 118 states and 55 depth previews fell at 129–256 faces:

| Call | before mean / p95 | after mean / p95 |
|---|---|---|
| `depth_choices` | 17–18 / 80 ms | 0.65–0.81 / 1.3–2.1 ms |
| `scene` (per state) | 37 / 114–129 ms | 4.5–5.5 / 8.3–12.7 ms |
| Tier 3: `apply`, `step_summary`, `scene` | 45–47 / 125–141 ms | 13–16 / 27–32 ms |

The A/B's states are deeper than the table's above (lines through the
sheet's lower left quarter rather than its middle), so its "before" is
slower than the table's.

- **The plain fold** is at the JS spike's p95 (research §12: ≤ 2.2 ms at
  33–64, ≤ 17.2 ms at 129–256): 2.45 ms and 15.9 ms here, under load.
- **Tier 3 is within D14's 50 ms at 256 faces, at p95 too**, since the
  scene's subface stacks went through a table: they had been most of it
  (the scene alone, computed with nothing returned, was 22 of its 25 ms at
  129–256). What is left of it is mostly `apply`.
- **No tier-2 cache in the bridge.** The calls keyed by line, side and
  direction take a few milliseconds at 256 faces, and the tools ask once per
  line; `depth_choices`, keyed by a point as well, is as cheap since it grows
  one closure. The costly ones are `landmarks` and `scene`, which are per
  state: a state is immutable under its handle, so the web side keeps them by
  handle.

**Known limit, accepted (2026-10-11): previews on deep stacks.** Asking a
reverse fold or a crimp (`compound_analysis`: the kinds that land, and per
kind the orders still to choose) takes longer the more layers the flap it
turns holds: about 2 s natively for 128 faces in one flap, against about
50 ms on real models of about 60 faces. The owner accepted this as a
known limit rather than something to fix now. When it is revisited, the
direction is an engine API that prepares the step once and decides each
kind from that one preparation under one shared budget.

## Tests

- `cargo test -p oristudio-fold-wasm`: `tests/bridge.rs`, natively, through
  JSON shaped as the web app sends it — the document's ops resolving in their
  parent, axioms along their stored roots (a drifted root replays to the
  same state; a missing one, `no_root`, `mover_stays`), a sliver remedy's
  stored step landing, refusals as codes with fixes and no sentence
  anywhere, unfold and refold along a crease, a model line's side against
  its normal as given, every query on a handle, handles, the `fs1` keys
  following the state rather than its numbering, and `oristudio-fold`'s
  classic sequences replayed through the bridge to the outcomes their
  fixtures record, along model lines and again along O1 axioms with their
  roots. `tests/reverse.rs`: the reverse fold through the same JSON — the
  preliminary base from the triangle by two inside reverses, the kinds the
  compound question says land and the other kind offered as the fix, an
  opening and an order (the engine's campaign case s1-287, its plain folds
  as model-line steps) chosen through the question, stored and replayed,
  `choice_needed` and `choice_broken`. `tests/crimp_tuck.rs` and
  `tests/vertex.rs`: the crimp, the tuck and the vertex folds the same way,
  each family's own call landing the state and report `apply` replays, a
  crimp's kept summary after its parent is released, a vertex fold's not.
- `cargo test -p oristudio-fold-wasm --test io`: `tests/io.rs`, the io
  calls natively — Send to Edit, then Import CP, giving the same state
  (`fs1` keys equal) over the classics and 364 seeded random states, with
  the import's completion offering that order; an Import-CP golden through
  `.cp` and `.fold` (the same state, its valleys where the files draw them,
  the flaps showing their backs); the samples each importing to their one
  order; open and pick (every listed order landed, exactly one the state
  sent), an empty sequence adopting the pattern's sheet, stored ops that no
  longer land refused; and Edit's folded figure, folded by the kernel from
  114 states, front and rear, landing the state it was folded from.
- `cargo test -p oristudio-fold-wasm --test partial`: `tests/partial.rs`,
  partial precreases natively — a pinch's marks in the report, the
  summaries, the picture, the scene, the landmarks and the `fs1` keys (and
  gone again under a whole precrease along the line), a whole precrease
  unchanged, segments named by a mark and a point, along an axiom, the
  extent's refusals from `apply`, `analyse` and `action` alike, and a
  malformed extent thrown.
- `cargo test -p oristudio-fold-wasm --test sink`: `tests/sink.rs`, the
  sinks natively on the samples as Import CP lands them — open and closed
  sinks and the unsink back by `apply`, the pocket asked for, stored and
  replayed, the tilted line's fixes, the choices a sink takes, the queries.
- `wasm-pack test --node crates/oristudio-fold-wasm`: `tests/node.rs`,
  `tests/io_node.rs`, `tests/crimp_tuck_node.rs` and
  `tests/partial_node.rs`, the same calls across
  the wasm boundary (plain objects in and out, refusals as values, thrown
  envelopes, the kernel's scene object as input; the crimp's and the tuck's
  ops, analyses and landings, and the tuck's target listing timed by the
  page's clock). CI runs no wasm-pack tests, so this is a local gate.
- `apps/web/src/fold/engine/foldSequence.wasm.test.ts` drives the built
  bridge from TypeScript, every call included, and an axiom step through the
  document's replayer; `foldEngineIo.wasm.test.ts` drives the io calls and
  folds Edit's figure with the CP kernel's bridge in the same process.

Original work under `MIT OR Apache-2.0`.
