# Phase 8 — Execution plan: port everything to WebGL, then delete SVG

**Guiding principle:** port *while the SVG reference still exists*, and delete *last* —
only once WebGL is at full parity, the behavior is covered by tests, and the code is
already decomposed into clean modules. The SVG surface stays intact and untouched
through steps 1–4; step 5 is a surgical removal.

The **deletion inventory + cleanup catalog** (what exactly gets removed, the WebGL→SVG
umbilical, the architecture-cleanup list) lives in
[webgl-phase8-delete-svg.md](webgl-phase8-delete-svg.md). This doc is the **ordered
execution plan**.

Each step is its own set of commits and ends at a **Zach gate** (hands-on verification;
Claude makes it testable + fixes what Zach surfaces — no self-certification).

---

## Step 1 — Resize + flip selection transform in WebGL (Phase 9, brought forward)

Do this first, while the SVG `SelectionTransformBox` is available as the reference to
port from. Move-drag already works on WebGL; this adds the resize handles + flip menu.

> **Rotate dropped (Zach, 2026-07-14).** Rotation is out of scope — **no free-drag
> rotate handles and no rotate-90° menu buttons.** The transform box has resize handles
> + Flip Horizontal / Flip Vertical only. This drops `normalizeSelectionTransformAngle`,
> the rotate hit-rings, the angle preview, and the `rotate` branch of the transform
> commit from the port.

- **Overlay:** a DOM overlay with constant-size resize handles + a flip menu (H/V),
  positioned by projecting the model-space selection frame (`cpLineSelectionFrame`,
  `angleDegrees` fixed at 0) through the **owned WebGL camera** (not the SVG transform).
- **Live preview:** generalize the existing move preview (`{ids, delta}`) to per-point
  transforms so resize previews on the GPU, reusing the stroke/point re-upload path
  (`resizeTransformForPoint`).
- **Commit:** `transformOristudioCpSelection` — `scale` (resize) and
  `flip-horizontal` / `flip-vertical`. No `rotate`.
- **Reference (do not delete yet):** SVG `SelectionTransformBox` / `SelectionBoxPreview`
  and `handleSelectionResize/Transform PointerDown` in `CreasePatternPanel`.
- **Gate:** resize + flip at parity with the SVG surface; handle hit-areas + constant
  on-screen size correct through zoom.

## Step 2 — Close the remaining WebGL-vs-SVG parity gaps

Get WebGL to "complete replacement" so the delete is safe.

- **Systematic audit:** walk every feature the SVG surface still provides and confirm the
  WebGL surface matches (or is a consciously-accepted difference).
- **Resolve the non-editable / generated-CP path (open question O2):** verify whether
  `editableCp === null` (the SVG `GeneratedCreasePattern` read-only view) is still
  reachable in the CP workspace. If reachable → cover it on WebGL or scope it out of the
  edit surface; if legacy → confirm it can go.
- **Decide the acceptable losses** — features that would disappear on deletion and are
  currently deferred: the **snap-target HUD** (the SVG target/label feedback; a plain
  snap ring already draws on WebGL) and **draggable imported forms** (punted). Confirm
  these stay deferred, or pull them forward.
- **Deferred tool queue** (Text, Reflect Over Line, Square Bisector mode C, Circle
  tangent + rest of Circle-apply) — already hidden/deferred; confirm none block deletion.
- **Gate:** Zach signs off "WebGL is a complete replacement" against a written parity
  checklist. This is the hard gate before anything is deleted.

## Step 3 — Port / rebuild the tests onto WebGL + pure modules

Establish the safety net *before* the refactor and deletion.

- Move SVG-DOM assertions (the `data-cp-line-id` / SVG-node queries in
  `CreasePatternPanel.test.tsx`) to:
  - **pure-module unit tests** — geometry builders, tool engines, camera, picking,
    adapters (these already exist and are the right home), and
  - a **lean set of WebGL-surface smoke tests** for the integration path.
- Anything that only made sense as an SVG-DOM assertion and is now covered by a pure test
  gets dropped, not reproduced.
- **Gate:** a green suite that exercises the WebGL path and the pure modules, with no
  dependency on the SVG DOM.

## Step 4 — Decompose the panel into focused modules

Extract the **renderer-agnostic keep code** out of the 7,960-line `CreasePatternPanel`,
which *isolates* the SVG surface as a discrete remaining block (so step 5 is a clean
removal, not a decompose-then-delete of the same lines).

- `diagnostics/geometry.ts` — `buildCpDiagnostic{Markers,Strokes,Wedges,MarkerHits}` +
  tone/shape/LBL helpers.
- `tools/predicates.ts` — the `is*Operation` family + `shouldPreferPointSnapForStep`.
- `toolPanel/` — `CpContextToolPanel` + all `*ToolOption` components + `CpLineTypeToolbar`
  + `FoldedFigureMenuButton`.
- `commands.ts` — `buildCpCommandPayload`, `handleWebglToolCommit/PreviewInput`, measure
  slots.
- Remaining `CreasePatternPanel` = state/orchestration + WebGL wiring + the (now isolated)
  SVG block.
- **Gate:** tests still green; module boundaries reviewed.

## Step 5 — Delete the SVG surface + finalize (the surgical removal)

Now that WebGL is proven, tested, and the keep-code is modular, remove SVG.

1. **Sever the umbilical** — seed the WebGL camera from `contentBounds` only, delete
   `cp-workspace/svgViewBridge.ts` + `sampleView`, drop the `svgRef` / `svgToModel` props.
2. **Make WebGL unconditional** — delete `store/cpRendererStore.ts` + every
   `cpRendererMode` branch (`data-webgl-hidden`, toolbar/shortcut forks, conditional
   mount).
3. **Delete the SVG render components** (§A1 of the scope doc), **RZPP from the edit path**
   (§A2 — dependency stays for `DesignPanel`), and the **SVG interaction path** (§A3).
4. **Remove vertex selection end-to-end** — store (`types.ts`, `creasePatternSlice.ts`,
   `projectSlice.ts`), the selection type, and its tests.
5. **Collapse duplicate snap/first-pick** (SVG copies die; WebGL is the single source) and
   **coordinate cleanup** (keep `modelToSvg` as a pure helper; delete `svgToModel` +
   viewBox/decoration-scale machinery).
6. **Gate:** full manual pass; parity holds; review the net LOC reduction + final module
   structure — confirm the "maintainability win," not just a passing app.

---

## Cross-cutting notes

- **Reference stays live through steps 1–4.** Nothing in the SVG surface is deleted until
  step 5, so the port always has a working oracle to diff against + fall back to (the flag
  still lets you A/B until step 5.2).
- **Open decisions (from the scope doc)** are resolved inside the steps: O1 (resize/rotate)
  → Step 1; O2 (generated-CP path) → Step 2; O3 (test appetite) → Step 3.
- **Sequencing rationale:** parity + tests + modular keep-code all land *before* the
  irreversible deletion, so the risky step is the best-protected one.
