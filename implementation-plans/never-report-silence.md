# Never report silence

Every vertex gets a verdict, and no verdict is "nothing".

## The bug that produced this plan

Measured on `failure_case.osf` — a real document the owner solved with fold-angle
propagation, believed complete, and then could not fold:

```
25 endpoints
 9 examined by the spatial checker
 0 closure failures reported
 1 vertex NEVER EXAMINED — degree 3, one unknown
```

That one skipped vertex is the one the folder refuses on ("70.53° short of
meeting"). `vertex_fan_at_with_sources` finds an unassigned crease at it, flags
the fan `Indeterminate::UnassignedCrease`, and declines. No report is produced,
so no diagnostic entry exists, so the `Closure` message that *would* have said
"the creases here do not close up" never gets a chance to render.

**The checker is not locating the problem badly. It is not reporting at all** —
and the UI displays abstention as success.

The owner's account of the failure is the requirement:

> "I thought it had fully solved the thing... And there are no foldability
> errors, so I was like, okay, it's fully working. And then I selected the crease
> pattern and tried to fold it and it said this pattern can't be folded. But then
> I was like what the fuck, which vertex?"

Three subsystems each held part of the answer and none of them said it.

## Goal

Make the vertex verdict a **total function**. Every vertex lands in exactly one
state, every state has a sentence, and every sentence has a place on screen.
"No errors" must mean *checked and fine* — never *not checked*.

## The cases

### What a vertex can be

| # | State | Can we know if it folds? | Today |
| --- | --- | --- | --- |
| 1 | **Boundary** — touches a `Black0` paper edge | No closure condition exists; nothing to check | Declined, silent. **Correct**, but indistinguishable from clean |
| 2 | **Unsplit junction** — a segment passes through without ending here | No: the fan is missing two rays | Declined, silent |
| 3 | **Interior, fully assigned, closes** | Yes — it folds | Clean ✓ |
| 4 | **Interior, fully assigned, does not close** | Yes — it does not | Closure failure with residual ✓ |
| 5 | **Interior, flat (all ±180)** | Maekawa / Kawasaki / big-little-big | `check4` ✓ |
| 6 | **Interior with unassigned creases** | **Depends on k — see below** | Declined, silent. **THE BUG** |
| 7 | **Interior border** — a `Black0` loop inside the sheet | Vertices on it are excused; a hidden holonomy can exist | Warns "not checked", computes nothing |
| 8 | **No interior vertices at all** (e.g. `known-good/airplane.fold`) | Nothing was checked | Reports clean. **Wrong** |

### Case 6, broken out by k — the heart of it

`k` is the number of unassigned creases at the vertex. `solve_k` already answers
each arity, with measured determinacy:

| k | What `solve_k` returns | What we can honestly say |
| --- | --- | --- |
| **1** | **100.00% determined** (115,560 / 115,560 real fans) | *"This closes if that crease is X°"* — or, if unsolvable, **a real error**. Never abstain. |
| **2** | **79.93% determined as stored, no hint needed** (215/269 blanked Tier A fans); 14.9% branching, 4.8% family | Determined → the angle. Branching → *"two ways to close this"*. Family → not pinnable. |
| **3** | **0 determined out of 10** measured; 3 branching, 7 underdetermined — and 9× the per-vertex cost of k = 1 | Off the live path outright. Not merely gated. |
| **≥4** | **Structurally underdetermined** (Jacobian is k×3) | *"Too many undecided creases here to say"* — the one honest abstention, and it names why |

> Phase 0 corrected two rows here. The k = 2 "29% as stored / 79% with a
> direction hint" figure came from generic 3D angle states; on designed patterns
> k = 2 already behaves like the hinted row, so the deep-check mode needs no
> direction hint built first. And k = 3 does not pay for itself at any price.

> **The failing vertex in `failure_case.osf` is k = 1.** The app could have told
> the owner the exact angle that closes it, or that none does. It said nothing.

**This settles the earlier proposal to "ignore unassigned creases and check the
rest".** That is already what `find_flat_foldability_violation` does
(`checks.rs:294` — the match arm is `_ => {}` and `is_folding_line()` excludes
`None`). On this vertex it would drop the fan's degree by one and report nothing
useful. Worse, Maekawa needs `|M − V| = 2` with `M + V = degree`, and those share
parity — so it can only hold at **even** degree. Dropping one crease from a
degree-4 vertex guarantees a false *error*. The rule fails in both directions
depending on parity.

Phase 0 measured which direction it fails in, and it is the loud one: blanking an
eighth of the assigned creases across the corpus took `check4` from **0
violations to 2,030**, every one invented at a vertex that was clean before, 89%
of them the odd-degree `NumberOfFolds` arm. So case 6 is really two populations —
spatial-regime vertices, which are silent, and flat-regime ones, which are the
larger group and shout. The false *clean* has a separate cause: `report_for`
setting `residual: None` and `spatial_closure_diagnostics` skipping every report
without one. Two mechanisms, and Phase 1 has to fix both or the loud bug outlives
the quiet one.

**Solve the unknown instead of deleting it.**

### The verdicts, and where each surfaces

Four kinds, not two. The HUD tone union is `'ok' | 'warn' | 'error'` today
(`hudStatus.ts:35`) and needs a fourth.

| Verdict | Meaning | Surface |
| --- | --- | --- |
| **Fine** | Checked, it closes | Counts toward "OK"; no entry |
| **Broken** | Checked, it does not close, or violates a flat rule | Error entry, glyph, click-to-locate. **Exists** |
| **Undecided** | Solvable in principle, not yet decided | Its own count, a filled diamond, and the *answer*: "Set this crease to -143.2° and this vertex closes" |
| **Unknowable** | Boundary, unsplit junction, k ≥ 4, or excused by an interior border | Its own count and a hollow diamond — except a paper edge, which has no condition to be unexamined about and is caught by `checked_vertices` instead |

The distinction that matters to a user is **Undecided vs Unknowable**: the first
has an action ("set this crease to 70.53°", "pick one of these two"), the second
has an explanation. They must not share copy — the same rule the propagation
tool's two terminal states already follow.

## Approach

### 1. The checker returns a verdict per vertex, never nothing

`dispatched_camv` currently omits declined vertices from `spatial`. Make every
interior-ish vertex produce a report carrying its verdict. The three existing
decline reasons (`BoundaryVertex`, `Indeterminate`, `NotEnoughCreases`) become
*Unknowable* verdicts rather than absences.

The one thing to preserve: **the fan still sees every crease.** Scope, arity and
verdict are about what we can *say*, never about what the solver may *look at* —
the same invariant `SolveFan` and the propagation scope both turn on.

### 2. A vertex with unknowns is solved, not skipped

Route case 6 through `solve_k` (`solve_fan_at` keeps unassigned creases as
unknowns; the checker's fan drops them). Map its verdict:

- `Determined` → Undecided, **with the angle**
- `Branching` → Undecided, with the count and the options
- `Underdetermined` → Unknowable (`k ≥ 4`, or rank-deficient)
- `Unsolvable` → **Broken**, and this is the case the owner hit

Cost: this is the live edit path (`CheckCamv` runs after every mutation), and
`solve_k` at k ≤ 2 is cheap while k = 3 is not. Gate by arity, measure before
widening, and reuse the propagation scope work — a vertex whose unknowns did not
change does not need re-solving.

### 3. The fold-blocked dialog links to the vertex

Once every failing vertex has an entry, the dialog stops re-wording the fact into
a location-less sentence and points at the entry instead. Cheap *after* step 1,
impossible before it — which is what the first attempt at this got wrong.

### 4. Unassigned creases look unassigned

They draw **solid grey** on canvas; the dashed `--fold-unassigned` style is
SVG-export-only, so the one at-rest signal that something is undecided does not
render. Needs a dash slot — `MAX_DASH_SLOTS = 2` and both are spent in three of
the five line styles, so this is the fiddliest item here and the one most likely
to need a renderer change.

### 5. The propagation window's stalls get a consumer

`propagation_stalls` already ships the point, the reason and the unknown count
for every vertex propagation stopped at, and **nothing reads it**. The answer to
"which vertices did it not solve" is already in the payload. Make the window's
"Still undecided: N" navigable.

## Affected areas

- `crates/oristudio-cp/src/checks_spatial.rs` — `dispatched_camv`,
  `vertex_fan_at_with_sources`, `SpatialVertexReport`. The report type grows a
  verdict; the fan's decline paths stop being absences.
- `crates/oristudio-cp/src/checks.rs` — `find_flat_foldability_violation`'s
  silent `_ => {}` on unassigned creases (`:303`).
- `crates/oristudio-cp/src/solve_k.rs` — consumed by the checker for the first
  time. No change expected; it already answers every arity.
- `apps/web/src/cp-workspace/diagnostics/` — `hudStatus.ts` (the fourth tone,
  `:35`), `foldabilityMessages.ts` (new sentences, and the paired Rust test at
  `checks_spatial.rs:539` that pins the rule literals), `CpDiagnosticHud.tsx`.
- `apps/web/src/cp-workspace/foldPropagation/usePropagationDraft.ts` — stall
  navigation.
- The folded-figure blocked dialog.
- Rendering: `oristudioCpLineStyle.ts` dash slots, both scene adapters (pinned
  byte-identical), and `creaseExport` for parity with the canvas.
- i18n: roughly a dozen new strings × 9 locales.

## Checklist

### Phase 0 — the census

- [x] For every vertex in the validated corpus, record what each of the four
      verdicts *would* be, and where they disagree with today's output. Without
      this the change swaps one silent wrongness for another.
      **Result:** 9,132 vertices over 13 Tier A documents. 125 change from "not
      examined, displayed as success" to a named verdict — **1 Broken, 124
      Unknowable** (112 spatial boundary, 12 excused by an interior border), 0
      Undecided, because Tier A as shipped holds exactly one unassigned crease
      and it is the broken one. Zero unsplit junctions anywhere. Case 8
      confirmed: `airplane.fold` and `cubeunwrapping.fold` have no interior
      vertex at all and report clean.
- [x] Measure `solve_k`-in-the-checker cost on the live edit path at k ≤ 1,
      ≤ 2, ≤ 3. `CheckCamv` runs after every mutation, and one non-classic crease
      already costs 4.7×–33.5×.
      **Result:** 46 of the ~100 µs per k = 1 vertex was two whole-document
      rescans the caller already had in hand, and both are now passed in. k ≤ 1
      is **1.86×** the existing check on a 9,162-segment document with an eighth
      of its creases blanked, covering both halves of case 6. k ≤ 2 is the
      deep-check button; k ≤ 3 is nine times the per-vertex cost for nothing.

### Phase 1 — kernel verdicts

- [x] A verdict on every vertex report; declines become Unknowable, not absences.
- [x] Case 6 routed through `solve_k`, with the arity gate from Phase 0.
- [x] `Unsolvable` at k ≥ 1 becomes a **Broken** verdict — the `failure_case.osf`
      vertex must report.
- [x] Test with that file as a fixture: 1 broken vertex, named, at k = 1.
      Committed as `tests/fixtures/fold-angle/unreachable-undecided-vertex.fold`
      (that vertex minimised, runs in CI) and against the real `.osf` in
      `non_flat_corpus.rs`.
- [x] Not on the original list, and Phase 0 said it had to be: the flat-regime
      half of case 6, where dropping the undecided crease invented 2,030 errors.

Phase 1 also ships one **error** sentence — `ClosureUnreachable` — because a
kernel verdict nobody can read is the bug again. Undecided and Unknowable
deliberately produce no diagnostic entry yet; they need the fourth tone and their
own counts, which is Phase 2.

### Phase 2 — the HUD

- [x] The fourth tone, and counts that distinguish Undecided from Unknowable.
      `info`, blue, and it **survives `issueOnly`** — the always-on overlay says
      "18 vertices undecided" where it used to say nothing at all, and counts
      down to silence as the user commits creases. Errors still own the headline
      when there are any; informational rows are not issues, which is the rule
      the list's own aria-label already stated.
- [x] Case 8 (no interior vertices) stops reading as clean. `checked_vertices`
      rides on `CommandResult` — it is the denominator "no errors" is about, and
      there is no vertex to hang it on. Zero under an explicit check gives
      "Foldability: nothing to check"; the overlay stays quiet, or an empty
      document would wear a permanent badge.
- [x] Glyphs and click-to-locate for the new states. One diamond for both —
      filled where an answer is waiting, hollow where none can be given — at 7px
      against the error markers' 10, because these are the only diagnostics that
      appear in bulk on a *healthy* document.
- [x] Not on the original list: the list is now ordered worst-first. Kernel order
      is vertex order, which was fine while every entry was an error and useless
      the moment three errors could hide among seven hundred informational rows.

Two decisions Phase 2 made that are worth carrying forward:

- **`Unknowable::PaperEdge` gets no entry.** It is the one verdict where no
  closure condition exists, so there is nothing unexamined to report — and every
  3D document has a rim of them (33 on `ALL-combined.fold`). A row apiece would
  turn "nothing to check here" into a standing complaint. `checked_vertices` is
  where a document made *entirely* of them gets caught instead.
- **Undecided carries the angle, not the fact.** `fold_angle_degrees` is a second
  number beside `residual_degrees` rather than a reuse of it: one is a value to
  type in and the other is the size of a mistake. "This crease has no angle yet"
  is something the user already knows; `-143.2°` is not.

### Phase 3 — the other surfaces

- [x] The fold-blocked dialog links to the vertex entry. Joined by position at
      `checks_spatial::CELL`, since a refusal carries a point and nothing else,
      and resolved through `setOristudioCpActiveDiagnostic` so it reveals, frames
      and highlights by the HUD's own click-to-locate. Two things the offer had
      to get right beyond existing at all: it is built with the overlay treated
      as **on**, because accepting is what turns it on, and it says up front when
      the row it hands over reads the vertex differently — the folder measures a
      fan `selected_folding_segments` built after dropping every undecided
      crease, so "these creases do not close up" and "set this crease to −70.53°"
      are both true of one vertex. It is never withheld for that, because
      withholding puts "which vertex?" back where it started.
- [ ] Propagation stalls become navigable.
- [x] Unassigned creases get a canvas dash, matched in `creaseExport`. A third
      dash slot, which turned out to cost two `vec3` uniforms and one comparison
      in the vertex stage — nothing per segment, since `dashSlot` was already an
      attribute. The pattern is the `3 7` the SVG canvas used before the WebGL
      migration dropped it, so this restores a signal rather than inventing one.
      It dashes under **all five** line styles, including the two solid ones:
      `black-white` paints an undecided crease within a few units per channel of
      its valley grey, and the black-dot styles paint it the same black as a
      paper edge, so colour cannot carry the difference there at all.

## Open questions

1. ~~**How much solving belongs on the live edit path?**~~ **Answered: k ≤ 1.**
   Measured at 1.86× the existing check, after removing the two whole-document
   rescans the caller already had. k = 2 is 79.93% determined on real patterns
   and belongs behind a "check deeply" action; k = 3 belongs nowhere near the
   edit path.
2. ~~**Should Undecided count as a foldability issue?**~~ **Answered: no, its
   own count.** A lightly in-progress pattern is already 17–18% Undecided and a
   quarter-blanked one is ~60%, so folding them into the error count destroys the
   count. And 99.27% of k = 1 Undecided vertices carry an answer — "1,464
   vertices whose angle we can name" wants an apply-all action, not a list.
3. **Interior borders (case 7).** The warning says the vertices are not checked
   and nothing computes what checking would find — measured at 82.8° of hidden
   holonomy on `known-good/byu solar driven.fold`, a curated, clean, shipping
   file. In scope here or its own job?

## What this is not

- Not a change to what *folds*. Every verdict here is about what the app is
  willing to claim, not about the geometry.
- Not a rewrite of `check4`. The flat rules stay; case 6 stops bypassing them.
- Not "ignore unassigned creases and check the rest" — see the parity argument
  above. That is the current behaviour and it is the bug.
