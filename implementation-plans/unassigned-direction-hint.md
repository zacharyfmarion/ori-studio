# Unassigned creases with a direction hint

Follows [`fold-angle-propagation.md`](fold-angle-propagation.md), which deferred
this as "a half-known crease — direction fixed, magnitude free". It is now the
most valuable thing left in that feature, and the measurements say why.

Three asks, in dependency order: fix Solve Fold Angles on unassigned creases,
give propagation the same explicit Apply/Cancel box, and let an unassigned
crease remember which way it folded.

## The measurement that justifies the whole thing

Tier A corpus only (10 × `known-good/*`, `spikes_better.fold`,
`non-flat-harder_final.osf`). Probe calls the **shipped** `solve_k` /
`solve_fan_at` / `solve_fold_angles` — no re-implemented math. A hint is applied
as a sign filter on the solution set, with the family guard kept on the
*unfiltered* set.

**k = 2, 13,056 subsets:**

| | determined | branching | underdetermined | wrong commits |
| --- | --- | --- | --- | --- |
| plain unassigned | 29.24% | 50.24% | 20.52% | 0 |
| **direction hint** | **79.48%** | **0.00%** | 20.52% | **0** |

Three consequences, each stronger than "it helps":

- **The hint resolves *every* branch.** 79.48 + 20.52 = 100.00. The only k=2
  stall left is the rank-deficient continuous family, which is a Jacobian-rank
  fact that no amount of direction information can touch.
- **Every k=2 branch on this corpus is the ±180 M/V pair** — 6,559 of 6,559 —
  and the hint determines all of them. This is the sound version of the collapse
  that was proposed and withdrawn in the propagation plan: the user supplies the
  bit, the software does not guess it.
- **One hint is enough.** Hinting only the *first* of two unknowns gives the
  identical 79.48%, because valid alternatives flip both full-fold creases
  together, so pinning one sign kills the partner.

Per file, base → hinted: `cross.fold` 7.36 → 70.63, `frogBase` 14.29 → 86.61,
`origamisimulator` 28.55 → 80.94, `helloworld` 30.04 → 80.47, `spikes_better`
44.48 → 86.80, `byu solar driven` 64.65 → 83.84.

Whole-document propagation, blank 30% and run to fixpoint: `cross.fold` goes
**89.7% → 100.0%**.

> **So the hint is the mechanism, not a convenience.** Without it, propagation
> stalls on a question at half of all k=2 vertices. With it, the questions
> disappear and the remaining stalls are honest ones.

### And the one place it must not be used as a filter

**k = 1, 33,986 subsets:** determined without a hint **100.00%**; with a correct
hint **100.00%** — upside **zero**. And a *wrong* hint empties the menu in
**33,986 / 33,986 = 100%** of them.

At k=1 the filter can only destroy. Use the hint there as a **consistency check
that reports a conflict**, never as a filter. This is a correctness requirement,
not a tuning choice.

## Ask 1 — Solve Fold Angles on unassigned creases

### It is three bugs, and the message you saw is the least interesting

`vertex_fan_at_with_sources` drops every `LineColor::None` crease from both
`creases` and `sources` (`checks_spatial.rs:766-769`) and flags the fan
`UnassignedCrease` (`:794-800`). Measured over 7,789 clean interior vertices:

| what the user did | what they get |
| --- | --- |
| unassigned a crease, **picked it** among the three | `CreaseNotInFan` — 7,789/7,789 |
| picked three known creases, a **fourth** is unassigned | `Indeterminate` — 7,789/7,789 |
| unassigned enough that <3 assigned remain | **`NotEnoughCreases`** |

The third row is the message in the screenshot, and **which of the three you get
is a function of the vertex's degree, not of what you did** — `NotEnoughCreases`
fires when `degree − (#unassigned + #border) < 3`, which is 89.2% of cases here
only because 6,202 of 7,789 vertices are degree 4. At degree 8 the identical
mistake says `CreaseNotInFan`. That is why it reads as nonsense at a vertex with
four creases.

The row that matters for the feature is the **first**: "solve the creases I just
blanked" is the whole point, and it fails.

Also silently broken by the same line: `solvable_partners` returns `[]` when the
fan is indeterminate, so the which-creases-work affordance goes dark at any
vertex with an unassigned crease.

