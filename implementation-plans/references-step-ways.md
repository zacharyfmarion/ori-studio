# References: other ways to fold a step

## Goal

Every card in the References workspace presents one construction of its
crease — the planner's pick in *Folding sequence*, ReferenceFinder's in
*Find a reference* — when the paper at that step often offers several. A
diagonal is folded corner to corner, or by folding one edge onto the
other, or through two corners; a quarter line by bringing the edge to the
centre crease, or a corner to a mark. The reader should be able to see
that a step has other ways, switch between them, and read and animate each
exactly as a planned card — without the rest of the sequence changing under
them.

Zach (2026-09-24): "When there are multiple ways to fold a step in the
references tab, I want to be able to switch between them."

The planner already does the hard part. At every fold the ordering pass
enumerates and judges each construction the paper offers
(`order::candidates`, `score_witnesses`; the tools read the same through
`order::explain`) and keeps one — and `precrease-legible-picks.md` is a
record of folds where the reader wanted a different one of them. This plan
ships the runners-up; it does not change which one the planner picks.

Two things a way is not: R8's *also* is a second alignment of the same fold
drawn *with* the first, and a twin is a second fold made at once with it. A
way *replaces* the construction on the card.

Not in scope: re-planning the sequence around a chosen way (see *Later*),
saving choices in the document (the workspace never edits it), and choosing
between two ways of the same kind that differ only in which marks they use.

## What a way is

