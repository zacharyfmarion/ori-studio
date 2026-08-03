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
- [x] Extend-until-hit accepting borders, and aux behind a flag
- [x] One pass over segments for all candidate rays, not one pass each
- [x] Each candidate carries the segment that stopped it
- [x] A candidate that hits nothing is dropped
- [x] All candidates dropped → its own `NoCompletion` code and message
- [x] Commit takes the destination from the chosen candidate
- [x] Ported commit function and its oracle coverage untouched
- [x] `foldableLineStopsOnAux` on the payload, honoured by the extension
- [x] Test: a candidate running to the paper edge terminates there
- [x] Test: aux line ignored by default, honoured when the flag is set
- [x] Test: the two-click flow commits the crease the three-click flow did

### Web
- [x] Two steps; the destination step and its `crease-required` snap are gone
- [x] Candidates dashed, in their committed colour
- [ ] Landing dot at each candidate's far end — **dropped**, see below
- [x] Nearest candidate rendered solid, from the same projection the pick uses
- [ ] A click far from every candidate starts a new vertex — **not built**, see
      below
- [x] Lone candidate still needs its click (the existing guard covers it)
- [x] `foldableLineStopsOnAux` setting group, persisted, defaulting off
- [x] Step prompts and instructions rewritten
- [x] `i18n:check` green

## Two corrections the plan got wrong

**The border was never skipped.** `is_folding_line` covers `Black0`, so the
existing primitive already stopped at the paper's edge and the "first piece of
work" did not exist.

**Auxiliary means `Cyan3` in `line_segments`, not the `aux_line_segments`
collection.** The model has both; the editor writes auxiliary lines to the main
list with that colour, which is why every check in the crate filters `Cyan3` by
name. The first implementation scanned the other collection, so the setting was
wired all the way to the panel and silently changed nothing.

## What was dropped, and why

- **The landing dot.** Once a candidate is drawn to what stops it, the line
  visibly ends there — the dot restates what the geometry already says. Left out
  rather than added for symmetry with the plan.
- **A click far from every candidate re-anchoring to a new vertex.** The step
  currently ignores such a click, which is Oriedita's behaviour and not wrong;
  making it re-anchor is a change to the shared sequence engine rather than to
  this tool, so it wants its own change.

## Not verified in the browser

Arming on hover. The automated pane sends no `pointermove`, so the solid-on-
approach state cannot be exercised there — it is covered by unit tests over the
stroke grouping instead. Everything else was checked in the running app: the
candidates run to the border as dashed proposals, a click commits the crease the
dashed line showed, and the aux setting changes where the candidates stop.

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
