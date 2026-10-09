# Diagram X-ray: peel the window, not the point

Follow-up to Revision 3's X-ray (`implementation-plans/diagram-revision-3.md`,
"5. X-ray", 18e and 18f; PR #447 on `claude/diagram-xray`). R3-34 A replaces
R3-13 A. The work is phase **18g** and lands on `claude/diagram-xray`.

**Status: planned 2026-10-09. Zach the same day: "can you please implement
there instead", so R3-34, R3-35 and R3-36 are built as recommended (A each).
18g built and gated 2026-10-09 (As built, below). Zach's four diagrams were
not rerun here (18g.5): Zach is checking by hand.**

## Goal

Zach's report on #447 (2026-10-09):

> X-ray doesn't seem to be working right. Like if i go over an area like this
> only one half is x-rayed and the other still shows the top face. And then if
> i increase depth, the face that was already x-rayed goes deeper. I guess i
> expect it to kind of work like each depth peels back the layer highest up in
> the stack or something. So that if there are two separate top flaps that are
> connected 1 layer deeper, first the right one goes, then the left, and then
> the connected flap beneath goes, etc.

So Depth should peel the window. Each step takes away one face that lies on top
inside the window. The window's whole top layer goes before anything under it,
and this continues until only the bottom layer is left.

### Why it happens (reproduced)

R3-13 A counts layers at a single point: the anchor, which is the window's
centre unless a Point is picked. It takes away the top N faces of that point's
stack and every face over them (`xrayRemoval`, `xray/xrayScene.ts:323`, through
`facesOverWithin`). A flap beside the anchor's flap is not over it, so it stays
at every depth. The Depth stepper stops at the anchor's stack, so that flap can
never be taken away.

This was reproduced on #447's head (1633322) with a throwaway test. The fixture
has two flaps edge to edge, each two layers (L1 over L2, R1 over R2), both on
one base. The window lies across their shared edge, with its centre on R1:

| Depth | Taken away today | On top in the window's left half |
| --- | --- | --- |
| 1 | R1 | L1: only half the window is x-rayed |
| 2 | R1, R2 | L1: the right half went deeper |
| 3 and up | R1, R2 (the stepper stops at 2) | L1, which can never be taken away |

On the existing `knotStep` fixture, with the window across the edge between
`cover` and `beside`, depth 1 takes `cover` alone.

A prototype of the rule below (the same throwaway test) gave:

- on the same fixture: R1 → L1 → R2 → L2, with the base kept;
- with the Point moved onto the left flap: L1 → R1 → L2 → R2;
- on `knotStep`: cover → beside → buried, with back kept.

That matches the order Zach described.

## Approach

### The rule (R3-34 A, recommended)

Everything is read inside the window only.

1. **In the window.** A face is in the window when its drawn ring shares a
   part with the window's disc wider than "over"'s tolerance
   (`OVER_MIN_WIDTH`, `faceOverlap.ts`).