Another construction of **the same crease, from the paper as it stands when
the card is reached, that leaves the same paper behind.** For a fold placed
at step *k*, a witness `w` is a way when, on the *replayed* paper before *k*
(`quality::replay` — what earlier steps physically left, never the ordering
pass's `pinchable` spots):

1. **Free.** It is sighted without a press and without pinching anything
   new on an earlier fold (`witness_cost == 0`).
2. **Practical** (R0). An interior point onto another is never offered.
3. **Same crease.** The step's `made`, `pressed_on`, an auxiliary fold's
   pinches and every press of this line that shows this fold's witness all
   stay as they are, and `w` vouches for each of those spans (R10,
   `Vouch::error_at` ≤ `MAX_PINCH_ERROR`) wherever the planner's pick does.
   An O1 whose marks lie outside `made` is out: a crease through two marks
   runs mark to mark (`order::through_marks`).
4. **Same exactness** (`sequence::witness_is_exact` against the exact lines
   at *k*).
5. Its own mirror alignment (R8's `also`, `mirror_witness`) is taken on the
   same paper, or none.
6. **On a twin card**, a way is a pair: `w` and its image under the pair's
   symmetry, each a way of its own step by 1–5, of a kind the twin rule puts
   on one card (`order::one_card`).

So swapping in a way changes the card and nothing else: the paper after
step *k* is identical, and every later sighting, pinch, press, turn-over,
card number and total is as planned. That is what makes a switch free — no
re-plan, no worker round trip — and it is checked by a test that swaps in
every way of every step and replays the result (*Tests*), not trusted.

**Why `Step.witnesses` / `Step.chosen` are not already this.** `witnesses` is
the closure's certificate list: capped at sixteen per axiom in scan order,
recorded against the state before the round, never judged on the physical
paper, and most of it is not foldable where the card is (legible-picks R5
is the history). The pick chooses from a larger pool (`candidates`) that is
not shipped. And `Sequence.points` carries only the marks the chosen witness
and its `also` name (`planner.rs`, `referenced_points`), so any other
witness's marks do not even resolve on the web.

## Approach

### Planner: `Step.ways` (Folding sequence)

A new module, `crates/oristudio-precrease/src/order/ways.rs`, run by
`Planner::sequence()` on the final placement — after `order::optimize` and
`pinch::placed_pinch_pass`, so it describes exactly the steps emitted:

- **The paper.** Walk the placement with `quality::replay`, whose
  `before(k, &paper)` hook grows into a small context: the paper, the
  directions recorded so far (for `judge`'s `DirectionOfLine`) and the exact
  lines so far. One replay, not a second copy of it.
- **The pool.** `order::candidates` — the pick's own: recorded witnesses,
  `crease_between_marks`, `all_witnesses_for_card` — priced and judged by
  `score_witnesses`, filtered by rules 1–6.
- **The order.** The pick's own key: the `key` closure in `pick_scored`
  becomes a named `card_key` both use, so "why is this way second" has one
  answer, not a second opinion (AGENTS.md: one predicate per question). The
  presented witness is always first, even where `repick_to_vouch` or the
  three-times-as-accurate override chose it against the key.
- **One per kind, four at most.** Kind is `order::pattern` without its `!`
  — the axiom and the multiset of input kinds (`O2:cc` corner to corner,
  `O3:ee` edge onto edge, `O1:pp` through two marks …); the best of each,
  capped at `MAX_WAYS = 4` including the presented one. Both limits are for
  the reader, not for speed: the whole pool is judged either way — that is
  the only way to know which candidates qualify and which is best of its
  kind — so the cap saves only payload (a witness and its marks per way, in
  both presentation orders) and a few mirror and vouch checks. A reader
  asking for another way wants a different motion, not the same motion with
  another pair of marks, and ↑/↓ through a dozen O2s is not a choice.
  Phase 0 reports how many kinds a card actually has; if it is rarely more
  than four, the cap never binds and goes.
- **The wire.**

  ```rust
  /// Another construction of this step's crease that leaves the paper as
  /// the plan has it — see `ways`. `Step::ways[0]` is the presented one.
  pub struct Way {
      /// The construction, inline: `Step::witnesses` stays the closure's
      /// certificates.
      pub witness: Witness,
      /// Its own mirror alignment for the same fold (R8), when the paper has one.
      pub also: Option<Witness>,
      /// As `Step::alignment`, for this way.
      pub alignment: Option<f64>,
      /// What it was deduplicated by: `order::pattern` without its `!`
      /// (`O2:cc`). Sent with the analytics, so the web never re-derives it.
      pub kind: String,
      /// The first criterion of `card_key` on which this way ranks below the
      /// presented one — why the planner did not pick it. `None` for
      /// `ways[0]`.
      pub decided_by: Option<Criterion>,
  }

  /// The criteria of the card key that can separate two ways, in the key's
  /// order — the ones rules 1–3 have not already made equal (practical,
  /// free, not overlong, marks real). `Accuracy` is the numeric tail and
  /// the three-times override; `Plan` is a way the key prefers that the
  /// plan passed over for the sequence as a whole (a re-pick to vouch for
  /// a pinch, the optimiser, a twin).
  pub enum Criterion {
      CornerToCorner, Overlong, Visible, Precise, Local, Crossing,
      OneMotion, Ease, ThinFlap, Accuracy, Plan,
  }
  ```

  `Step::ways: Vec<Way>`, empty unless there are at least two. A press that
  presents its fold's witness carries the fold's `ways` verbatim (its
  `witnesses` list is already the fold's); a press sighted for itself, a
  grid step and a free line carry none. A twin pair's two lists are
  index-aligned: way *i* of one is the mirror of way *i* of the other.
- **`referenced_points`** gains every way's marks and its `also`'s, so both
  diagram frames resolve them and `planModelPoints` maps them to model
  space with no web change.
- **Both presentation orders.** `sequence(false)` and `sequence(true)` each
  compute their own — hoisting changes the paper — while the planner is
  still alive, as today.
- **Cost.** One pool enumeration per fold, on top of a `sequence()` that
  already spends up to `sequence_budget_ms` (10 s) ordering and optimising.
  Measured before landing (Phase 0); if it is too slow, keep each kind's top
  candidates from `sight`'s already-scored pool and only *validate* them in
  the replay.

The bridge needs nothing new for this mode: `Step` serialises the new field
`json_compatible` as it is.

### Web: one seam

Every consumer of a planner card already reads the presentation through the
step — the card and canvas diagrams (`diagram/plannerDiagram.ts`), the
letters (`inputLetters`), the sentence (`describePlannerStep`), the fold
animation (`diagram/foldMotion.ts`), all through `chosenWitness(step)`,
`step.also` and `step.alignment`. So a switch is a *presented* sequence, and
nothing downstream changes.

- **`cp-workspace/references/referencesWays.ts`** (new; pure, React- and
  store-free):
  - `waySignature(witness)` — axiom, typed inputs and root, as a string.
  - `presentedSequence(sequence, component, choices)` — the sequence with
    each chosen way swapped in (`chosen`, `also`, `alignment`, and the
    `ease`/`hard`/`err` it implies) on every step of the chosen line — the
    fold and the presses that follow it — and on its twin. Steps that did
    not change keep their identity. A choice whose signature is not among a
    step's ways (the other presentation order, say) falls back to the
    planner's pick.
  - `cardWays(sequence, viewStep, choices)` → `{ count, index } | null`,
    for the strip and the switcher.
- **`useReferencesBreakdown`** maps its `variants` through
  `presentedSequence`. The model (`decodePlanModel`) is untouched — ways move
  no segment and add no point after mapping — and the cards, the canvas,
  crease visibility, tap-to-jump and the fold transport all follow.
- **`useReferencesWays.ts`** (new, beside the concern, in the shape of
  `useViewportSurface`): the active card's ways; `previousWay`, `nextWay`,
  `chooseWay(i)`; the card-visit bookkeeping behind `references ways
  explored` (*Analytics*).
- **Store.** `ReferencesView.planWays: Readonly<Record<string, string>>` —
  `${component}:${line_id}` → way signature. By line, not step, so it
  survives the landmarks-first toggle (which renumbers steps from the same
  state) and a fold and its presses share it. Reset where a plan lands (the
  `activeStep: 0` reset in `useReferencesBreakdown`) and on a sheet switch
  (`DEFAULT_REFERENCES_VIEW`); transient like the rest of the slice.
- **The strip's cost.** `planFilmstrip` builds every card's primitives
  eagerly in a `useMemo` on the variants, so as written every switch would
  rebuild every card. Cache per (base sequence, step, way): a way changes
  only its own card, and the build-up of earlier creases is exactly what
  ways never touch.

### What it looks like

```text
 Find a reference │ Folding sequence                                    ⚙
 ‹  ┌────┐ ┌────┐ ┌────┐ ┏━━━━┓ ┌────┐ ┌────┐ ┌────┐                     ›
    │1   │ │2   │ │3   │ ┃4   ┃ │5   │ │6   │ │7   │
    │ ┆  │ │ ╱  │ │ ┼  │ ┃┆┼  ┃ │  ┼┆│ │ ┼  │ │ ┼  │
    │    │ │ ●○ │ │    │ ┃○●○ ┃ │ ●○ │ │    │ │ ●○ │   ← one dot per way;
    └────┘ └────┘ └────┘ ┗━━━━┛ └────┘ └────┘ └────┘     the one shown is filled
 4. Fold corner P onto point Q.
    Way 2 of 3  ⌃ ⌄
┌─────────────────────────────────────────────────────────────────────────┐
│          the pattern, with step 4's picture drawn for way 2             │
└─────────────────────────────────────────────────────────────────────────┘
```

- **On the card.** A card with other ways carries a row of dots at its
  foot, one per way, the one showing filled — so a card left on another way
  is visibly different in the strip with no other marker. Its accessible
  description adds "3 ways to fold this step; showing way 2". A card with
  one way looks exactly as it does today.
- **Under the sentence.** When the active card has two or more ways, the
  caption gains a row: "Way *n* of *m*" and up and down chevron buttons —
  a browser's find bar, whose keys match. No badge and no per-way notes:
  the planner's pick is always way 1, and the sentence and the picture say
  what each way is. Styled as the Find tab's "Solution *n* of *m*" readout
  (`ReferencesTargetControls`); the readout is `aria-live="polite"`. No row
  for one way.
- **Keys and menus.** ↑ previous way, ↓ next way
  (`references.previousWay` / `references.nextWay`) — free in every scope
  today; steps stay ←/→ and candidates Shift+←/→, so the strip reads as a
  grid: steps across, ways down. Through the shortcut registry and
  `runReferencesShortcut`; the chevrons and the context menu dispatch the
  same verbs from the action catalog (`previous-way`, `next-way`), gated on
  the active card's ways.
- **The canvas.** No new chrome: its arrow, letters, highlighted references
  and fold animation follow the card, and with Auto-play folds on, the new
  way plays as a newly selected card does.
- **Twin cards** switch both folds together: the card is one instruction.
- **Phone.** The row sits under the sentence, readout compact ("2 / 3"),
  targets finger-sized under a coarse pointer
  (`references-find-and-sequence-modes.md`). The floating bar stays the
  step transport.

Considered and not chosen: a chip per way naming its kind (a name per axiom
× input kinds, in nine locales, and the sentence already says it); a popover
listing every way's sentence (worth adding if four ways prove too many to
cycle); switching from the card's own dots (too small to hit, and nothing on
touch).

### Find a reference (Phase 2)

ReferenceFinder keeps one construction per line by design — `refContainer.h`:
"only one object is stored per key", lower rank winning, then lower score —
so its answers carry no alternatives, and the vendored core is not ours to
change (AGENTS.md). The ways come from the planner crate, over
ReferenceFinder's own construction:

- **`ways::for_construction(sheet, construction)`** (new, in `ways.rs`):
  builds a `State` and a `Creased` from an explicit construction — each
  ReferenceFinder line in order, whole or pinched at its mark — and runs the
  same pool, rules, key and cap per line, with ReferenceFinder's own
  construction as way 1 (matched by geometry). The result is
  `Sequence`-shaped in the unit frame, which *is* ReferenceFinder's frame
  (`sheet_frames` and the queries share it), so a Find way is drawn and
  described by the planner's code.
- **Bridge.** A stateless export `construction_ways(...)`, a worker method,
  asked lazily for the answer on screen and cached per (results, candidate).
- **Cards.** Way 1 stays ReferenceFinder's own picture; another way is
  `plannerStepDiagram` on the returned sequence, mapped onto the canvas by
  `diagramInModel` — as the diagonal cards already are
  (`referencesCandidateSteps.ts`). The sheet diagonals ReferenceFinder
  treats as free get ways too (corner to corner, through two corners, one
  edge onto the other).
- **Letters.** A Find answer names references by ReferenceFinder's labels
  (lines A–J, marks P–Z) across every card, where planner cards letter
  afresh per card. So `inputLetters` gains an optional label map: a Find way
  calls ReferenceFinder's line C "C", and only a mark ReferenceFinder never
  named gets a new letter.
- `ReferencesView.findWays`, keyed `${candidate}:${card}`, reset where the
  target hook resets `activeCandidate`. ReferenceFinder's own construction
  is always way 1, unlabelled, as the planner's pick is.

### Analytics

A switch is a reader saying the planner's pick was not the fold they
wanted — the first direct signal of which picks confuse people. The event
is built so that a pattern of overrides points at the rule in the key that
produced it, not only at a count.

**`references ways explored`** — once per card visit on which the reader
changed the way at least once, sent when the visit ends: another card, the
other mode or sheet, a new plan, the panel closing (best effort on page
hide). Per visit rather than per press, so cycling through three ways and
settling back on the first reads as one look that *confirmed* the pick, not
three switches. At most once per card per plan unless the settled way
changes, so walking back and forth past a card sends nothing new.
Hand-placed in `useReferencesWays`: these verbs dispatch through the
References executor, not `handleMenuAction`, as `references step jumped`
does.

| Property | Values | Answers |
| --- | --- | --- |
| `settled` | `recommended` / `alternative` | Did they keep the planner's pick after looking? |
| `from_kind` | the pick's kind code (`O2:cp`, `O3:el` …) | Which step types get looked at, and which get abandoned |
| `to_kind` | the settled way's kind code | What they prefer instead |
| `decided_by` | `corner_to_corner` / `visible` / `precise` / `local` / `crossing` / `one_motion` / `ease` / `thin_flap` / `accuracy` / `plan` / `none` | Which rule of the key the reader overruled |
| `ways`, `viewed` | `2`–`4` | How many were offered; how many they looked at |
| `step_kind`, `twin` | `cp` / `aux`; boolean | |
| `tab` | `sequence` (`find` in Phase 2) | |

`decided_by` is what turns a trend into a change: overrides piling up on
`one_motion` say one-motion-before-two-hands sits too early in the key; on
`corner_to_corner`, that the diagonal's special case is wrong. It comes
from the crate (`Way::decided_by`), computed by the same `card_key` the
pick sorts with, so the dashboard and the planner cannot disagree about why
a way lost. Every event already carries `app_version`
(`analytics/bootstrap.ts`), so a change to the key reads release over
release.

Beside it: `references fold played` gains `way` (`recommended` /
`alternative`) — an alternative watched, not only glanced at; and `folding
steps completed` gains `cards_with_ways_bucket` — how much of a plan offers
a choice at all.

**What it does not measure.** How often each kind is *shown*: per-card kinds
for every card viewed add up to the sequence's kind histogram, which
`docs/analytics.md` rules out because it fingerprints the design. The rate
that needs no exposure is exact — of the readers who explored an O5 card,
how many left it on another way. How often each kind prompts a look at all
is read against the corpus's own distribution of kinds (Phase 0's
`measure_ends` tallies), which is an estimate. And a confusing step with
only one way sends nothing here.

**The privacy line moves, a little (Zach, 2026-09-24).**
`docs/analytics.md` (added with the References workspace, `ac962333c`) says
nothing about a sequence's witnesses or an axiom histogram leaves the app,
because a sequence's shape is its design's and a distinctive design can be
recognised from it. That is the References reading of the public FAQ
("never your files, your crease patterns, their geometry or your images").
A kind code is metadata about how the app folded one step, not the pattern:
an enum from a closed catalogue, as `cp tool favorited`'s `action` is, sent
only for cards the reader explored, with no references, coordinates, step
numbers or per-plan counts by kind. No cap per plan — Zach: "we're not
sending the actual crease pattern". The paragraph gains exactly this
exception.

## Tests

- **Crate, `ways.rs`.** Bare square: the diagonal's ways are corner to
  corner (first), the corner bisected, through two corners; a vertical
  midline offers edge onto edge and corner onto corner; a step with
  `pressed_on` offers only ways that vouch for it; an O1 whose marks lie
  beyond `made` is not offered, an impractical O2 never; one per kind, at
  most `MAX_WAYS`; a twin pair's ways are index-aligned mirrors; presses
  carry their fold's. `decided_by` pinned on the diagonal: the bisected
  corner lost on `corner_to_corner`, the crease through two corners on
  `one_motion`.
- **The drop-in invariant.** For every step of the fixture plans (and the
  markhor pins, gated on `ORI_PRECREASE_MARKHOR` as they already are), swap
  each way in (`Placed.found`/`chosen`/`also`) and `quality::evaluate` the
  result: `unavailable`, `pinches_beyond`, `unknown_pinch_precision`,
  `approximate_folds`, `uncovered`, `lost_ends`, `presses`, `extra_length`
  and `cards` equal the plan's. This is the claim the design rests on.
- **Wasm.** `tests/node.rs`: `ways` on a known step; every way's marks are
  in `points`.
- **Web.** `referencesWays.test.ts` — apply a choice, identity kept for
  unchanged steps, a twin card switches both, presses follow, a stale
  signature falls back, the landmarks toggle keeps a choice by line;
  `referencesFilmstrip.test.ts` — the dots; `ReferencesStepFilmstrip.test.tsx`
  — the row, its dead ends, `aria-live`; `referencesActions.test.ts` —
  gating; `referencesShortcuts.test.ts` — exhaustiveness; the
  `useReferencesWays` hook — store binding, reset on a new plan, and the
  visit: none sent without a switch, `settled: recommended` after cycling
  back, the kinds and `decided_by` when left on another way, nothing new on
  a second visit that settles the same, a new plan ending the visit; the
  panel's hook-order test through a switch. `__fixtures__/plannerSequence.ts`
  gains a step with ways.
- **Browser.** In the pane, on the debugging square and on markhor: the
  diagonal's card through its three ways — card, sentence, canvas letters
  and arrow, fold animation; a twin card switching both folds; a switched
  card's dots surviving a walk away and back; the phone viewport's row.

## Affected Areas

- `crates/oristudio-precrease/src/order/ways.rs` (new) — the enumeration,
  the rules; Phase 2's `for_construction`.
- `crates/oristudio-precrease/src/order.rs` — `card_key` out of
  `pick_scored`; `candidates`, `score_witnesses`, `mirror_witness`,
  `one_card` and `pattern` visible to `ways`.
- `crates/oristudio-precrease/src/quality.rs` — the `before` hook's context.
- `crates/oristudio-precrease/src/sequence.rs` — `Way`, `Step::ways`.
- `crates/oristudio-precrease/src/planner.rs` — `sequence()` runs `ways`;
  `referenced_points`.
- `crates/oristudio-precrease/examples/measure_ends.rs` — ways per card,
  time, payload; `crates/oristudio-precrease/README.md`.
- `crates/oristudio-precrease-wasm/src/lib.rs` — Phase 2's
  `construction_ways`; `tests/node.rs`.
- `apps/web/src/cp-workspace/references/` — `precreaseSequence.ts`
  (`PrecreaseWay`, `PrecreaseStep.ways`); `referencesWays.ts` and
  `useReferencesWays.ts` (new); `useReferencesBreakdown.ts`,
  `referencesFilmstrip.ts`, `ReferencesStepFilmstrip.tsx`,
  `referencesActions.ts`, `referencesShortcuts.ts`,
  `referencesContextMenu.ts`, `__fixtures__/plannerSequence.ts`. Phase 2:
  `referencesCandidateSteps.ts`, `useReferencesTarget.ts`,
  `useReferencesView.ts` (`useReferencesHighlights`),
  `diagram/inputLetters.ts`.
- `apps/web/src/workers/precreaseWorker.ts` and its client — Phase 2.
- `apps/web/src/keyboard/shortcuts.ts`, `apps/web/src/i18n/shortcutLabels.ts`.
- `apps/web/src/store/workspaceStore/types.ts`,
  `slices/referencesSlice.ts`.
- `apps/web/src/components/panels/ReferencesPanel.tsx` — composition only:
  the ways props to the strip, about fifteen lines, well inside the cap.
- `apps/web/src/styles/theme.css` — the dots, the caption row.
- `apps/web/src/analytics/events.ts`; `docs/analytics.md` — the event rows
  and, once agreed, the exception in its References privacy paragraph;
  `docs/references-workspace.md` ("Other ways to fold a step").
- Locales: nine `panels.json` and `tools.json` — the readout, the card
  description, the shortcut labels.

## Checklist

- [x] **Phase 0 — measure.** `examples/measure_ways.rs` (below); `MAX_WAYS`
      settled at four; ways enumerated afresh on the replayed paper.
- [x] **Phase 1a — crate.** `CardKey`/`card_key` extracted with no behaviour
      change (every pin holds); `order/ways.rs`; `Step::ways`;
      `referenced_points`; crate tests and the drop-in invariant.
- [x] **Phase 1b — bridge and types.** Wasm node test; TS types.
- [x] **Phase 1c — web.** `referencesWays.ts`, `useReferencesWays.ts`; the
      presented variants in `useReferencesBreakdown`; `planWays` and its
      resets; the per-card picture cache in the strip.
- [x] **Phase 1d — UI.** Dots on cards; the row under the sentence; ↑/↓,
      the catalog and the context menu; phone targets; nine locales;
      `docs/references-workspace.md`.
- [x] **Phase 1e — analytics.** `references ways explored` and its visit
      bookkeeping; `way` on `references fold played`;
      `cards_with_ways_bucket`; the doc rows and the privacy exception.
- [x] **Phase 1f — verification.** Lint, typecheck, unit tests;
      `cargo test -p oristudio-precrease`; the wasm build and node tests; the
      pane on a square with both diagonals, both midlines and two quarter
      lines. Not yet on markhor, and not on a phone.
- [ ] Zach reads a sequence with it.
- [ ] **Phase 2 — Find.** `ways::for_construction`, `construction_ways`;
      the lazy fetch and cache; planner-drawn ways on Find cards and the
      canvas; ReferenceFinder's labels in `inputLetters`; diagonal cards;
      tests; the pane on the sheet centre and a crease target.

## What landed (2026-09-24)

Folding sequence only; Find is Phase 2. Where it differs from the above:

- **The module is `order/ways.rs`**, beside `search` and `construction`, so it
  reads the pick's own helpers (`candidates`, `sightable`, `witness_cost`,
  `mirror_witness`, `one_card`) without widening them. `quality::replay` hands
  its hook a `ReplayAt` (the paper, the directions and exact lines so far).
