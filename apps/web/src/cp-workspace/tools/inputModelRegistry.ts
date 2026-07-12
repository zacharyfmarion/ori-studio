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
 * Coverage + per-model shape (pointCount/lineCount) are guarded by
 * inputModelRegistry.test.ts, which fails if a UI command is missing an entry or
 * its counts drift from the command's declared `toolSteps`.
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

export interface CpInputModelEntry {
  model: CpInputModel;
  /** point-sequence / axis-from-line: number of point steps the tool collects. */
  pointCount?: number;
  /** line-entity: number of crease picks the tool collects. */
  lineCount?: number;
}

export const CP_INPUT_MODELS: Partial<Record<OristudioCpOperationId, CpInputModelEntry>> = {
  // POINT-SEQUENCE — N points, kernel resolves creases from points (§4.D)
  AngleSystem: { model: 'point-sequence', pointCount: 3 },
  Axiom5: { model: 'point-sequence', pointCount: 4 },
  Axiom7: { model: 'point-sequence', pointCount: 4 },
  CircleDraw: { model: 'point-sequence', pointCount: 2 },
  CircleDrawConcentric: { model: 'point-sequence', pointCount: 2 },
  CircleDrawFree: { model: 'point-sequence', pointCount: 2 },
  CircleDrawSeparate: { model: 'point-sequence', pointCount: 3 },
  CircleDrawThreePoint: { model: 'point-sequence', pointCount: 3 },
  ContinuousSymmetricDraw: { model: 'point-sequence', pointCount: 2 },
  CreaseCopy: { model: 'point-sequence', pointCount: 2 },
  CreaseCopy4p: { model: 'point-sequence', pointCount: 4 },
  CreaseDeleteIntersecting: { model: 'point-sequence', pointCount: 2 },
  CreaseDeleteOverlapping: { model: 'point-sequence', pointCount: 2 },
  CreaseMove: { model: 'point-sequence', pointCount: 2 },
  CreaseMove4p: { model: 'point-sequence', pointCount: 4 },
  DeletePoint: { model: 'point-sequence', pointCount: 1 },
  DisplayAngleBetweenThreePoints1: { model: 'point-sequence', pointCount: 3 },
  DisplayAngleBetweenThreePoints2: { model: 'point-sequence', pointCount: 3 },
  DisplayAngleBetweenThreePoints3: { model: 'point-sequence', pointCount: 3 },
  DisplayLengthBetweenPoints1: { model: 'point-sequence', pointCount: 2 },
  DisplayLengthBetweenPoints2: { model: 'point-sequence', pointCount: 2 },
  DoubleSymmetricDraw: { model: 'point-sequence', pointCount: 2 },
  DrawBirdBase: { model: 'point-sequence', pointCount: 2 },
  DrawBlintz: { model: 'point-sequence', pointCount: 2 },
  DrawCreaseAngleRestricted: { model: 'point-sequence', pointCount: 3 },
  DrawCreaseAngleRestricted3: { model: 'point-sequence', pointCount: 3 },
  DrawCreaseAngleRestricted5: { model: 'point-sequence', pointCount: 2 },
  DrawDoveBase: { model: 'point-sequence', pointCount: 2 },
  DrawFishBase: { model: 'point-sequence', pointCount: 2 },
  DrawFrogBase: { model: 'point-sequence', pointCount: 2 },
  DrawPoint: { model: 'point-sequence', pointCount: 1 },
  FishBoneDraw: { model: 'point-sequence', pointCount: 2 },
  FoldableLineDraw: { model: 'point-sequence', pointCount: 2 },
  FoldableLineInput: { model: 'point-sequence', pointCount: 2 },
  Inward: { model: 'point-sequence', pointCount: 3 },
  LineSegmentDivision: { model: 'point-sequence', pointCount: 1 },
  LineSegmentRatioSet: { model: 'point-sequence', pointCount: 1 },
  ParallelDraw: { model: 'point-sequence', pointCount: 3 },
  ParallelDrawWidth: { model: 'point-sequence', pointCount: 2 },
  PerpendicularDraw: { model: 'point-sequence', pointCount: 2 },
  PolygonSetNoCorners: { model: 'point-sequence', pointCount: 2 },
  SelectLineIntersecting: { model: 'point-sequence', pointCount: 2 },
  SymmetricDraw: { model: 'point-sequence', pointCount: 2 },
  UnselectLineIntersecting: { model: 'point-sequence', pointCount: 2 },
  VertexDeleteOnCrease: { model: 'point-sequence', pointCount: 1 },
  VertexMakeAngularlyFlatFoldable: { model: 'point-sequence', pointCount: 2 },

  // LINE-ENTITY — pick crease ids, commit line_ids, no points (§4.E)
  LengthenCrease: { model: 'line-entity', lineCount: 2 },
  LengthenCreaseSameColor: { model: 'line-entity', lineCount: 2 },

  // AXIS-FROM-LINE — line-click shortcut or 2 points, commit points (§4.G)
  DrawCreaseSymmetric: { model: 'axis-from-line', pointCount: 2 },

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
  Check1: { model: 'select-apply' },
  Check2: { model: 'select-apply' },
  Check3: { model: 'select-apply' },
  Check4: { model: 'select-apply' },
  ChangeCreaseType: { model: 'select-apply' },
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
