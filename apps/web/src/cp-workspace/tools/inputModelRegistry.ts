/**
 * The single source of truth for which *input model* each CP construction tool
 * uses. Keyed explicitly by `operationId` — never inferred from step-prompt text.
 * The SVG surface (the reference implementation) picks a tool's model from
 * per-operation predicates (`isLengthenCreaseOperation`, …), not from the wording
 * of its prompts; conflating the two caused the Phase-5 bugs (a "Pick base crease"
 * point step and a "Select target line" entity pick read identically as text but
 * are different models). This table encodes those predicate decisions once, as
 * static data, so the WebGL surface routes by `model` with zero runtime string
 * matching. Every entry is validated against its SVG branch in
 * implementation-plans/webgl-cp-tool-input-spec.md (§4 + §8 checklist).
 *
 * `snapPerStep` records, per point step, whether that step snaps to a free point
 * (grid/vertex — `nearestOrieditaDrawPointTarget`) or onto surrounding geometry
 * incl. creases (`nearestCpSnapTarget`). These values reproduce the SVG's actual
 * `shouldPreferPointSnapForStep` decision (its `false` → 'crease', `true` →
 * 'point'), so they are validated by the shipping SVG rather than re-guessed — and
 * they intentionally differ from the interim `cpToolStepKind` heuristic, whose
 * broader keyword list mis-snapped a few tools (e.g. PolygonSetNoCorners).
 *
 * Coverage + per-model shape are guarded by inputModelRegistry.test.ts, which fails
 * if a UI command is missing an entry or its counts drift from `toolSteps`.
 */
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';

/** The interaction model a tool's pointer input follows. See §3 of the spec. */
export type CpInputModel =
  | 'point-sequence' // N free points; kernel resolves creases from the points
  | 'line-entity' // pick N crease ids; commit line_ids, no points
  | 'lengthen' // drag a selection line to pick creases, then click the target
  | 'axis-from-line' // click a crease (→ its endpoints) or place 2 points
  | 'line-click-mutate' // click crease toggles/(de)selects; box-drag hybrid
  | 'circle-apply' // circle selection (+ a point for tangent)
  | 'drag-line'
  | 'drag-box'
  | 'drag-path'
  | 'bespoke' // per-tool state machine (SquareBisector, Voronoi, Text)
  | 'select-apply'; // no canvas interaction; operates on the selection via Apply

/**
 * Per-step snap mode for point/axis tools. The canvas `StepKind` is this type:
 * `point` → free grid/vertex snap; `crease` → onto an existing crease when one is
 * near, else the raw point (a step the kernel is happy to resolve from free
 * geometry, e.g. FoldableLineDraw's "draw anywhere to free draw"); `crease-required`
 * → the same snap, but a pick with no crease inside the kernel's selection distance
 * is *ignored* rather than committed, because the kernel would reject it (Oriedita's
 * "select a destination line" steps simply stay on the step); `candidate` → onto the
 * nearest kernel-previewed candidate ray (flat-foldable middle step).
 */
export type CpStepSnap = 'point' | 'crease' | 'crease-required' | 'candidate';

export interface CpInputModelEntry {
  model: CpInputModel;
  /** point-sequence / axis-from-line: number of point steps the tool collects. */
  pointCount?: number;
  /** Per-step snap mode (length === pointCount) for point/axis models. */
  snapPerStep?: readonly CpStepSnap[];
  /** line-entity: number of crease picks the tool collects. */
  lineCount?: number;
  /**
   * Commit straight away when the tool's *final* candidate step has exactly one
   * option, instead of asking for a click that has only one place to land.
   *
   * Opt-in per tool rather than a blanket rule. On a tool whose candidate step
   * is followed by more steps, resolving it is free — the user still confirms
   * later. On a tool that *ends* on the candidate step this commits geometry, so
   * it is only right where the preceding click already expressed the intent.
   */
  commitOnLoneCandidate?: boolean;
}