- **`Way` carries its witness inline** rather than an index into
  `Step::witnesses`: appending ways there changed what that list means (the
  closure's certificates), which the bird-base pin caught. The web appends the
  way's witness to its presented copy of the step instead.
- **A seventh rule, found by the drop-in test: a way leaves the auxiliary
  pinch pass as it is.** The pass creases an auxiliary line whole where a
  later step lines it up as a line, and pinches it at every mark a later step
  names on it, so a way that landed on a pinched auxiliary line, or named a
  mark on one the plan does not pinch, would crease more of an earlier fold
  than its card says (`AuxPinches::keeps`). The invariant replays with the
  plan's own pinches (`quality::evaluate_with`), as the web shows every other
  card; a way that no longer uses an auxiliary fold's mark leaves that fold in
  the sequence, and its pinch unused.
- **Kind is `ways::kind`**, `order::pattern` with interchangeable inputs in a
  fixed order (`O2:cp` either way round), not `pattern` itself.
- **Cheap tests first.** A way is free, so no press is priced for one:
  exactness, the crease, the pinch pass, sightability and the vouches are
  asked before a candidate is judged at all.

Measured with `cargo run --release -p oristudio-precrease --example
measure_ways -- --check <curated corpus>`, on the 43 designs that plan
without the ReferenceFinder fallback, the plan's own placement:

| | |
| --- | --- |
| cards with a second way | 2,383 of 2,896 (82.3%) |
| ways per such card | 2: 326 · 3: 316 · 4: 1,741 (the cap binds) |
| time to find them, per ordering | p50 54 ms · p90 235 ms · max 776 ms (native release) |
| plan JSON | +2.9% |
| ways swapped in and replayed | 5,968, none changed the plan |
| `decided_by` | local 1,843 · visible 1,047 · ease 759 · precise 670 · one motion 650 · crossing 386 · plan 368 · accuracy 345 · corner to corner 105 · overlong 8 |

In the product runtime — the planner's wasm, `main` against this branch on
the same 43 designs, each planned as the web's driver plans it and then
ordered both ways — finding ways adds:

| | p50 | p90 | worst |
| --- | --- | --- | --- |
| planning today (`main`, product settings) | 8.8 s | 30.2 s | 101.5 s |
| added (both orderings) | +116 ms | +502 ms | +1.59 s (markhor-detailed) |
| as a share of planning | +1.7% | +3.8% | +7.3% |

+11.0 s on 614 s over the corpus (+1.8%). The added time is the difference
in `sequence()` with the optimiser off (median of three; deterministic work,
where the optimiser's wall-clock budget is noisier than the effect), and the
share divides it by the product-settings plan on `main`. The browser also
asks ReferenceFinder when stuck, so its plans are longer and the share
smaller. The next lever, if the cost ever shows, is to keep each kind's best
from `sight`'s already-scored pool and only validate it here.

## Decisions (Zach, 2026-09-24)

1. **Folding sequence first, Find second.** The first mostly ships what the
   ordering pass already computes; the second needs a new enumeration over
   ReferenceFinder's answer and a label map.
2. **One way per kind, at most four** — a different motion, not the same
   motion with other marks. Not a performance limit (*The planner*); it
   stands until Phase 0 shows whether it ever binds.
3. **No per-way notes, and no "Recommended" badge** for now. The planner's
   pick is always way 1.
4. **↑/↓ for ways.**
5. **Choices reset when the plan is recomputed**, including by the settings
   that re-plan (Merge symmetric steps, the grid): a new plan can change the
   paper a way was judged on.
6. **Step kinds go in the analytics** (*Analytics*), with no per-plan cap.

## Later

- **A way the rest of the plan works around** — one that needs a press, or
  leaves a different crease. The machinery exists:
  `order::search::replay_order` takes per-fold `choices`, and `sight`
  honours a preferred witness without bypassing any eligibility check. The
  cost is a planner kept alive per sheet (it is disposed after `sequence()`
  today) or a re-plan measured in seconds, and card numbers, pinches and
  presses that move under the reader. Worth it only if drop-in ways prove
  too few, which Phase 0 will say.
- **Presses sighted for themselves** getting ways of their own.
- **Choices saved** with the document, or as a preference ("always corner
  to corner") — which makes them planner input rather than presentation.
