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
  | 'axis-from-line' // click a crease (→ its endpoints) or place 2 points
  | 'line-click-mutate' // click crease toggles/(de)selects; box-drag hybrid
  | 'circle-apply' // circle selection (+ a point for tangent)
  | 'drag-line'
  | 'drag-box'
  | 'drag-path'
  | 'bespoke' // per-tool state machine (SquareBisector, Voronoi, Text)
  | 'select-apply'; // no canvas interaction; operates on the selection via Apply

/**
 * Per-step snap mode for point/axis tools. Mirrors the canvas `StepKind`:
 * `point` → free grid/vertex snap, `crease` → onto an existing crease, `candidate`
 * → onto the nearest kernel-previewed candidate ray (flat-foldable middle step).
 */
export type CpStepSnap = 'point' | 'crease' | 'candidate';

export interface CpInputModelEntry {
  model: CpInputModel;
  /** point-sequence / axis-from-line: number of point steps the tool collects. */
  pointCount?: number;
  /** Per-step snap mode (length === pointCount) for point/axis models. */
  snapPerStep?: readonly CpStepSnap[];
  /** line-entity: number of crease picks the tool collects. */
  lineCount?: number;
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
  SelectLineIntersecting: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  SymmetricDraw: { model: 'point-sequence', pointCount: 2, snapPerStep: ['crease', 'crease'] },
  UnselectLineIntersecting: { model: 'point-sequence', pointCount: 2, snapPerStep: ['point', 'point'] },
  VertexDeleteOnCrease: { model: 'point-sequence', pointCount: 1, snapPerStep: ['point'] },
  VertexMakeAngularlyFlatFoldable: { model: 'point-sequence', pointCount: 3, snapPerStep: ['point', 'candidate', 'crease'] },

  // LINE-ENTITY — pick crease ids, commit line_ids, no points (§4.E)
  LengthenCrease: { model: 'line-entity', lineCount: 2 },
  LengthenCreaseSameColor: { model: 'line-entity', lineCount: 2 },

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

  // DRAG-PATH (§4.C)
  FlatFoldableCheck: { model: 'drag-path' },
  OperationFrameCreate: { model: 'drag-path' },
  SelectLasso: { model: 'drag-path' },
  SelectPolygon: { model: 'drag-path' },
  UnselectLasso: { model: 'drag-path' },
  UnselectPolygon: { model: 'drag-path' },

  // BESPOKE — per-tool state machines (§4.J)
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
  CreaseMakeEdge: { model: 'select-apply' },
  CreaseMakeMountain: { model: 'select-apply' },
  CreaseMakeValley: { model: 'select-apply' },
  CreaseSetLineColor: { model: 'select-apply' },
  DeleteLineTypeSelect: { model: 'select-apply' },
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