2. **Over, inside the window.** Face A is over face B when two things hold.
   First, they are stacked: their unspread rings overlap wider than the
   tolerance, and A's level is less than B's (18.0's reading). Second, the
   stacking happens inside the window: the part their drawn rings share meets
   the disc by more than the tolerance. So two flaps that cross outside the
   window do not hold each other up inside it.
3. **Rounds.** Round 1 is every face in the window that has nothing over it in
   the window and something under it in the window. Round 2 is the same rule
   applied once round 1 is gone, and so on. A face with nothing under it in the
   window is the bottom there, and is never taken away.
4. **Steps.** Each face of a round is one step. Within a round, the face
   nearest the Point goes first: the distance is from the Point to the face's
   part in the window, and 0 when the Point is on the face. Ties go to the
   lower level, then the lower face number. All of round 1 comes before any of
   round 2. That ordering is what stops one side going deeper while the other
   side still shows its top face.
5. **Depth N** takes away the first N steps. A depth past the last step takes
   them all, which draws the window at its deepest, as today. The faces taken
   away are exactly those steps' faces. No "and every face over them" closure
   is needed: by construction, everything over a taken face inside the window
   was taken before it.

What follows from the rule:

- **Whole faces, not a per-point drill.** R3-13 B stays rejected. A face tucked
  under another inside the window waits for that face, even where it shows on
  top elsewhere in the window. This is how paper behaves: a layer cannot be
  lifted while something still lies on it.
- **No knots.** "Over" is read by level, which is a strict order, so the peel
  cannot cycle. The one exception is a woven pair: its two faces have the same
  level and no "over" between them, so both can land in one round. This is the
  same caveat that 15e and R3-13 already carry.
- **B is inside A.** Every round boundary falls between two steps. So every
  view that option B would give is some depth under A.

### Spread

Which faces are stacked is still read on the unspread rings. This is 18.0's
finding: a spread pushes flaps into one another. The window clips the drawn
picture, so "in the window" and "inside the window" are read on the drawn
rings, and only for pairs already stacked unspread. With no spread, drawn and
unspread rings are the same.

### Where it lives

All of the change is in `xray/xrayScene.ts`. Every surface already gets its
removal through `xrayInside` → `xrayRemoval`: the canvas, cards, pages, print,
the PDF, the single SVG, ZIP step files, enlarged steps and snapping
(`xraySnap.ts`). So no painter changes, and 18f's parity test keeps the
surfaces in step.

- **`readXRayFaces`**, once per picture (memoized as today):
  - each face's drawn cover, in picture units;
  - the stacked pairs as (upper, lower): a box test first, then
    `overlapsWider` on the unspread rings;
  - each stacked pair's shared part on the drawn rings, as convex pieces.

  This is O(n²) once per picture, not per frame.
- **New `xrayPeel(xray, window, point)`.** It returns the steps, each a list of
  faces (R3-36 can put a sliver with its neighbour). Per window it does three
  things:
  - finds the faces in the window: a box test, then a clip to a 64-gon disc;
  - clips the precomputed shared parts of the pairs among those faces to the
    disc;
  - builds the rounds.

  It is memoized on the faces, the centre, the radius and the Point, so
  changing Depth alone does not redo it.
- **`xrayRemoval(xray, window, point, depth)`** takes the first `depth` steps.
  `XRayRemoval.stack` (the anchor's faces) becomes `steps` (how many steps the
  window has), and `deep` (how many are taken) stays. `xrayWindowOn`
  (`xrayPaint.ts:117`) returns them as before.
- **The Point**, as drawn: `xrayAnchorDrawn` gives a picked Point, and the
  window's centre is used otherwise. `xrayAnchorPoint` existed only to put a
  stack on the unspread picture, so it goes, along with `xrayStackAt`.
- **`facesOverWithin`** (`annotate/behindFlaps.ts:157`) is used only by X-ray.
  It goes, with its test in `faceOverlap.test.ts`. 15e's own `facesOver` does
  not change.
- **`xrayLayers.ts`**:
  - `xrayLayersUnder` becomes `xrayStepsIn`, the number of steps in the window;
  - `xrayDepthMax(steps)` is `max(1, steps)`, where it was `layers − 1`;
  - `xrayCentreOnPaper`, the rule for laying a window, is kept.
- **`useXRayControls.ts`**:
  - the stepper's maximum is the step count, or the depth asked for where that
    is more (kept as today);
  - `fewer` is shown when the depth is past the steps;
  - `offPaper` becomes "nothing to take away in this window" when there are no
    steps.

### Performance

18.0 measured a drag at about 0.07 ms a frame on the densest step. Per frame,
the peel adds the window's faces clipped to the disc, the pairs' precomputed
shared parts clipped to the disc, and the rounds. The budget is under 1 ms a
frame on the densest step of Zach's four diagrams, measured by rerunning
18.0's harness. If the peel goes over budget, memoize it on the window rounded
to a drawing pixel.

### Edge cases

This is the list Zach asked for: each case, and what the rule does with it.

| Case | What happens |
| --- | --- |
| Two top flaps side by side over one face | One flap per step, the Point's first, then the other, then the face under both. |
| A face on top in one part of the window but tucked under another face elsewhere in the window | It waits until that face is taken away (whole faces). |
| Two faces stacked only outside the window | They do not hold each other up inside it. |
| The bottom layer | It is never taken away. A depth past the steps draws at the deepest, with the "Only N layers here" notice. |
| A face over something in one part of the window and over nothing in another | It is taken away, because it covers something, and the page's white shows where it lay alone. This is #447's open item about white where a window takes every layer away; the change leaves that item as it is. |
| Slivers: a face whose part in the window is a thin strip at the rim | R3-36. Without it, a step can change nothing anyone can see. |
| A spread | Stacking is read unspread; the window clips the drawn picture (Spread, above). |
| Woven patches | A woven pair has the same level and no order between its faces, so both may go in one round. This is the same caveat 15e has. |
| Moving or resizing the window | Faces come into and leave the window, so the same Depth can take away different faces after a drag. The canvas shows this live. |
| Carry, Refresh, refold | The depth is kept, and a depth past the new steps draws at the deepest (unchanged). |
| A dense window | It has many steps, and the stepper goes up to the count. The analytics buckets (`1`, `2`, `3+`) are unchanged. |
| A Point picked off every face in the window | "Nearest the Point" still orders the faces. A Point off every face of the step falls back to the centre, as today. |
| A face the kernel could not name | It has no ring and is skipped, as today. |
| An enlarged step | Its own faces are used, with the window in its units, through `xrayInside` as today. |
| X-rays already in Zach's diagrams | Depth now counts steps, so what they show changes. The file format does not change, and the Diagram is unreleased. 18g.5 lists them so their depths can be set again. |
| A window that takes nothing away | It is still the picture itself. 18.0's depth-0 parity check is rerun; the golden is regenerated only for depths of 1 and up. |

### Decisions

**R3-34. What does one step of Depth take away? DECIDED: A.** Zach,
2026-10-09, asked to implement the plan as recommended. It reverses R3-13 A.

- A. One face, round by round, the face nearest the Point first (The rule,
  above). This is what Zach described: "first the right one goes, then the
  left, and then the connected flap beneath goes".
- B. One whole round: the window's top layer goes everywhere at once. Fewer
  steps, and no ties to break, but two flaps side by side can never be taken
  away one at a time.
- C. Keep R3-13 A: the stack at one point. The report rules this out.
- **Recommended: A.** It is what Zach asked for, every view B gives is a depth
  under A, and the stepper shows each step live. If A's step counts feel too
  fine on Zach's diagrams (18g.5 measures them), B is the fallback, and it
  needs only step 4 of the rule changed.

**R3-35. The Point under the new rule. DECIDED: A**, built as recommended
until Zach says otherwise.

- A. Keep the Point. It decides which face of a round goes first, which is how
  to x-ray the left flap before the right without moving the window. Its hints
  stop saying "where the layers are counted" and say where peeling starts.
- B. Drop the Point from x-rays, and break ties by level and size alone. The
  file still reads `anchor` and ignores it.
- **Recommended: A.**

**R3-36. Slivers. DECIDED: A**, built as recommended until Zach says
otherwise.

- A. A face whose part in the window is a sliver does not get a step of its
  own: it goes with the next step of its round, or the previous step when it is
  the round's last. A sliver is a part whose mean width (`sharedPart`'s
  `width`) is below a threshold. The threshold starts at 2% of the window's
  radius and is set from 18g.5's measurements.
