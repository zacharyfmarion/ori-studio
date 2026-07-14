# Phase 8 — Execution plan: get WebGL to parity, then delete SVG

**Guiding principle:** confirm parity, cover it with tests, and decompose the code —
all *before* the irreversible deletion, so the risky step is the best-protected one. The
SVG surface stays intact through steps 1–3; step 4 is a surgical removal.

The **deletion inventory + cleanup catalog** (what exactly gets removed, the WebGL→SVG
umbilical, the architecture-cleanup list) lives in
[webgl-phase8-delete-svg.md](webgl-phase8-delete-svg.md). This doc is the **ordered
execution plan**.

> **Selection transform NOT ported (Zach, 2026-07-14).** Resize / rotate / flip of a
> selection are **SVG-only** and are **not** being ported to WebGL. Move-drag already
> works on WebGL and that is sufficient. So when the SVG surface is deleted (Step 4),
> resize / rotate / flip go away — an **accepted loss**, not a gap to close. (This
> removes the former "Step 1" entirely.)

Each step is its own set of commits and ends at a **Zach gate** (hands-on verification;
Claude makes it testable + fixes what Zach surfaces — no self-certification).

---

## Step 1 — Close the remaining WebGL-vs-SVG parity gaps

Get WebGL to "complete replacement" so the delete is safe.

- **Systematic audit:** walk every feature the SVG surface still provides and confirm the
  WebGL surface matches (or is a consciously-accepted difference).
- **Accepted losses on deletion** (confirm each is fine, do not port):
  - **Selection resize / rotate / flip** — SVG-only; move-drag stays on WebGL.
  - **Snap-target HUD** — the SVG target/label feedback; a plain snap ring already draws
    on WebGL.
  - **Draggable imported forms** — punted; imported forms render but stay static.
- **Resolve the non-editable / generated-CP path (open question O2):** verify whether
  `editableCp === null` (the SVG `GeneratedCreasePattern` read-only view) is still
  reachable in the CP workspace. If reachable → cover it on WebGL or scope it out of the
  edit surface; if legacy → confirm it can go.
- **Deferred tool queue** (Text, Reflect Over Line, Square Bisector mode C, Circle
  tangent + rest of Circle-apply) — already hidden/deferred; confirm none block deletion.
- **Gate:** Zach signs off "WebGL is a complete replacement (modulo the accepted losses)"
  against a written checklist. This is the hard gate before anything is deleted.

## Step 2 — Port / rebuild the tests onto WebGL + pure modules

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

## Step 3 — Decompose the panel into focused modules

Extract the **renderer-agnostic keep code** out of the 7,960-line `CreasePatternPanel`,
which *isolates* the SVG surface as a discrete remaining block (so Step 4 is a clean
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

## Step 4 — Delete the SVG surface + finalize (the surgical removal)

Now that WebGL is proven, tested, and the keep-code is modular, remove SVG.

1. **Sever the umbilical** — seed the WebGL camera from `contentBounds` only, delete
   `cp-workspace/svgViewBridge.ts` + `sampleView`, drop the `svgRef` / `svgToModel` props.
2. **Make WebGL unconditional** — delete `store/cpRendererStore.ts` + every
   `cpRendererMode` branch (`data-webgl-hidden`, toolbar/shortcut forks, conditional
   mount).
3. **Delete the SVG render components** (§A1 of the scope doc — including the SVG
   `SelectionTransformBox` / `SelectionBoxPreview` and its resize/rotate/flip handlers),
   **RZPP from the edit path** (§A2 — dependency stays for `DesignPanel`), and the **SVG
   interaction path** (§A3).
4. **Remove vertex selection end-to-end** — store (`types.ts`, `creasePatternSlice.ts`,
   `projectSlice.ts`), the selection type, and its tests.
5. **Collapse duplicate snap/first-pick** (SVG copies die; WebGL is the single source) and
   **coordinate cleanup** (keep `modelToSvg` as a pure helper; delete `svgToModel` +
   viewBox/decoration-scale machinery).
6. **Gate:** full manual pass; parity holds; review the net LOC reduction + final module
   structure — confirm the "maintainability win," not just a passing app.

---

## Cross-cutting notes

- **Reference stays live through steps 1–3.** Nothing in the SVG surface is deleted until
  Step 4, so the audit always has a working oracle to diff against + fall back to (the flag
  still lets you A/B until Step 4.2).
- **Open decisions (from the scope doc)** are resolved inside the steps: O1 (selection
  transform) → not ported, accepted loss; O2 (generated-CP path) → Step 1; O3 (test
  appetite) → Step 2.
- **Sequencing rationale:** parity + tests + modular keep-code all land *before* the
  irreversible deletion, so the risky step is the best-protected one.
