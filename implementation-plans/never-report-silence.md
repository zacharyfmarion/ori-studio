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
| **2** | 29% determined as stored, **79% with a direction hint**, branching otherwise | Determined → the angle. Branching → *"two ways to close this"*. Family → not pinnable. |
| **3** | Exactly determined; unique ~5% of the time | Same three outcomes, mostly branching |
| **≥4** | **Structurally underdetermined** (Jacobian is k×3) | *"Too many undecided creases here to say"* — the one honest abstention, and it names why |

> **The failing vertex in `failure_case.osf` is k = 1.** The app could have told
> the owner the exact angle that closes it, or that none does. It said nothing.

**This settles the earlier proposal to "ignore unassigned creases and check the
rest".** That is already what `find_flat_foldability_violation` does
(`checks.rs:294` — the match arm is `_ => {}` and `is_folding_line()` excludes
`None`), and it is the cause of the false clean. On this vertex it would drop
degree 3 to degree 2 and report nothing useful. Worse, Maekawa needs
`|M − V| = 2` with `M + V = degree`, and those share parity — so it can only hold
at **even** degree. Dropping one crease from a degree-4 vertex guarantees a
false *error*. The rule fails in both directions depending on parity.

**Solve the unknown instead of deleting it.**

### The verdicts, and where each surfaces

Four kinds, not two. The HUD tone union is `'ok' | 'warn' | 'error'` today
(`hudStatus.ts:35`) and needs a fourth.

| Verdict | Meaning | Surface |
| --- | --- | --- |
| **Fine** | Checked, it closes | Counts toward "OK"; no entry |
| **Broken** | Checked, it does not close, or violates a flat rule | Error entry, glyph, click-to-locate. **Exists** |
| **Undecided** | Solvable in principle, not yet decided | **New** — its own count and glyph, and where possible the *answer*: the angle that would close it, or the two that would |
| **Unknowable** | Boundary, unsplit junction, k ≥ 4, or excused by an interior border | **New** — quiet, but present, so a document of them never reads as clean |

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

- [ ] For every vertex in the validated corpus, record what each of the four
      verdicts *would* be, and where they disagree with today's output. Without
      this the change swaps one silent wrongness for another.
- [ ] Measure `solve_k`-in-the-checker cost on the live edit path at k ≤ 1,
      ≤ 2, ≤ 3. `CheckCamv` runs after every mutation, and one non-classic crease
      already costs 4.7×–33.5×.

### Phase 1 — kernel verdicts

- [ ] A verdict on every vertex report; declines become Unknowable, not absences.
- [ ] Case 6 routed through `solve_k`, with the arity gate from Phase 0.
- [ ] `Unsolvable` at k ≥ 1 becomes a **Broken** verdict — the `failure_case.osf`
      vertex must report.
- [ ] Test with that file as a fixture: 1 broken vertex, named, at k = 1.

### Phase 2 — the HUD

- [ ] The fourth tone, and counts that distinguish Undecided from Unknowable.
- [ ] Case 8 (no interior vertices) stops reading as clean.
- [ ] Glyphs and click-to-locate for the new states.

### Phase 3 — the other surfaces

- [ ] The fold-blocked dialog links to the vertex entry.
- [ ] Propagation stalls become navigable.
- [ ] Unassigned creases get a canvas dash, matched in `creaseExport`.

## Open questions

1. **How much solving belongs on the live edit path?** k = 1 is cheap and is the
   case that bit. k = 3 may not be affordable after every keystroke. Phase 0
   decides; a "check deeply" button is the fallback if it is not.
2. **Should Undecided count as a foldability issue?** It is not an error, and a
   pattern mid-design is full of them. Probably its own count beside the error
   count, not folded into it — but that is a product call.
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