- B. Every face is a step.
- **Recommended: A.** Under B, a step can change nothing anyone can see.

### Wording (i18n, nine catalogs)

- The Point's hints (`xRayAnchor*`: auto, picked, pick, picking, reset, tap)
  say where peeling starts, not "where the layers are counted".
- `xRayOffPaper` and `xRayNoPaper` stop saying "under its middle". (As
  built: `xRayOffPaper` became `xRayNothing`, "Nothing to take away in this
  window".)
- `xRayFewer_*` reads as the most that can be taken away in this window.
- `xRayHelp` and `xRayHelpTouch` ("how many layers to take away") still read
  right.

## Affected Areas

- `apps/web/src/diagram/xray/xrayScene.ts`: the peel, removal and per-picture
  pairs.
- `apps/web/src/diagram/xray/xrayLayers.ts`: the step count and the depth
  maximum.
- `apps/web/src/diagram/xray/useXRayControls.ts`: the stepper and the notices.
- `apps/web/src/diagram/xray/xrayPaint.ts`: the window passes the Point, and
  the `deep`/`steps` return.
- `apps/web/src/diagram/xray/xraySnap.ts`: passes the Point; no change to its
  own logic.
- `apps/web/src/diagram/annotate/behindFlaps.ts`: `facesOverWithin` is
  removed.
- `apps/web/src/diagram/annotate/faceOverlap.ts`: a disc-clip helper beside
  `sharedPart`.
- `apps/web/src/diagram/xray/xray.fixtures.ts`: `flapsStep`, from the repro.
- Tests: `xrayScene.test.ts`, `xraySurfaces.test.ts`, `xrayGolden.test.ts` with
  `__fixtures__/xrayGolden.json`, `faceOverlap.test.ts`, and
  `components/panels/DiagramLayersPanel.test.tsx`.
- `apps/web/public/locales/*/panels.json` and `.hashes.json`.
- `implementation-plans/diagram-revision-3.md`: R3-13 is marked superseded by
  R3-34, and 18g's "as built" is recorded.

## Checklist

- [x] Zach answers R3-34: A (2026-10-09, "please implement").
- [x] 18g.1 Tests, in `xrayScene.test.ts`, with `flapsStep` and `handFold`:
  - [x] depths 1 to 4 take away R1; then L1; then R2; then L2; the base never;
  - [x] the Point on the left flap takes L1 first;
  - [x] `knotStep` across the edge peels cover, beside, buried, and keeps back;
  - [x] faces stacked only outside the window peel on their own;
  - [x] a tucked face waits for the face over it;
  - [x] a sliver goes with its neighbour's step;
  - [x] spread or not, the same pairs are stacked (As built: windows on the two
    pictures are not the same paper, so their steps are not compared);
  - [x] a depth past the steps draws at the deepest;
  - [x] on the crane, spread and not: deeper takes all the shallower did, never
    a face with one left over it in the window, never one with nothing under
    it.
- [x] 18g.2 The peel in `xrayScene.ts`: per-picture pairs, `xrayPeel` and the
  new `xrayRemoval`; `xrayAnchorPoint`, `xrayStackAt` and `facesOverWithin`
  removed.
- [x] 18g.3 Layers: the step count, the stepper's maximum and the notices;
  `DiagramLayersPanel.test.tsx` updated.
- [x] 18g.4 Wording: the Point's hints and the notices in all nine catalogs;
  `i18n:check`.
- [ ] 18g.5 Zach's four diagrams, rerunning 18.0's harness. Not run: the
  diagrams are gitignored and not in the container this was built in. Zach is
  checking by hand. Still open:
  - [ ] depth 0 is still the picture (138 of 138);
  - [ ] steps per window, and how many are slivers, to set R3-36's threshold;
  - [ ] the drag cost on the densest step, under 1 ms (the crane's is, below);
  - [ ] the x-rays already in the files, before and after;
  - [ ] a render of the reported spot.
- [x] 18g.6 The golden re-recorded after looking at each changed window before
  and after (As built). The gate: lint, typecheck, `i18n:check` and the web
  vitest suite. No browser run here; Zach is checking in the app.
- [x] Recorded in `diagram-revision-3.md`: R3-13 superseded by R3-34.

## As built (18g, 2026-10-09)

- **The rule is as planned**, in `xray/xrayScene.ts` (`xrayPeel`,
  `xrayRemoval`, `xrayPeelPoint`), with three changes in how it is read:
  - **"Reaches into" instead of a clipped width.** A face is in the window,
    and two stacked faces lie one over the other inside it, when the window
    reaches into the face (or their shared part) by more than "over"'s
    tolerance: its nearest point is that far inside the circle. Clipping every
    pair's shared part to the window cost 2.5 to 3.3 ms a peel on the crane.
    Read this way it costs 0.2 to 0.84 ms (measured in vitest on the crane
    fixture, 44 faces, 546 stacked pairs), and the steps came out the same on
    every window tried. Only the faces in the window are clipped, for the
    sliver width (R3-36) and "nearest the Point".
  - **The stacked pairs are worked out lazily** (`xrayStacked`), once per
    picture, on its first peel: 1.4 to 3 ms on the crane. `readXRayFaces`
    runs whenever a step opens in Annotate, x-ray or not, and with the pairs
    in it, it doubled there. Each face's convex pieces are cut once, so a
    pair's overlap is not triangulated again.
  - **A face as drawn** is its item's largest ring: the stored scene's own,
    spread and all, or its unspread ring for a face the scene dropped.
- **A window centred off the paper peels the paper inside it.** Under R3-13 A
  it took nothing away. The rule for laying one (`xrayCentreOnPaper`) is
  kept. `crane-off-paper` now peels, so 18f's parity test ("a window that
  takes nothing away is the picture itself") became stronger: on a spread
  picture, which draws every face, the faces a window leaves are the
  picture's own, face for face, less exactly those under its white.
- **The golden**: the four hand-built cases did not change. The seven crane
  cases were re-recorded after rendering each window before and after. Most
  are nearly the same. `crane-off-paper` now peels; `crane-edge` takes a
  different first face (the one nearest its centre); and `crane-enlarged`,
  two deep, now shows face 22 across the whole window. That face shows the
  paper's front, white in the Diagram preset, so it reads as a hole: #447's
  open item about a tint for revealed front faces.
- **Not done here:** 18g.5, on Zach's own diagrams, and a run in the browser.
