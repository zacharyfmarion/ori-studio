# Foldable Line: pick the crease you can see

## Goal

Cut the tool from three clicks to two, and make what you click look like what you
get.

Today: click a vertex, click a stub ray, then click the crease you want it to run
to. The stub is `grid_width` long — an arrow, not the crease — so the third click
is the user telling the software something the software can work out: *which
crease does this ray hit first?*

After: each candidate is drawn as the full crease it would become, all the way to
what stops it. Click the one you want. Done.

## Approach

### The destination step is answered, not deleted

Worth stating precisely, because it keeps the change small and keeps the oracle.

The commit still runs the ported
`make_vertex_flat_foldable_to_destination(model, vertex, candidate, destination,
…)`, and still intersects the chosen ray with a destination crease. The only
difference is **who supplies the destination**: the extension already knows which
segment stopped the ray, so it hands that segment over instead of asking.

So the ported commit path, its geometry, and its oracle coverage are untouched.
What changes is the interaction and how far the preview ray is drawn.

### What stops a ray

| Stops on | |
| --- | --- |
| Folding creases (M/V) | Always |
| **The paper border** | **Always.** Most completions run to the edge |
| Auxiliary lines | Off by default, behind a persisted tool setting |
| Circles | Never |

**The border is the piece that does not exist yet.**
`lengthen_until_intersection_disregard_included` — the primitive that already
answers "what does this ray hit first" — begins with
`if !segment.color.is_folding_line() { continue; }`, so it skips borders and aux
outright. A candidate heading for the paper's edge with no crease in the way finds
nothing today. That is the most common case, so a variant that takes a
colour-acceptance rule is the first piece of work.

### The rejection rule

A candidate that terminates on nothing is dropped. **Not a length cap** — a
number nobody could justify, and a crease running the width of the sheet is
perfectly ordinary. With borders counted, a well-formed pattern always
terminates, so this fires only on an open or malformed boundary, which is exactly
when you want it to.

When every candidate is dropped that way, report it: a new `NoCompletion` code
saying the answers run off the paper, rather than the silence that would look
identical to "no completion exists".

### Cost

The preview already walks every segment twice per pointer move
(`incident_lines_at`, then `vertex_fan_at`). Extension must not turn that into
`O(E × candidates)` — with six candidates on a 52k-segment document that is 300k
intersection tests per mouse move.

So: **one pass, all rays at once.** Walk the segments once, and for each, test it
against every candidate ray, keeping the nearest hit per ray. Same order as what
the preview already pays, and no index to build or maintain.

### The visual language

Once candidates are full-length in the colour they would commit, they read as
real creases. Three things separate them:

- **Dashed**, in the committed colour. Dashed is the conventional "proposed"; the
  colour still says what you would get. The preview channel already has a dashed
  mode.
- **A dot at the landing point**, so where it stops is visible before committing.
- **The nearest candidate goes solid** as the cursor approaches it.

The third is load-bearing, not decoration. With three candidates on screen and a
click-nearest rule, you must be able to see which one is armed before you commit
— otherwise the click is a guess. `snapToNearestSegment` already computes exactly
this projection for the pick; the rendering just has to use the same answer.

### The confirming click costs nothing to keep

Decision: a lone candidate still requires its click, rather than committing off
the vertex click. Oriedita skips the pick when there is one option
(`if (candidates.size() == 1)`), which under a two-step tool would mean geometry
appearing from a single click on a vertex.

This needs **no new code**. `loneCandidateAutoPick` already declines when the
candidate step is the tool's last, and once the destination step is gone it is —
with the reason already written at its call site: *"resolving it would commit the
whole command off a preview arriving, with no click at all."*

### What this drops

Today's third click can pick a *farther* crease, crossing nearer ones. First-hit
removes that. Dropped deliberately, and if it is missed the cheap way back is to
draw the faint continuation to the border and let the click position choose the
crossing — one click still, no modifier. Not built now.

## Affected Areas

**Rust kernel**
- `crates/oristudio-cp/src/operations/construction.rs` — a colour-accepting
  variant of the extend-until-hit primitive; the ported one keeps its behaviour
- `crates/oristudio-cp/src/solve_spatial.rs` — extend every candidate in one pass
  over the segments; carry the segment that stopped each ray; the new
  `NoCompletion` code
- `crates/oristudio-cp/src/lib.rs` — the commit takes its destination from the
  chosen candidate rather than from `points[2]`; the aux flag off the payload
- `crates/oristudio-cp-wasm/` — committed `.wasm` rebuild

**Web**
- `apps/web/src/cp-workspace/tools/inputModelRegistry.ts` — `pointCount: 3 → 2`,
  `snapPerStep: ['point', 'candidate']`
- `apps/web/src/lib/oristudioCpCommands.ts` — two step prompts, not three
- `apps/web/src/lib/oristudioCpToolInstructions.ts` — the instruction steps
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — dashed candidates,
  the landing dot, and the nearest candidate rendered solid
- `apps/web/src/lib/oristudioCpToolSettings.ts` — `foldableLineStopsOnAux`, its
  default, its setting group, its entry in the group→keys map
- `apps/web/src/lib/cpToolOptionPersistence.ts` — one line, the flag's validator
- `apps/web/public/locales/*` — changed prompts and the new setting's label

## Checklist

### Kernel
- [ ] Extend-until-hit accepting borders, and aux behind a flag
- [ ] One pass over segments for all candidate rays, not one pass each
- [ ] Each candidate carries the segment that stopped it
- [ ] A candidate that hits nothing is dropped
- [ ] All candidates dropped → its own `NoCompletion` code and message
- [ ] Commit takes the destination from the chosen candidate
- [ ] Ported commit function and its oracle coverage untouched
- [ ] `foldableLineStopsOnAux` on the payload, honoured by the extension
- [ ] Test: a candidate running to the paper edge terminates there
- [ ] Test: aux line ignored by default, honoured when the flag is set
- [ ] Test: the extended candidate's far end is the intersection the old
      three-click flow would have produced from the same destination

### Web
- [ ] Two steps; the destination step and its `crease-required` snap are gone
- [ ] Candidates dashed, in their committed colour
- [ ] Landing dot at each candidate's far end
- [ ] Nearest candidate rendered solid, from the same projection the pick uses
- [ ] A click far from every candidate starts a new vertex rather than doing
      nothing
- [ ] Lone candidate still needs its click (assert the existing guard covers it)
- [ ] `foldableLineStopsOnAux` setting group, persisted, defaulting off
- [ ] Step prompts and instructions rewritten
- [ ] `i18n:check` green

## Risks

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | Extension turns a per-move preview into `O(E × candidates)` | One pass for all rays; measure on the 52k-segment document before merging |
| R2 | Full-length candidates read as real creases | Dashed + landing dot + solid-on-approach, all three |
| R3 | The flat tool visibly changes for Oriedita users — rays that were stubs now run to their landing point | Deliberate; it is the point of the redesign. The commit geometry is unchanged, so what they get is identical |
| R4 | Landing mid-crease splits it and creates a rigid degree-3 vertex that immediately flags an error | Inherent to CP editing and true today; a faster flow just meets it more often. Not hidden |
| R5 | Losing the farther-crease destination bites someone | The faint-continuation fallback above, added only if it does |

## Non-goals

- Extending past the first hit.
- Hover-to-preview before the vertex is clicked. The tool stays click-driven; the
  candidates appear on the vertex click as they do now.
- Any change to `FoldableLineInput`, the hidden extend variant.