### The fix: swap the fan, keep the solver

```
fan      = solve_k::solve_fan_at(model, vertex)      // unknowns KEPT
unknowns = positions_of(chosen) ∪ fan.unknown_positions()
if unknowns.len() != 3 → decline `TooManyUnknowns`
solve_fold_angles(&vertex_fan_with_placeholders, [unknowns…], bar)   // unchanged
```

Measured over **49,068 triples the tool accepts today: 100.00% behaviour-identical,
0 answers missed, 0 extra, 0 new declines.**

Do **not** route the tool through `solve_k` as the *solver*. That was measured at
15.56% agreement because of the k=3 delegation bug — **already fixed** (commit
`2d6672f7`), and `three_unknowns_agree_with_the_shipped_three_crease_solver` now
pins it. Even so, the fan swap is the smaller and better change.

Do **not** widen `vertex_fan_at_with_sources` either. It has only two production
callers (both in `solve_fold_angles.rs`, so the earlier claim that CAMV shares it
is wrong) — but `VertexFan.creases` is `Vec<(f64, f64)>` with no way to spell
"unknown", and *that* type is shared with `vertex_dof`, `closure_product`,
`vertex_closure_residual`, `jacobian_rank`, `vertex_link_polygon` and
`dispatched_camv`.

### The honest sub-case

A **fourth** unassigned crease at the vertex means k ≥ 4 against closure's 3
equations — genuinely unsolvable, not a bug. It needs a new decline code saying
*"another crease here has no angle yet — give it one first."* Useful nuance
measured: in every such case sampled, that fourth crease is itself `Determined`
at k=1 from the current state, so the correct next move is literally **run
Propagate**. Say so in the message.

### Two traps

- **`as_vertex_fan` reads an unsupplied unknown as `0.0`** (`solve_k.rs:147`),
  and the precondition is documented but *not enforced*. Handing `solve_k` only
  the three picked positions while a fourth is free returns an answer that closes
  the vertex with that fourth crease at 0° — measured on `spikes_better`, 90°
  wrong against its true −90°, with a residual of 2.5e-14 that looks perfect.
  **Enforce the precondition**, do not just document it.
- **`is_current` is computed against the placeholder**, so a 0 placeholder makes
  a 0° answer claim to be "where it already is". Do not carry `is_current` for a
  crease that has no current state.

## Ask 2 — the shared Apply/Cancel box

`CpToolOptionWindow` is already React-free and store-free, and its stepper,
Apply/Cancel, framing and the focus-independent `←`/`→`/`Enter`/`Escape` chords
all transfer. Three real obstacles:

1. **Exactly one layer is mounted** (`CreasePatternPanel.tsx:3030`). Two tools
   need a resolver picking whichever tool currently holds a window.
2. **`title` is invisible whenever `count > 1`** — the stepper replaces it
   (`CpToolOptionLayer.tsx:132-159`, pinned by its own test).
3. **`vertexSolve.segments` is merged into the preview at `:2168-2171`.** A held
   propagation draft needs the same merge or it vanishes on the next preview
   recompute.

Also note `propagation_solved` / `propagation_free` / `propagation_stalls` exist
in `oristudioCpTypes.ts` today with **no frontend consumer** — the summary is
net-new UI, not a rewiring.

## Ask 3 — the direction hint

### Data model: a new field, not a new `LineColor`

```rust
/// Which way this crease folded before its angle was forgotten.
pub fold_direction_hint: Option<FoldDirection>,   // Mountain | Valley
```

Invariant: **non-`None` only when `color == LineColor::None`.** Enforce it in the
constructor path, not by convention.

Rejected: **two new `LineColor` variants.** `lineColorName` *throws* on an
unmapped code (`oristudioCpGeometry.ts:108-114`), `.ori` serialises colour
**names** so an old reader errors rather than degrades, the share codec's
`colour_from_code` rejects `> 12`, and it would make ~693 `Red1|Blue2` match
sites latent bugs. Rejected: **reusing `fold_magnitude` as a sentinel** — it
re-couples the two axes that `non-180-fold-angles.md` deliberately made
orthogonal.

### Formats — and the one that inverts the failure mode