export const CP_INPUT_MODELS: Partial<Record<OristudioCpOperationId, CpInputModelEntry>> = {
  // POINT-SEQUENCE — N points, kernel resolves creases from points (§4.D)
  AngleSystem: { model: 'point-sequence', pointCount: 3, snapPerStep: ['point', 'point', 'crease'] },
  Axiom5: { model: 'point-sequence', pointCount: 4, snapPerStep: ['point', 'crease', 'point', 'crease'] },
  Axiom7: { model: 'point-sequence', pointCount: 4, snapPerStep: ['point', 'crease', 'crease', 'crease'] },
  CircleDraw: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  CircleDrawConcentric: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  CircleDrawFree: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  CircleDrawSeparate: { model: 'point-sequence', pointCount: 3, snapPerStep: ['point', 'point', 'point'] },
  CircleDrawThreePoint: { model: 'point-sequence', pointCount: 3, snapPerStep: ['point', 'point', 'point'] },
  ContinuousSymmetricDraw: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  CreaseCopy: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  CreaseCopy4p: { model: 'point-sequence', pointCount: 4, snapPerStep: ['point', 'point', 'point', 'point'] },
  CreaseDeleteIntersecting: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  CreaseDeleteOverlapping: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  CreaseMove: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  CreaseMove4p: { model: 'point-sequence', pointCount: 4, snapPerStep: ['point', 'point', 'point', 'point'] },
  DeletePoint: { model: 'point-sequence', pointCount: 1, snapPerStep: ['point'] },
  DisplayAngleBetweenThreePoints1: { model: 'point-sequence', pointCount: 3, snapPerStep: ['point', 'point', 'point'] },
  DisplayAngleBetweenThreePoints2: { model: 'point-sequence', pointCount: 3, snapPerStep: ['point', 'point', 'point'] },
  DisplayAngleBetweenThreePoints3: { model: 'point-sequence', pointCount: 3, snapPerStep: ['point', 'point', 'point'] },
  DisplayLengthBetweenPoints1: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  DisplayLengthBetweenPoints2: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  DoubleSymmetricDraw: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  DrawBirdBase: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  DrawBlintz: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  // Converging Lines: driven by a bespoke canvas handler (dual first click → base
  // segment, then a converge pick on a ray intersection). The step kinds here are
  // nominal — the panel special-cases this op and does not route via snapPerStep.
  DrawCreaseAngleRestricted: { model: 'point-sequence', pointCount: 3, snapPerStep: ['point', 'point', 'candidate'] },
  DrawCreaseAngleRestricted3: { model: 'point-sequence', pointCount: 3, snapPerStep: ['point', 'point', 'crease'] },
  // Angle Restricted Line: the panel special-cases this op as a press-drag-release
  // 'angle-drag' — the shared drag-line engine, but kernel-previewed (the kernel owns
  // the angle snap). The entry below is nominal: kept for registry coverage, not
  // routed via snapPerStep.
  DrawCreaseAngleRestricted5: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  DrawDoveBase: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  DrawFishBase: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  DrawFrogBase: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  DrawPoint: { model: 'point-sequence', pointCount: 1, snapPerStep: ['point'] },
  FishBoneDraw: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  FoldableLineDraw: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'crease'] },
  FoldableLineInput: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  Inward: { model: 'point-sequence', pointCount: 3, snapPerStep: ['point', 'point', 'point'] },
  // Drag to draw the segment; the kernel divides that drawn line (by count / ratio)
  // rather than an existing crease — Oriedita's LINE_SEGMENT_DIVISION_27 / _RATIO_28.
  LineSegmentDivision: { model: 'drag-line' },
  LineSegmentRatioSet: { model: 'drag-line' },
  ParallelDraw: { model: 'point-sequence', pointCount: 3, snapPerStep: ['point', 'crease', 'crease'] },
  ParallelDrawWidth: { model: 'point-sequence', pointCount: 2, snapPerStep: ['crease', 'point'] },
  PerpendicularDraw: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'crease'] },
  PolygonSetNoCorners: { model: 'point-sequence', pointCount: 2, snapPerStep: ['crease', 'crease'] },
  // One click and the square is placed. Free point snap, not 'crease': the
  // anchor is a position on the grid, and pulling it onto a nearby crease would
  // take a whole-cell square off the lattice it was sized against.
  SquareGenerate: { model: 'point-sequence', pointCount: 1, snapPerStep: ['point'] },
  SelectLineIntersecting: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  SymmetricDraw: { model: 'point-sequence', pointCount: 2, snapPerStep: ['crease', 'crease'] },
  UnselectLineIntersecting: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  VertexDeleteOnCrease: { model: 'point-sequence', pointCount: 1, snapPerStep: ['point'] },
  // Insert vertex: one click, and the kernel splits every crease through it.
  //
  // Free point snap and not 'crease', which looks like the obvious choice and is
  // the wrong one. A crease step projects the cursor onto the *nearest* crease;
  // the kernel asks "is this point on this crease" at 1e-4 model units and
  // splits at the supplied point rather than at its own projection, so a
  // perpendicular foot onto one crease lands well off the other and splits half
  // a crossing. What makes the point exact is the junction snap layered on the
  // point step — see `snapsToCreaseCrossings` in tools/predicates.
  VertexInsertOnCreases: { model: 'point-sequence', pointCount: 1, snapPerStep: ['point'] },
  // Foldable Line: vertex → one of the previewed candidates. Two steps, not
  // Oriedita's three — each candidate is drawn to whatever stops it and carries
  // that line along, so the kernel no longer needs a click naming the crease to
  // extend to. It still accepts one (see `resolved_completion_destination`); the
  // UI simply has nothing left to ask.
  VertexMakeAngularlyFlatFoldable: {
    model: 'point-sequence',
    pointCount: 2,
    snapPerStep: ['point', 'candidate'],
    // With one completion there is nothing to choose between, so clicking the
    // vertex is already the whole decision and a second click would only have
    // one place to land.
    commitOnLoneCandidate: true,
  },

  // LENGTHEN — drag a selection line across the crease(s) to extend (a click is the
  // degenerate nearest-crease fallback), then click the target line to extend to.
  // Commits 3 points [selectionA, selectionB, extensionPoint]; the kernel picks the
  // creases the selection line crosses and extends them to the target (Oriedita's
  // LENGTHEN_CREASE_5 two-gesture flow). (§4.E)
  LengthenCrease: { model: 'lengthen' },
  LengthenCreaseSameColor: { model: 'lengthen' },

  // AXIS-FROM-LINE — line-click shortcut or 2 points, commit points (§4.G)
  DrawCreaseSymmetric: { model: 'axis-from-line', pointCount: 2, snapPerStep: ['point', 'point'] },

  // LINE-CLICK-MUTATE — click crease toggles/(de)selects; box-drag hybrid (§4.F)
  CreaseSelect: { model: 'line-click-mutate' },
  CreaseToggleMv: { model: 'line-click-mutate' },
  CreaseUnselect: { model: 'line-click-mutate' },

  // SELECTION-CIRCLE-APPLY — circle selection (+ point for tangent) (§4.H)
  CircleDrawConcentricSelect: { model: 'circle-apply' },
  CircleDrawConcentricTwoCircleSelect: { model: 'circle-apply' },
  CircleDrawInverted: { model: 'circle-apply' },
  CircleDrawTangentLine: { model: 'circle-apply' },

  // DRAG-LINE (§4.A)
  CreaseMakeMv: { model: 'drag-line' },
  CreasesAlternateMv: { model: 'drag-line' },
  DrawCreaseFree: { model: 'drag-line' },
  DrawCreaseRestricted: { model: 'drag-line' },

  // DRAG-BOX / erase (§4.B)
  LineSegmentDelete: { model: 'drag-box' },
  // The operation frame is a rubber-band rectangle (two corners), not a freeform path.
  OperationFrameCreate: { model: 'drag-box' },
  // Check-suppression region: the same rubber-band rectangle, and the reason it
  // needs nothing else. `drag-box` already routes press / move / release and
  // hands back the box's corners, so the whole tool is this entry plus the
  // commit — no `ActiveToolMode` member and no canvas branch, which is the cost
  // the Text tool paid and the one this deliberately does not.
  //
  // View-aligned like every box but the operation frame's: the four corners the
  // engine returns are the rectangle the user actually dragged on screen, which
  // is what a rotated view should produce. See `isModelAlignedBoxOperation`.
  CheckSuppressionRegionCreate: { model: 'drag-box' },

  // DRAG-PATH (§4.C)
  FlatFoldableCheck: { model: 'drag-path' },
  SelectLasso: { model: 'drag-path' },
  SelectPolygon: { model: 'drag-path' },
  UnselectLasso: { model: 'drag-path' },
  UnselectPolygon: { model: 'drag-path' },

  // BESPOKE — per-tool state machines (§4.J)
  // Three crease picks and no points: the vertex is the endpoint all three
  // share, which the kernel derives rather than asking for a fourth click.
  // The commit is intercepted by `useVertexSolve` — the solve usually has more
  // than one answer, so the tool holds them for review instead of applying.
  VertexSolveFoldAngles: { model: 'line-entity', lineCount: 3 },
  SquareBisector: { model: 'bespoke' },
  Text: { model: 'bespoke' },
  VoronoiCreate: { model: 'bespoke' },

  // SELECT-APPLY — no canvas interaction, operates on selection via Apply (§4.I)
  ChangeCreaseType: { model: 'select-apply' },
  Check1: { model: 'select-apply' },
  Check2: { model: 'select-apply' },
  Check3: { model: 'select-apply' },
  Check4: { model: 'select-apply' },
  CheckCamv: { model: 'select-apply' },
  CircleChangeColor: { model: 'select-apply' },
  CreaseAdvanceType: { model: 'select-apply' },
  CreaseMakeAux: { model: 'select-apply' },
  CreaseMakeUnassigned: { model: 'select-apply' },
  PropagateFoldAngles: { model: 'point-sequence', pointCount: 1, snapPerStep: ['point'] },
  CreaseMakeEdge: { model: 'select-apply' },
  CreaseMakeMountain: { model: 'select-apply' },
  CreaseMakeValley: { model: 'select-apply' },
  CreaseSetLineColor: { model: 'select-apply' },
  CreaseSetFoldAngle: { model: 'select-apply' },
  CreaseSetDirectionHint: { model: 'select-apply' },
  DeleteLineTypeSelect: { model: 'select-apply' },
  DeleteExtraVertices: { model: 'select-apply' },
  DeleteExtraVerticesIgnoreColor: { model: 'select-apply' },
  // Reached only from an accepted solve, with its line ids in hand; no pointer
  // input, but the registry covers every ready command.
  DeleteExtraVerticesAmong: { model: 'select-apply' },
  Fix1: { model: 'select-apply' },
  Fix2: { model: 'select-apply' },
  FixInaccurate: { model: 'select-apply' },
  OrganizeCircles: { model: 'select-apply' },
  ReplaceLineTypeSelect: { model: 'select-apply' },
};

/** Look up a tool's input model. Returns undefined for unknown operation ids. */
export function cpInputModel(
  operationId: OristudioCpOperationId | null | undefined
): CpInputModelEntry | undefined {
  return operationId ? CP_INPUT_MODELS[operationId] : undefined;
}
