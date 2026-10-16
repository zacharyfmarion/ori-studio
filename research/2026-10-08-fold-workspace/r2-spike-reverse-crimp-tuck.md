# Compound-fold spike: inside and outside reverse folds, crimps, tucks

All code, results and renders are in `/Users/zacharymarion/Documents/code/tree-maker-rust/.claude/worktrees/fold-workspace-research-c52ced/artifacts/fold-spike/compound/reverse-crimp-tuck/b/`. Paths below are relative to that folder. No tracked file changed. I ran everything on Node v26.8.1 with no dependencies, importing `core/` without modifying it.

**Why `b/` and not the folder above it.** Between about 08:08 and 08:12, another writer edited files in `reverse-crimp-tuck/` while I was working:
- it added `paths.mjs`, `crimp-campaign.mjs` and `shot.mjs`;
- it gave `crimp.mjs` an `opening2: 'same'` option;
- it changed output paths in `cases.mjs` and rewrote `replay-crimp.mjs`.

I sent a message to the one listed subagent, `a121eae2172899bfb`, but it came back to me as an incoming message, so I could not tell who the other writer was. I froze the code into `b/`. I kept those changes (the `'same'` opening is used below) and ran every number in this report from `b/`. The top-level files may now differ from `b/`.

## Summary

**One primitive covers all three families.** That primitive is "reflect blocks across ℓ with placements" (`blocks.mjs:280`, after Beloch def-reflection):
- **Reverse fold:** two blocks.
- **Tuck:** one block placed against a named layer.
- **Crimp:** two such steps evaluated as one op, with only the final state verified.

The crease-pattern (CP) and geometry stage is exactly core's simple-fold split. A reverse fold's CP is the CP of a simple fold of the whole tip; only the order and the letters differ.

**The letter rules hold without exception in the random campaigns:**
- Across-opening spine creases flip M↔V and all other tip creases keep their letter: 0 mismatches in 8,819 valid reverse states.
- New creases where a spine crosses ℓ take the body-side spine letter (inside) or the opposite letter (outside): 23,426 of 23,426 checks.

**FOLD triples.** Pairs in the same block need no update (1,076 of 1,076). Pairs across blocks always flip (1,528 of 1,528). So core's claim that "moving–moving triples need no update" is false for reverse folds.

**The order cannot be fully determined by a per-pair rule.** Beloch's placement rule for layers outside the block's own body:
- produces cycles: 84 `cell-order` failures in body-relative outside folds;
- makes wrong decisions when a layer overlaps no face of T (the "vacuous" case).