**The governing rule, and it is the single most important decision here:**

> Keep the *unknown-ness* in the standard field. Put the *direction* in the
> extension. Never the other way round.

Today unknown-ness lives in FOLD's own `edges_assignment: "U"`, so it survives
any tool that has never heard of us. The tempting encoding — write `"M"`, a
`null` angle, and a proprietary hint array — **inverts that**: measured with the
shipped importer, losing the extension array imports as a **decided −180
mountain**, and so does stripping every `oristudio:` key. There is nothing
inconsistent left for the importer to detect, `line_color_agrees_with_assignment`
gives zero protection, and no superset warning fires. The user reopens the file,
sees an ordinary mountain, and every angle derived downstream is computed from a
magnitude nobody supplied.

| format | unknown-ness | hint | on loss |
| --- | --- | --- | --- |
| `.osf` | native | native | — (opaque record, **no schema bump**) |
| `.fold` | `edges_assignment: "U"` | `oristudio:edges_fold_direction_hint` | degrades to plain unassigned |
| share link | native | new extension tag | — |
| `.ori` / `.orh` | `NONE` — **already lossless today** | dropped | degrades to plain unassigned |
| `.cp` | **lost** (collapses to aux) | lost | superset warning |

**`.cp` is the only reachable format that loses anything here.** `ExportDxf` is
registered `notImplemented` (`oristudioCpCommands.ts:717`) and is absent from the
export menu, whose entries are CP, FOLD, .bps, ORI, ORH, SVG, PNG; the kernel's
`export_dxf_string` is called only from tests and the Oriedita oracle. `.obj` has
no exporter at all — only `import_obj_str`. So `supersetFeatures.ts` currently
names `dxf` and `obj` in `droppedByFormats` and `FOLD_ANGLE_LOSSY_FORMATS` for
paths a user cannot reach. That is pre-existing, and this feature should not add
to it: **do not add `dxf` or `obj` rows for the hint.**

`.ori`/`.orh` must keep writing `NONE` — they round-trip `LineColor::None`
perfectly today (`io/ori.rs:617,636`, pinned by `tests/io.rs:456,550`), and
writing `RED_1` for a hinted crease would be *new* data loss in the one non-`.osf`
format that currently loses nothing.

`.fold` note: `tests/io.rs:993` asserts "every crease exports an angle". Writing
`null` for an unassigned crease breaks that stated invariant — restate it
deliberately rather than letting a test that happens not to cover it stay green.

### Rendering — ink, not a dash slot, and the same in both surfaces

**Decided by the owner.** A hinted crease draws in its **direction's colour**
(red for mountain, blue for valley) at **reduced saturation**, keeping whatever
dash that direction would carry. It reads as *"this is going to be a mountain, we
just do not know how far."* Plain unassigned stays grey.

Why not a dash: `MAX_DASH_SLOTS = 2` and **both slots are already spent** on
mountain-dash and valley-dash in the `color-and-shape`, `black-one-dot` and
`black-two-dot` styles. There is no free slot in three of the five line styles,
and inventing a third would be a renderer change. Ink costs nothing, survives all
five styles, and degrades sensibly in the monochrome ones to a lighter grey.

There are **two** render surfaces, not three: the share card is built from the
same `creaseExport` primitives as image export (`ShareLinkModal.tsx:117`,
`svgToPngCard`). So share preview and SVG/PNG are one path.

**The hint renders the same in both.** This is a deliberate reversal of the
first draft, which proposed hiding it in export on the grounds that an image is a
deliverable and a hint is a working note. The owner's call is consistency, and it
is the better one: a hinted crease is *visible state in the document*, and a
picture of the document that omits it is a picture of a different document.

Cost of that decision, stated plainly:

- The canvas needs the appearance key widened. The resolver is
  `CpLineAppearanceFor = (color: string) => CpLineAppearance`, consumed at six
  sites plus a byte-identical parity test, and a hinted crease has the *same*
  colour string as a plain one. The fallback if that gets ugly is an overlay pass
  (`CpRenderer` already has `setPreview` / `setDiagnostic*`), which leaves the key
  alone at the cost of another draw.
- The export path needs the hint at all. `creaseExport` renders from
  `edges_assignment` alone (`assignments[index] ?? 'U'` → `edgeAppearance`) and
  reads **no** extension arrays today, so the hint has to reach it through
  whatever `creaseExportFold` builds.

**A pre-existing inconsistency to fix while here.** The canvas and the export
already disagree about a *plain* unassigned crease: it draws solid grey on the
canvas (`cpLineStyleColorKind('None')` → `'other'` → `SOLID_DASH_SLOT`) while the
theme's dashed `--fold-unassigned` rule is dead as CSS — its only consumer splits
the class string for a variable name. Consistency across the two surfaces is the
owner's stated goal, so settle plain-unassigned too rather than leaving the new
state consistent and the old one not.

### Wrong hints must be loud

A wrong hint stalls rather than lies — 0 wrong commits in 92,395 subsets. The
`StallReason::Unsolvable` channel that surfaces it was dead code and is **fixed**
(commit `bc822394`). Keep it reachable; it is the only symptom a wrong hint has.

## Affected areas the first pass missed

- **Derived-geometry inheritance.** `derived_fold_angle.rs:318-375` is a *source
  scan* requiring every `with_line_color(x.color)` to be followed by
  `with_fold_magnitude_of` within three lines. It knows nothing about a hint, so
  extend/reflect/mirror/copy will silently drop it — exactly the bug class that
  test exists to prevent, reopened for a second field. Needs
  `with_fold_state_of` and the scan widened.
- **Compact transport OCG2 → OCG3** touches five surfaces, not one:
  `geometry_transport.rs`, `oristudio-cp-wasm/src/lib.rs:465-482`,
  `oristudioCpNativeClient.ts:86-88`, `oristudioCpGeometry.ts:52-80`, and the
  byte-exact golden `compact-geometry-golden.bin`. The Rust test's own docstring
  names this failure: *"the TypeScript decoder stayed on OCG1 and every native
  payload failed its magic check, while both test suites went on passing."*
- **Two committed share goldens** are byte-frozen, and `kitchen_sink()`'s stated
  purpose is to touch every extension tag — so a new tag needs a hinted crease in
  it, regenerated with `UPDATE_SHARE_GOLDEN=1`.
- **The appearance resolver is keyed on a colour *string***
  (`CpLineAppearanceFor = (color: string) => …`), consumed at six sites plus the
  parity test. A hinted crease has the *same* colour string as a plain one, so
  four distinguishable states is not a two-entry table edit.
- **SVG/PNG export renders from `edges_assignment` alone**, and `isUnassigned`
  tests `'F'|'U'|'C'|'J'`. Keeping `"U"` (above) is what makes this work at all.
- **`CpContextToolPanel.tsx` is at 1171/1171 — zero headroom**, and
  `eslint.config.js:258-274` already calls the `CpContextToolGroup` extraction
  "overdue" and says it "should not ride on whichever feature next trips the
  cap". The chip itself is free (`FoldAngleControl.tsx` has no cap); the exposure
  is whatever else lands in the panel.
- **No test asserts kernel codes ⊆ `CP_TOOL_UNAVAILABLE_CODES`.**
  `CreasesDoNotMeet` is already emitted by the kernel and absent from the TS
  table, so the user is told *nothing*. Add that test alongside the new code.
- **`solvable_partners` has a second gate** (`fan.creases.len() < 3`) that the
  `indeterminate` fix alone does not clear.
- **`describeAffected` ships raw untranslated English** (`"4 creases"`), on a path
  `i18next/no-literal-string` cannot see because the rule is `jsx-text-only` and
  the file is `.ts`.
- **Aux segments** can be `LineColor::None` and would silently drop hints through
  the share codec; `assert_segment_fields_are_handled` will not catch it.
- `.fold` oracle parity is safe: `fold_topology_summary` reads colours from the
  model, not from `edges_assignment`.

## Checklist

### Phase 0 — kernel corrections (partly done)

- [x] `solve_k` k=3 actually delegates (`2d6672f7`)
- [x] `StallReason::Unsolvable` is reachable (`bc822394`)
- [ ] Enforce `as_vertex_fan`'s unknowns precondition rather than documenting it
- [ ] Clamp `max_commit_k` — it is frontend-supplied and unclamped today.
      **Still open, and confirmed still true.** The only caller passes
      `DEFAULT_MAX_COMMIT_K`, so it is not reachable from the UI, but nothing
      stops a larger value costing unbounded solve time per vertex.