Measured against cases where a valid state of that kind exists, the rule state is valid in:
- inside reverse: 98.9%;
- outside reverse: 96.2% (body-relative rule) or 98.0% (Beloch's literal top/bottom rule);
- inside crimp: 99.0%; outside crimp: 96.7%;
- tuck: 91.0%.

**A hybrid works much better.** The hybrid is: fixed pairs (stationary pairs, block pairs, each block against its own body or target) plus Flat-Folder (FF) completion of the rest. When a state of that kind exists, it is unique in:
- inside reverse: 99.4%; outside reverse: 99.3%;
- inside crimp: 99.0%; outside crimp: 98.9%;
- tuck: 99.1%.

The remaining cases are real alternatives, mostly 2 or 3 states.

**Seeded with all unaffected pairs** (stationary pairs plus every moving–moving pair), FF completes a reverse fold uniquely in 79.9% of cases where any completion exists. The leftover choice is mostly inside vs outside. Given only the CP and its letters, the order is often not unique, so it must be stored:
- 2 to 4 states on 4-layer flaps;
- 15–17% of crimps have more than one state.

**The kind is usually forced by geometry.** On a 2-layer flap with a generic line, exactly one of inside and outside is valid (cases 1a, 1b, 1d). Across random states, both are valid in only 2.1% of non-perpendicular ops, against 62.6% when ℓ is perpendicular to the spine.

**Beloch's definitions are incomplete in four places:**
- **Literal outside rule.** Placing T1 at the bottom and T2 on top fails when the flap is part of a larger stack (case 2c). Placing each block against its own body fails elsewhere (80 campaign cases). Neither rule is always right; completion covers both.
- **One opening per tip.** This cannot express the natural reverse of two stacked flaps. Each flap opening at its own layers (4 blocks) is valid (2b).
- **Crimps as two valid reverse folds.** In 4.5% of valid inside crimps and 5.6% of valid outside crimps, the first reverse alone is not flat-valid. A crimp must be one op.
- **Tucks.** Beloch's "outward closure up to the target" (ADR 0052) is necessary (case 4d). The literal reading of a layer that overlaps no face of T breaks 66 tucks that do have a unique valid "immediately under T" state.

**Verifier agreement.** FF and the independent checker agree on 28,917 of 28,918 states. The one disagreement is a sliver overlap 1.6e-4 deep with area 3e-8 that FF's arrangement missed. It is a numerics issue, not a theory issue.

## Conventions and terms

These are core's conventions: valley rotates toward the viewer and lands on top; a crease is V iff its front-up face lies below; T is derived by BFS from a root face; tolerance is 1e-6; snapping is on. I used μ = 1e-3 throughout.

| Term | Meaning |
|---|---|
| **Tip** | The least set of pieces on side H containing the anchor, closed under hinges of any assignment (M, V, F) that lie off ℓ and have material in H (`reverse.mjs:37`) |
| **Opening** | A split of the tip into a lower block T1 and an upper block T2: no T1 piece lies above an overlapping T2 piece, there is at least one hinge across, and every across hinge is M/V on one line s, the spine (`reverse.mjs:83`) |
| **Bodies** B1, B2 | The stationary pieces hinged on ℓ to T1 and T2 |
| **Admissible** | Both bodies are non-empty, and B1 lies below B2 wherever they overlap |
| **S** | Seed with stationary pairs only |
| **SB** | S plus pairs within one block |
| **SBX** | S plus every moving–moving pair (the "unaffected pairs") |
| **SBL** | SB plus the letters of the op's new or flipped creases (a CP diff) |
| **H0** | SBX plus each block against its own body or target |
| **H1** | H0 plus the rule's non-vacuous placements |

## Operation 1: inside and outside reverse fold (`reverse.mjs`, `blocks.mjs`)

**Inputs:**
- ℓ in the folded frame;
- tip side H;
- an anchor: a point with all layers, k from top or bottom, or explicit faces;
- the kind: inside or outside;
- an opening index, only when more than one opening is admissible;
- optionally, per-flap openings (`reverseFoldMulti`, `reverse.mjs:178`).

**Preconditions:**
- No tear: a hinge off ℓ joining a moving and a stationary piece refuses the op (`blocks.mjs:80`).
- At least one admissible opening exists. 148 of 4,601 random attempts had none.

**What moves.** Every H-piece of the tip, reflected across ℓ; both blocks use the same reflection.
- Inside: T1 rotates up and lands just over B1; T2 rotates down and lands just under B2.
- Outside: T1 lands just under B1; T2 lands just over B2.

**CP change.** Identical to a simple fold of the whole tip:
- one new vertex per crossed CP edge, placed by edge parameter;
- chords along ℓ through every tip face that crosses it;
- the core's F↔folded toggles on ℓ.

Letters are derived from the order:
- across-opening spine halves flip;
- other hinges in the tip keep their letter;
- new chords where an across hinge crosses ℓ take the body-side letter (inside) or the opposite letter (outside).

**Order:**

| Pair | Rule |
|---|---|
| stationary–stationary | unchanged |
| same block | reversed in absolute terms (FOLD triple unchanged) |
| different blocks | kept in absolute terms (`crossBlock:'keep'`, `blocks.mjs:324`; FOLD triple flips) |
| block vs its own body | inside: over B1 / under B2; outside: under B1 / over B2 |
| block vs other stationary layers | Beloch's per-pair rule (`blocks.mjs:215`), or FF completion (recommended) |

Before I added `crossBlock:'keep'`, deriving the cross-block order from the placements left pairs undefined whenever the bodies do not overlap. That produced 3 `overlap-missing` and `letters` failures in a 300-setup smoke run (repro `rev-otherfail-1-38-1`).

**Concrete cases.** All are on the diagonal triangle unless noted.

| Case | Result | States from CP + letters | S / SB / SBX / SBL |
|---|---|---|---|
| 1a inside, y=0.5 (preliminary-base step) | valid | 1 | 3/3/1/1 |
| 1a outside, same line | invalid (taco-tortilla) | – | 3/3/1/conflict |
| 1b outside, x=0.5 (both outside rules) | valid | 1 | 3/3/1/1 |
| 1b inside, same line | invalid | – | – |
| 1c ℓ ⟂ spine, inside and outside | both valid | 1 each | 4/4/2/1 |
| 1d lines at 100° and 195° through (0.7, 0.3) | exactly one kind valid each | 1 | 3/3/1/1 |
| 1e preliminary base (two inside reverses) | valid | 1 | 3/3/1/1 |

In 1a with S seeds, the 3 completions are the inside reverse plus the simple valley and mountain folds of the tip. Their letter signatures are MVV, VVM and VMV. SBX keeps only MVV.

**Uniqueness.** Given ℓ, side, anchor, kind and opening, the end state is unique by H0 in 99.4% (inside) and 99.3% (outside) of feasible cases. Without the kind, SBX is unique in 79.9% of feasible cases. Without block information, S gives 3 to 46 states.

## Operation 1b: reverse fold through four layers

**2a, the 4-layer strip** (Beloch's fig-reverse-open): book fold, then book fold again; reverse the lower half along y=0.5. There are 2 admissible openings. Both kinds are valid on both, because ℓ is perpendicular to the spine. Stacks from `dbg-stack.mjs` (bottom to top):
- **Opening between the inner layers** (both spine hinges turn): U1 < U2 < D2 < D1 < D4 < D3 < U3 < U4.
- **Opening above the outermost layer** (only the outer hinge turns; the three inner layers go in as one packet): U1 < D1 < D4 < D3 < D2 < U2 < U3 < U4.

Both are structurally consistent with Beloch's captions (`beloch/spec/MODEL.md:1446-1462`). I could not map his layer numbers exactly. FF states from CP + letters: 1 (inner opening, inside) and 2 for the other three variants. SBL = 1 for all four.

**2b, the triangle folded in half again** (two separate 2-layer flaps over the corner). The tip has 2 hinge components. The single-opening definition gives 2 admissible openings, and every variant is valid:
- {L1} | {L2, L3, L4}: the upper flap goes into the lower flap's pocket.
- {L1, L2, L3} | {L4}: the lower flap goes into the upper flap's pocket.

The per-flap reverse is what a folder does: L1s < L1′ < L2′ < L2s < L3s < L3′ < L4′ < L4s. It is valid, with CP + letters giving 1 state for inside and 3 for outside. Beloch's definition cannot express it.

**2c, reversing only one of the two 2-layer flaps** (the "outer two layers" case). Inside is valid. The body-relative outside rule is valid. Beloch's literal outside rule (T1 bottom, T2 top) is **invalid** for both the lower and the upper flap. It wraps the other flap: taco-tortilla, plus `not-a-solution`.

"The outer two layers only", read literally, is not a tip here: L1 and L4 are not hinged in the tip region. The meaningful variants are 2a's outer-hinge opening and 2c.

**Random campaign** (`campaign-reverse.mjs`, seeds 1–3, 3 × 1,500 random states of 1–4 folds, ≤60 faces):
- 4,453 ops, giving 5,740 (op, opening) pairs and 17,220 rule states.
- The tip had 2 faces in 52% of ops and up to 16 faces.
- 25.1% of ops had 2–5 admissible openings.

| | inside (body rule) | outside (body rule) | outside (Beloch literal) |
|---|---|---|---|
| rule valid | 2,995 | 2,885 | 2,939 |
| a state of this kind exists (H0 not in conflict) | 3,029 | 2,998 | 2,998 |
| H0 unique / ambiguous | 3,010 / 19 | 2,978 / 20 | – |
| H0 finds a unique state while the rule is invalid | 29 | 112 | – |
| failure categories | seeded-conflict 2,744 | seeded-conflict 2,855, cell-order (cycle) 84 | seeded-conflict 2,801 |

- **SBX completions:** 602 conflicts (no valid state with that block structure). Counts: 1 in 4,107 cases, 2 in 846, 3 or more in 185.
- **Block-vs-body class of the 6,717 solutions:** over/under (inside) 3,049; under/over (outside) 3,029; over/over 162; under/under 164; mixed 313. The last three are valid states that are neither kind.

## Operation 2: inside and outside crimp (`crimp.mjs`)

**Inputs:** two lines on the current folded frame, both crossing the flap's spine and not meeting over the model:
- ℓ1, nearer the body;
- ℓ2, nearer the tip.

Also the tip side of ℓ1, an anchor, a point on the tip, and the kind.

**What moves:**
- The strip between the lines is reflected by ρ1.
- The tip beyond ℓ2 is moved by ρ1∘ρ2: a rotation about ℓ1∩ℓ2, or a translation when the lines are parallel.

**Evaluation:**
1. op1: reverse at ℓ1, of the given kind, of everything beyond ℓ1.
2. op2: reverse at ρ1(ℓ2), of the same kind, of the moved material beyond it. Its opening must be between the same layers as op1's (`opening2:'same'`).
3. Verify the final state only.

Inside crimp = inside + inside; outside crimp = outside + outside.

**CP change:** chords on ℓ1 and ℓ2 through every layer of the flap.

**Order:** the composition of the two reverse-fold orders. On the 2-layer triangle (`dbg-crimp.mjs`, bottom to top; B = body, S = strip, P = tip, b/t = bottom/top layer):
- inside crimp: Bb < Sb < Pb < Pt < St < Bt
- outside crimp: Pb < Sb < Bb < Bt < St < Pt

**Concrete cases** (`3-crimp-*`), with ℓ1 perpendicular to the spine:
- **ℓ2 at 36.87°** (lines meet beyond the spine): only the inside crimp is valid.
- **ℓ2 at 53.13°** (lines meet beyond the raw edges): only the outside crimp is valid.
- **Parallel lines:** both are valid.
- **Mixed kinds** (inside + outside, outside + inside): invalid in all 6 cases.
- **Counts:** every valid crimp has 1 state from CP + letters, and SBX/SBL = 1.

**Random campaign** (`campaign-crimp.mjs`, 2 × 1,500 states; 2,929 ops; 2,682 evaluated per kind combination):

| | inside crimp | outside crimp |
|---|---|---|
| rule valid | 1,536 (57%) | 1,416 (53%) |
| final valid but op1 alone invalid | 69 | 80 |
| CP + letters unique | 1,305 of 1,536 | 1,177 of 1,416 |
| SBL unique (block structure + crease letters) | 1,477 | 1,385 |
| H0: a state exists / unique | 1,551 / 1,535 | 1,465 / 1,449 |

- Both crimp kinds were valid in 816 of 1,183 parallel ops but only 18 of 1,746 non-parallel ops. In 629 non-parallel ops neither kind was valid.
- The mixed combinations were valid in 224 and 361 of 2,682. Those are a different fold (reverse, then counter-reverse), not crimps; I did not inspect them further.
- A worked example of an invalid op1 is repro `crimp-intermediate-invalid-1-113`, rendered as `renders/cx-inside-op1.svg` (invalid) and `cx-inside-crimp.svg` (valid). Reflecting the whole long tip across ℓ1 pierces another crease; the crimp, which reflects only a narrow strip, does not.

## Operation 3: tuck, a fold placed over or under a layer T (`tuck.mjs`)

**Inputs:** ℓ, side, a seed (the depth flap), and a placement: under T (valley-like) or over T (mountain-like), with T named as stationary faces.

**Moving set.** The seed, plus:
- hinge closure;
- every candidate that lies above (for under T) or below (for over T) a moving piece and on the near side of every T face it overlaps (Beloch ADR 0052).

**Order:**
- stationary pairs unchanged;
- the block is reversed internally;
- the block lies immediately under or over T;
- other layers by rule, or by FF completion (H1, recommended).

**Concrete cases:**

| Case | Result |
|---|---|
| 4a bottom corner tucked under the top layer | valid |
| 4b top corner mountain-folded into the pocket | valid |
| 4c pocket: under A and on top of A | both valid |
| 4c3 band too deep (passes A's hinge) | invalid |
| 4d loose layer, outward closure | valid |
| 4d loose layer, hinges-only closure | invalid (taco-tortilla) |

- Core's transitive rule agrees on 4a–4d.
- **4c needs the placement as an explicit input.** CP + letters give 2 states and SBL = 2: under A and on top of A have the same crease letter.

**Random campaign** (`campaign-tuck.mjs`, 2 × 1,500 states; 1,970 tucks with T = a layer the plain fold would land on):

| Measure | Result |
|---|---|
| plain fold valid | 1,970 / 1,970 |
| Beloch rule valid | 722 |
| core transitive rule valid | 759 (same order as Beloch's in 688 of the 699 cases where both are valid) |
| "immediately under T" feasible (H1 not in conflict) | 793 (40%) |
| H1 unique | 786 (99.1%), 720 of them equal the rule state |
| H1 unique while the rule is invalid | 66; diagnosed: all differing pairs were vacuous decisions (`replay-tuck.mjs`) |
| loose "under T" feasible (H0) | 1,859; only 1,370 unique |
| the two closures moved different sets | 81 |

## Mapping to engine primitives

1. **`reflect_blocks(ℓ, H, blocks[{faces, placement}], crossBlock)`** carries the CP and geometry stage of every op here. It reuses core's split, toggle and BFS unchanged. Simple fold, reverse fold (2 blocks, or 2 per flap) and tuck are single calls.
2. **A compound op is a list of `reflect_blocks` steps verified only at the end.** A crimp is 2 steps; intermediate validity fails in about 5% of cases. An equivalent formulation is one piecewise-isometric move with per-zone isometries (identity, ρ1, ρ1ρ2).
3. **Order resolution:**
   - Each step contributes fixed pairs: stationary pairs, same-block (reversed), cross-block (kept), block against its own body or target.
   - FF seeded completion fills the rest.
   - "CP diff + seeded completion" alone is insufficient for tucks (4c) and for 4-layer reverses (SBL = 2–3 in 2b).
4. **A fan primitive was not needed** for this family. Beloch's "reverse fold = fan at ℓ∩s" is untested here.

## Verification table

| Set | States checked | FF ok | Independent checker ok | Disagree |
|---|---|---|---|---|
| Concrete cases (`results/cases.json`) | 55 | 39 (all 16 rejections are deliberate negatives or rule-failure demonstrations) | same | 0 |
| Reverse campaign (3 rules × 5,740) | 17,220 | 8,819 | – | 1 (sliver, repro `rev-ffindep-1-641-0`) |
| Crimp campaign (4 combinations × 2,682) | 10,728 | 3,537 | – | 0 |
| Tuck campaign (Beloch rule) | 1,970 | 722 | – | 0 |
| FOLD-triple check (`dbg-foldtriples.mjs`) | 522 valid reverse states | same-block unchanged 1,076/1,076; cross-block flipped 1,528/1,528 | | |

The FF verifier is the core's: validated arrangement, seeded propagation, per-cell total order, letters. Every random-campaign verdict also used the independent checker. The campaigns are deterministic: rerunning seeds 1–3 gave identical JSON apart from timing and repro lists.

## Ambiguities and user inputs

- **Kind.** Usually forced by geometry: one kind valid in 85.5% of non-perpendicular ops; both valid when ℓ is perpendicular to the spine, or when the body's spine does not reach the swing region. Auto-select when exactly one is feasible; otherwise offer both.
- **Opening.** 25% of random ops have several. For stacked flaps the natural default is one opening per flap, which Beloch's definition lacks.
- **Remaining completions** after the kind is fixed: about 0.6% for reverse folds and about 1% for crimps. A UI must offer these as choices.
- **Tuck target T.** Only 40% of plain-fold landing layers are feasible targets. Precompute the feasible ones. "Under T" needs the strict H1 meaning; the loose H0 meaning is not unique in 26% of feasible cases.
- **Crimp:** the two lines, the kind, and the same opening for both steps. In 61 ops no matching opening existed for the second step; the crimp is undefined there.

## Failure modes, each with evidence

1. **Wrong kind for the swing:** taco-tortilla (1a outside, 1b inside, 1d).
2. **Per-pair placement cycles** with a multi-face T: 84 cases (repro `rev-otherfail-1-132-1`, rendered `x-cycle-*`).
3. **Vacuous placements decided literally:** 66 tucks (`x-tuck-vacuous-*`), plus 10 inside and 36 outside reverse folds.
4. **Literal outside rule wraps unrelated layers** (2c), while the body-relative rule fails elsewhere: 80 in0-outB0-outL1 combinations (these keys record which of inside, outside-body and outside-literal were valid).
5. **Cross-block order undefined** when the bodies do not overlap. Fixed by `keep`.
6. **Single-opening semantics on multi-flap tips** (2b).
7. **Crimp intermediate invalid:** 149 cases.
8. **Numerics.** A reflected vertex lands 1.6e-4 inside another layer's face (area 3e-8). FF's arrangement missed the overlap with no eps retry. μ guards vertex–ℓ distances only, not image–image near-coincidences.
9. **Opening enumeration is O(2^|tip|).** The spike caps it at 18 faces.
10. **Core bug.** `core/README.md` and the core report import `indepCheck` from `index.mjs`, but `core/index.mjs` does not export it. The import throws a SyntaxError; I imported from `core/indep.mjs` instead.

## Recommendations

1. Build a single kernel primitive, `reflect_blocks`, that takes an explicit moving set, has a `keep` policy for cross-block pairs, and has an order-completion hook. Build reverse, crimp and tuck as thin front ends:
   - **reverse:** tip → per-flap openings → kind → blocks against their own bodies;
   - **crimp:** two steps, verified once;
   - **tuck:** ADR 0052 closure, immediately under or over T.
2. Do not use a per-pair rule for layers outside a block's own body or target. Use H0/H1 seeds plus FF completion: unique in about 99% of feasible cases, at about 10 ms for 33–64 faces. Alternatively, test a per-cell "insert right below T" rule.
3. Store the order. Derive the letters. Update FOLD triples by flipping cross-block pairs only.
4. Extend μ to image–image near-coincidences after the move. Make completion local to the cells the moved faces cover.

**Cost** (`perf.mjs`, mean times):

| Faces | Reverse op | FF arrangement | FF completion |
|---|---|---|---|
| ≤16 | 0.18 ms | 1.2 ms | 0.2 ms |
| 33–64 | 2.9 ms | 11 ms | 10 ms |
| 65–128 | 4.0 ms | 24 ms | 93 ms |
| 129–256 (n=7) | 15.6 ms | 78 ms | 518 ms |

## Open questions and what this evidence does not cover

- Whether a deterministic per-cell insertion rule matches FF's unique completion. Not tested.
- A closed-form condition for "both kinds valid". The perpendicular / short-body-spine explanation is a hypothesis from the renders.
- The random states have at most 4 folds and 60 faces. The only real sequence run is the preliminary base: no crane neck or head reverse, no bird's-leg crimp.
- Exact arithmetic, the Rust FF port, and the equivalence with fans are all untested.
- The 2- and 3-state completions after the kind is fixed (about 1%): are they meaningful folder choices, or degenerate layer swaps?

Run everything from `b/`:
- `node cases.mjs && node sheet.mjs`
- `node campaign-reverse.mjs --n 1500 --seed {1,2,3} --maxFaces 60`
- `node campaign-crimp.mjs --n 1500 --seed {1,2} --maxFaces 60`
- `node campaign-tuck.mjs --n 1500 --seed {1,2} --maxFaces 60`
- `node summarize.mjs`
- Replay a repro with `replay-rev.mjs`, `replay-crimp.mjs` or `replay-tuck.mjs`, passing the file in `repros/`.

Files:
- Contact sheet: `renders/index.html`
- Aggregates: `results/summary.json`
- Per-case details: `results/cases.json`