- [ ] Reconcile the fan epsilons: `solve_fan_at` clusters at `UNKNOWN_1EN6`, the
      checker fan at `UNKNOWN_1EN4`. They agree on the whole corpus today; the
      gap is latent and the doc claims they are parallel.

### Phase 1 — Solve Fold Angles fix

- [x] Swap the fan to `solve_fan_at`; keep `solve_fold_angles` as the solver
- [ ] `TooManyUnknowns` decline code + the kernel-codes ⊆ TS-codes test
- [ ] Fix `solvable_partners`' second gate
- [ ] Do not carry `is_current` for a crease with no current state

### Phase 2 — the hint, kernel

- [x] `fold_direction_hint` field + the `color == None` invariant, enforced
- [x] `with_fold_state_of` and the widened derived-geometry source scan
- [x] ~~Hint as a **filter at k ≥ 2**~~ — **superseded**, and deliberately. A
      filter narrows the *search*, so a hint the user got wrong would delete the
      real answer; the hint is a belief about the crease, not a fact about the
      geometry. Shipped instead as a **tie-break between answers the solver has
      already declared equally valid** (`fold_propagation::forced_answer`) plus
      the conflict check. Same effect where a hint is right, no lost solutions
      where it is wrong.
- [x] `.osf`, `.fold` (`"U"` + extension), share tag + goldens, `.ori` keeps `NONE`

### Phase 3 — formats and warnings

- [ ] `SUPERSET_FEATURES` entry for **`.cp` only** — `.dxf` is `notImplemented`
      and unreachable, `.obj` has no exporter
- [x] OCG3 across all five surfaces + the golden

### Phase 4 — UI

- [ ] Shared option-window resolver; propagation draft merged into the preview
- [x] "Unassigned" chip in `FoldAngleControl`; widen the `isFoldingCrease` gate
      so a hinted crease can be un-unassigned
- [x] `Make Unassigned (keep direction)` — **one operation with a payload flag**,
      not a second operation (no new descriptor, so PORTING.md's origin rules are
      satisfied for free)
- [x] Hint ink on the canvas: **an overlay pass**, not a widened appearance key.
      Both were tried and the key lost: a wash of the direction's colour toward
      the unassigned grey made one stroke carry two claims and produced a third
      nobody meant — the crease read *faint*, which is the signal a shallow fold
      angle already uses — and it was not even-handed, since the grey is blue-ish
      and a mountain kept 43.6% of its chroma against a valley's 53.0%. The two
      claims are split across the two things a dashed line already has instead:
      the dash still says "undecided" and the colour keeps every bit of its
      saturation, on **alternate marks** of that dash. That is one extra instance
      appended past the creases in the same batch, ten floats, so painter order
      puts it over the mark it replaces — not a second draw call. The overlay
      declines when the active line style resolves the direction to the ink the
      crease already has, which is what the two black-dot styles do to
      everything.
- [x] Hint ink in `creaseExport`, so SVG/PNG and the share card match the canvas.
      Both encodings come off one derivation and are measured against each other,
      but they cannot share an encoding: the shader has no phase offset — `vDist`
      is distance from the segment's own start — so the canvas shifts phase with
      a leading zero-length mark, which the run walk steps straight over. SVG
      cannot use that trick, because a zero-length dash under `stroke-linecap`
      `round` prints a dot, so it reaches the same marks through a real
      `stroke-dashoffset`.
- [ ] Settle plain-unassigned's canvas-vs-export disagreement in the same pass
- [x] ~10 new i18n keys × 8 locales + `cpVocab` regeneration

## Top risks

1. **The `.fold` encoding inverting the failure mode.** Mitigated by the
   standard-field rule above; it is the difference between losing information and
   silently changing what the pattern *is*.
2. **A hint used as a filter at k = 1**, where it has zero upside and can empty
   the menu 100% of the time.
3. **Format/render scope.** The kernel half is well-measured; the format and
   rendering halves are where the first pass was materially under-scoped, and
   three binary goldens will fail loudly before anything ships.
