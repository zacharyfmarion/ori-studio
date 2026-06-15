import type {
  OristudioCpCircle,
  OristudioCpCommandPayload,
  OristudioCpDocumentSnapshot,
  OristudioCpLineSegment,
  OristudioCpTextElement,
} from '../engine/oristudioCpTypes';
import type { Point } from './geometry';
import type { CpModelBounds } from './creasePatternViewport';
import type { OristudioCpOperationId } from './oristudioCpCommands';
import {
  reflectPointAcrossSymmetryAxis,
  type SymmetryAxis,
} from './symmetryAuthoring';

export type OristudioCpSymmetryPreset = 'none' | 'book' | 'diagonal' | 'custom';
export type OristudioCpSymmetryPolicy =
  | 'geometry-points'
  | 'selection-tool'
  | 'selection-scoped-edit'
  | 'fixed-arity-entity'
  | 'text'
  | 'run-once';

export interface OristudioCpSymmetryState {
  enabled: boolean;
  showAxis: boolean;
  mirrorSelection: boolean;
  preset: OristudioCpSymmetryPreset;
  axis: SymmetryAxis;
}

export type OristudioCpCommandPayloadValidation =
  | { ok: true; payload: OristudioCpCommandPayload }
  | { ok: false; error: string };

export type PreparedOristudioCpCommandPayloads =
  | { ok: true; payloads: OristudioCpCommandPayload[] }
  | { ok: false; error: string };

const DEFAULT_CP_AXIS: SymmetryAxis = {
  loc: { x: 0, y: 0 },
  angle: 90,
};

const POINT_TOLERANCE = 1e-7;

export const DEFAULT_ORISTUDIO_CP_SYMMETRY: OristudioCpSymmetryState = {
  enabled: false,
  showAxis: true,
  mirrorSelection: false,
  preset: 'none',
  axis: DEFAULT_CP_AXIS,
};

export const ORISTUDIO_CP_SYMMETRY_POLICIES: Partial<
  Record<OristudioCpOperationId, OristudioCpSymmetryPolicy>
> = {
  DrawCreaseFree: 'geometry-points',
  LineSegmentDelete: 'selection-scoped-edit',
  ChangeCreaseType: 'selection-scoped-edit',
  LengthenCrease: 'fixed-arity-entity',
  SquareBisector: 'fixed-arity-entity',
  Inward: 'geometry-points',
  PerpendicularDraw: 'geometry-points',
  SymmetricDraw: 'geometry-points',
  DrawCreaseRestricted: 'geometry-points',
  DrawCreaseSymmetric: 'geometry-points',
  DrawCreaseAngleRestricted: 'geometry-points',
  DrawPoint: 'geometry-points',
  DeletePoint: 'geometry-points',
  AngleSystem: 'geometry-points',
  DrawCreaseAngleRestricted3: 'geometry-points',
  CreaseSelect: 'selection-tool',
  CreaseUnselect: 'selection-tool',
  CreaseMove: 'geometry-points',
  CreaseCopy: 'geometry-points',
  CreaseMakeMountain: 'selection-scoped-edit',
  CreaseMakeValley: 'selection-scoped-edit',
  CreaseMakeEdge: 'selection-scoped-edit',
  CreaseSetLineColor: 'selection-scoped-edit',
  LineSegmentDivision: 'fixed-arity-entity',
  LineSegmentRatioSet: 'fixed-arity-entity',
  PolygonSetNoCorners: 'geometry-points',
  CreaseAdvanceType: 'selection-scoped-edit',
  CreaseMove4p: 'geometry-points',
  CreaseCopy4p: 'geometry-points',
  FishBoneDraw: 'geometry-points',
  CreaseMakeMv: 'geometry-points',
  DoubleSymmetricDraw: 'geometry-points',
  CreasesAlternateMv: 'geometry-points',
  DrawCreaseAngleRestricted5: 'geometry-points',
  VertexMakeAngularlyFlatFoldable: 'geometry-points',
  FoldableLineInput: 'geometry-points',
  ParallelDraw: 'geometry-points',
  VertexDeleteOnCrease: 'geometry-points',
  CircleDraw: 'geometry-points',
  CircleDrawThreePoint: 'geometry-points',
  CircleDrawSeparate: 'geometry-points',
  CircleDrawTangentLine: 'fixed-arity-entity',
  CircleDrawInverted: 'fixed-arity-entity',
  CircleDrawFree: 'geometry-points',
  CircleDrawConcentric: 'fixed-arity-entity',
  CircleDrawConcentricSelect: 'fixed-arity-entity',
  CircleDrawConcentricTwoCircleSelect: 'fixed-arity-entity',
  ParallelDrawWidth: 'fixed-arity-entity',
  ContinuousSymmetricDraw: 'geometry-points',
  DisplayLengthBetweenPoints1: 'run-once',
  DisplayLengthBetweenPoints2: 'run-once',
  DisplayAngleBetweenThreePoints1: 'run-once',
  DisplayAngleBetweenThreePoints2: 'run-once',
  DisplayAngleBetweenThreePoints3: 'run-once',
  CreaseToggleMv: 'selection-scoped-edit',
  CircleChangeColor: 'selection-scoped-edit',
  CreaseMakeAux: 'selection-scoped-edit',
  OperationFrameCreate: 'run-once',
  VoronoiCreate: 'geometry-points',
  FlatFoldableCheck: 'run-once',
  CreaseDeleteOverlapping: 'geometry-points',
  CreaseDeleteIntersecting: 'geometry-points',
  SelectPolygon: 'selection-tool',
  UnselectPolygon: 'selection-tool',
  SelectLineIntersecting: 'selection-tool',
  UnselectLineIntersecting: 'selection-tool',
  LengthenCreaseSameColor: 'fixed-arity-entity',
  FoldableLineDraw: 'geometry-points',
  ReplaceLineTypeSelect: 'selection-scoped-edit',
  DeleteLineTypeSelect: 'selection-scoped-edit',
  SelectLasso: 'selection-tool',
  UnselectLasso: 'selection-tool',
  Text: 'text',
  DrawBlintz: 'geometry-points',
  DrawFishBase: 'geometry-points',
  DrawDoveBase: 'geometry-points',
  DrawBirdBase: 'geometry-points',
  DrawFrogBase: 'geometry-points',
  Axiom5: 'geometry-points',
  Axiom7: 'geometry-points',
  FixInaccurate: 'selection-scoped-edit',
  CheckCamv: 'run-once',
  Check1: 'run-once',
  Check2: 'run-once',
  Check3: 'run-once',
  Check4: 'run-once',
  Fix1: 'run-once',
  Fix2: 'run-once',
  OrganizeCircles: 'run-once',
};

export function defaultOristudioCpSymmetry(): OristudioCpSymmetryState {
  return {
    ...DEFAULT_ORISTUDIO_CP_SYMMETRY,
    axis: { ...DEFAULT_ORISTUDIO_CP_SYMMETRY.axis, loc: { ...DEFAULT_ORISTUDIO_CP_SYMMETRY.axis.loc } },
  };
}

export function normalizeOristudioCpSymmetry(value: unknown): OristudioCpSymmetryState {
  if (!isRecord(value)) return defaultOristudioCpSymmetry();
  const axis = isRecord(value.axis) ? value.axis : {};
  const loc = isRecord(axis.loc) ? axis.loc : {};
  const preset = value.preset;
  return {
    enabled: value.enabled === true,
    showAxis: value.showAxis !== false,
    mirrorSelection: value.mirrorSelection === true,
    preset:
      preset === 'none' || preset === 'book' || preset === 'diagonal' || preset === 'custom'
        ? preset
        : 'none',
    axis: {
      loc: {
        x: numberOr(loc.x, DEFAULT_CP_AXIS.loc.x),
        y: numberOr(loc.y, DEFAULT_CP_AXIS.loc.y),
      },
      angle: numberOr(axis.angle, DEFAULT_CP_AXIS.angle),
    },
  };
}

export function cpSymmetryPresetAxis(
  preset: Exclude<OristudioCpSymmetryPreset, 'none' | 'custom'>,
  currentAngle = 90
): SymmetryAxis {
  if (preset === 'diagonal') {
    const normalized = normalizeAngle(currentAngle);
    return {
      loc: { x: 0, y: 0 },
      angle: Math.abs(normalized - 45) < Math.abs(normalized - 135) ? 45 : 135,
    };
  }
  const normalized = normalizeAngle(currentAngle);
  return {
    loc: { x: 0, y: 0 },
    angle: Math.abs(normalized - 0) < Math.abs(normalized - 90) ? 0 : 90,
  };
}

export function nextCpSymmetryPresetAxis(
  symmetry: OristudioCpSymmetryState
): SymmetryAxis | null {
  if (symmetry.preset === 'book') {
    return {
      loc: { x: 0, y: 0 },
      angle: Math.abs(normalizeAngle(symmetry.axis.angle)) < 45 ? 90 : 0,
    };
  }
  if (symmetry.preset === 'diagonal') {
    return {
      loc: { x: 0, y: 0 },
      angle: Math.abs(normalizeAngle(symmetry.axis.angle) - 45) < 45 ? 135 : 45,
    };
  }
  return null;
}

export function axisFromTwoPoints(a: Point, b: Point): SymmetryAxis | null {
  if (samePoint(a, b)) return null;
  return {
    loc: a,
    angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  };
}

export function reflectCpLineSegment(
  segment: OristudioCpLineSegment,
  axis: SymmetryAxis
): OristudioCpLineSegment {
  return {
    ...segment,
    a: reflectPointAcrossSymmetryAxis(segment.a, axis),
    b: reflectPointAcrossSymmetryAxis(segment.b, axis),
  };
}

export function reflectCpCircle(circle: OristudioCpCircle, axis: SymmetryAxis): OristudioCpCircle {
  const center = reflectPointAcrossSymmetryAxis({ x: circle.x, y: circle.y }, axis);
  return {
    ...circle,
    x: center.x,
    y: center.y,
  };
}

export function reflectedCpCommandPayloads(
  operationId: OristudioCpOperationId,
  document: OristudioCpDocumentSnapshot,
  payload: OristudioCpCommandPayload,
  symmetry: OristudioCpSymmetryState
): OristudioCpCommandPayload[] {
  const prepared = prepareOristudioCpCommandPayloads(operationId, document, payload, symmetry);
  return prepared.ok ? prepared.payloads : [];
}

export function prepareOristudioCpCommandPayloads(
  operationId: OristudioCpOperationId,
  document: OristudioCpDocumentSnapshot,
  rawPayload: unknown,
  symmetry: OristudioCpSymmetryState
): PreparedOristudioCpCommandPayloads {
  const validation = normalizeOristudioCpCommandPayload(rawPayload);
  if (!validation.ok) return { ok: false, error: validation.error };

  const payload = validation.payload;
  if (!symmetry.enabled) return preparedPayloads([payload]);

  switch (ORISTUDIO_CP_SYMMETRY_POLICIES[operationId] ?? 'run-once') {
    case 'selection-tool':
      return preparedPayloads(
        symmetry.mirrorSelection ? reflectedSelectionPayloads(document, payload, symmetry) : [payload]
      );
    case 'selection-scoped-edit':
      return preparedPayloads([expandedEntitySelectionPayload(document, payload, symmetry.axis)]);
    case 'fixed-arity-entity':
      return preparedPayloads(reflectedOrderedEntityPayloads(document, payload, symmetry));
    case 'geometry-points':
      return preparedPayloads(reflectedPointPayloads(document, payload, symmetry));
    case 'text':
      return preparedPayloads(reflectedTextPayloads(document, payload, symmetry));
    case 'run-once':
      return preparedPayloads([payload]);
  }
  return preparedPayloads([payload]);
}

export function normalizeOristudioCpCommandPayload(
  rawPayload: unknown
): OristudioCpCommandPayloadValidation {
  if (rawPayload === null || rawPayload === undefined) return { ok: true, payload: {} };
  if (!isRecord(rawPayload)) {
    const kind = Array.isArray(rawPayload) ? 'array' : typeof rawPayload;
    return {
      ok: false,
      error: `Invalid crease-pattern command payload: expected an object, null, or undefined, received ${kind}.`,
    };
  }
  return { ok: true, payload: compactOristudioCpCommandPayload(rawPayload) };
}

export function shouldMirrorOristudioCpCommandPreview(
  operationId: OristudioCpOperationId | null | undefined,
  symmetry: OristudioCpSymmetryState
): boolean {
  if (!operationId || !symmetry.enabled) return false;
  const policy = ORISTUDIO_CP_SYMMETRY_POLICIES[operationId] ?? 'run-once';
  if (policy === 'run-once') return false;
  return policy !== 'selection-tool' || symmetry.mirrorSelection;
}

export function reflectedPreviewSegments(
  segments: OristudioCpLineSegment[],
  symmetry: OristudioCpSymmetryState
): OristudioCpLineSegment[] {
  if (!symmetry.enabled) return segments;
  return [...segments, ...segments.map((segment) => reflectCpLineSegment(segment, symmetry.axis))];
}

export function reflectedPreviewPoints(
  points: Point[],
  symmetry: OristudioCpSymmetryState
): Point[] {
  if (!symmetry.enabled) return points;
  return [...points, ...points.map((point) => reflectPointAcrossSymmetryAxis(point, symmetry.axis))];
}

export function reflectedPreviewCircles(
  circles: OristudioCpCircle[],
  symmetry: OristudioCpSymmetryState
): OristudioCpCircle[] {
  if (!symmetry.enabled) return circles;
  return [...circles, ...circles.map((circle) => reflectCpCircle(circle, symmetry.axis))];
}

export function cpSymmetryAxisLine(axis: SymmetryAxis, bounds: CpModelBounds): [Point, Point] {
  const radians = (axis.angle * Math.PI) / 180;
  const span = Math.hypot(bounds.spanX, bounds.spanY) * 2;
  const dx = Math.cos(radians) * span;
  const dy = Math.sin(radians) * span;
  return [
    { x: axis.loc.x - dx, y: axis.loc.y - dy },
    { x: axis.loc.x + dx, y: axis.loc.y + dy },
  ];
}

export function mirroredCpLineIds(
  document: OristudioCpDocumentSnapshot,
  lineIds: readonly number[],
  axis: SymmetryAxis
): number[] {
  const ids = new Set<number>();
  for (const id of lineIds) {
    const mirrored = mirroredCpLineId(document, id, axis);
    if (mirrored !== null && mirrored !== id) ids.add(mirrored);
  }
  return Array.from(ids).sort((a, b) => a - b);
}

export function mirroredCpLineIdsInOrder(
  document: OristudioCpDocumentSnapshot,
  lineIds: readonly number[],
  axis: SymmetryAxis
): number[] | null {
  const mirrored = lineIds.map((id) => mirroredCpLineId(document, id, axis));
  if (mirrored.some((id) => id === null)) return null;
  return mirrored as number[];
}

export function mirroredCpCircleIds(
  document: OristudioCpDocumentSnapshot,
  circleIds: readonly number[],
  axis: SymmetryAxis
): number[] {
  const ids = new Set<number>();
  for (const id of circleIds) {
    const mirrored = mirroredCpCircleId(document, id, axis);
    if (mirrored !== null && mirrored !== id) ids.add(mirrored);
  }
  return Array.from(ids).sort((a, b) => a - b);
}

export function mirroredCpCircleIdsInOrder(
  document: OristudioCpDocumentSnapshot,
  circleIds: readonly number[],
  axis: SymmetryAxis
): number[] | null {
  const mirrored = circleIds.map((id) => mirroredCpCircleId(document, id, axis));
  if (mirrored.some((id) => id === null)) return null;
  return mirrored as number[];
}

export function mirroredCpTextIds(
  document: OristudioCpDocumentSnapshot,
  textIds: readonly number[],
  axis: SymmetryAxis
): number[] {
  const ids = new Set<number>();
  for (const id of textIds) {
    const mirrored = mirroredCpTextId(document, id, axis);
    if (mirrored !== null && mirrored !== id) ids.add(mirrored);
  }
  return Array.from(ids).sort((a, b) => a - b);
}

export function mirroredCpTextIdsInOrder(
  document: OristudioCpDocumentSnapshot,
  textIds: readonly number[],
  axis: SymmetryAxis
): number[] | null {
  const mirrored = textIds.map((id) => mirroredCpTextId(document, id, axis));
  if (mirrored.some((id) => id === null)) return null;
  return mirrored as number[];
}

function reflectedSelectionPayloads(
  document: OristudioCpDocumentSnapshot,
  payload: OristudioCpCommandPayload,
  symmetry: OristudioCpSymmetryState
): OristudioCpCommandPayload[] {
  if (!payload.points || payload.points.length === 0) {
    return [expandedEntitySelectionPayload(document, payload, symmetry.axis)];
  }

  return reflectedPointPayloads(document, payload, symmetry);
}

function reflectedOrderedEntityPayloads(
  document: OristudioCpDocumentSnapshot,
  payload: OristudioCpCommandPayload,
  symmetry: OristudioCpSymmetryState
): OristudioCpCommandPayload[] {
  const mirroredPayload = mirroredEntityPayloadInOrder(document, payload, symmetry.axis);
  if (!mirroredPayload && hasEntityIds(payload)) return [payload];
  return reflectedPointPayloads(document, payload, symmetry, mirroredPayload ?? payload);
}

function reflectedPointPayloads(
  document: OristudioCpDocumentSnapshot,
  payload: OristudioCpCommandPayload,
  symmetry: OristudioCpSymmetryState,
  mirroredEntityPayload = hasEntityIds(payload)
    ? mirroredEntityPayloadInOrder(document, payload, symmetry.axis)
    : payload
): OristudioCpCommandPayload[] {
  if (!payload.points || payload.points.length === 0) {
    if (!hasEntityIds(payload) || !mirroredEntityPayload) return [payload];
    return uniquePayloads([payload, mirroredEntityPayload]);
  }

  if (!mirroredEntityPayload) return [payload];

  const reflectedPoints = payload.points.map((point) =>
    reflectPointAcrossSymmetryAxis(point, symmetry.axis)
  );
  const reflectedPayload = {
    ...mirroredEntityPayload,
    points: reflectedPoints,
    replace_selection: payload.replace_selection ? false : payload.replace_selection,
  };

  return uniquePayloads([payload, reflectedPayload]);
}

function reflectedTextPayloads(
  document: OristudioCpDocumentSnapshot,
  payload: OristudioCpCommandPayload,
  symmetry: OristudioCpSymmetryState
): OristudioCpCommandPayload[] {
  switch (payload.text_action) {
    case 'SetContent':
    case 'DeleteSelected':
      return [expandedEntitySelectionPayload(document, payload, symmetry.axis)];
    case 'Move':
      return reflectedOrderedEntityPayloads(document, payload, symmetry);
    case 'DeleteAt':
    case 'DeleteBox':
    case 'Create':
    case undefined:
      return reflectedPointPayloads(document, payload, symmetry);
  }
}

function expandedEntitySelectionPayload(
  document: OristudioCpDocumentSnapshot,
  payload: OristudioCpCommandPayload,
  axis: SymmetryAxis
): OristudioCpCommandPayload {
  const lineIds = payload.line_ids ?? [];
  const circleIds = payload.circle_ids ?? [];
  const textIds = payload.text_ids ?? [];
  const mirroredLineIds = mirroredCpLineIds(document, lineIds, axis);
  const mirroredCircleIds = mirroredCpCircleIds(document, circleIds, axis);
  const mirroredTextIds = mirroredCpTextIds(document, textIds, axis);

  if (
    mirroredLineIds.length === 0 &&
    mirroredCircleIds.length === 0 &&
    mirroredTextIds.length === 0
  ) {
    return payload;
  }

  return {
    ...payload,
    line_ids:
      lineIds.length > 0
        ? sortedUniqueNumbers([...lineIds, ...mirroredLineIds])
        : payload.line_ids,
    circle_ids:
      circleIds.length > 0
        ? sortedUniqueNumbers([...circleIds, ...mirroredCircleIds])
        : payload.circle_ids,
    text_ids:
      textIds.length > 0
        ? sortedUniqueNumbers([...textIds, ...mirroredTextIds])
        : payload.text_ids,
  };
}

function mirroredEntityPayloadInOrder(
  document: OristudioCpDocumentSnapshot,
  payload: OristudioCpCommandPayload,
  axis: SymmetryAxis
): OristudioCpCommandPayload | null {
  const lineIds = payload.line_ids ?? [];
  const circleIds = payload.circle_ids ?? [];
  const textIds = payload.text_ids ?? [];
  let mirroredPayload = payload;

  if (lineIds.length > 0) {
    const mirroredLineIds = mirroredCpLineIdsInOrder(document, lineIds, axis);
    if (!mirroredLineIds) return null;
    mirroredPayload = { ...mirroredPayload, line_ids: mirroredLineIds };
  }

  if (circleIds.length > 0) {
    const mirroredCircleIds = mirroredCpCircleIdsInOrder(document, circleIds, axis);
    if (!mirroredCircleIds) return null;
    mirroredPayload = { ...mirroredPayload, circle_ids: mirroredCircleIds };
  }

  if (textIds.length > 0) {
    const mirroredTextIds = mirroredCpTextIdsInOrder(document, textIds, axis);
    if (!mirroredTextIds) return null;
    mirroredPayload = { ...mirroredPayload, text_ids: mirroredTextIds };
  }

  return mirroredPayload;
}

function mirroredCpLineId(
  document: OristudioCpDocumentSnapshot,
  lineId: number,
  axis: SymmetryAxis
): number | null {
  const lines = document.crease_pattern.line_segments;
  const line = lines[lineId - 1];
  if (!line) return null;
  const reflected = reflectCpLineSegment(line, axis);
  if (sameSegment(line, reflected)) return lineId;
  return findMatchingId(lines, reflected, sameSegment);
}

function mirroredCpCircleId(
  document: OristudioCpDocumentSnapshot,
  circleId: number,
  axis: SymmetryAxis
): number | null {
  const circles = document.crease_pattern.circles;
  const circle = circles[circleId - 1];
  if (!circle) return null;
  const reflected = reflectCpCircle(circle, axis);
  if (sameCircle(circle, reflected)) return circleId;
  return findMatchingId(circles, reflected, sameCircle);
}

function mirroredCpTextId(
  document: OristudioCpDocumentSnapshot,
  textId: number,
  axis: SymmetryAxis
): number | null {
  const texts = document.crease_pattern.texts;
  const text = texts[textId - 1];
  if (!text) return null;
  const reflected = reflectCpText(text, axis);
  if (sameTextPosition(text, reflected)) return textId;
  return findMatchingId(
    texts,
    reflected,
    (candidate, target) => candidate.text === text.text && sameTextPosition(candidate, target)
  );
}

function reflectCpText(text: OristudioCpTextElement, axis: SymmetryAxis): OristudioCpTextElement {
  const position = textPosition(text);
  if (!position) return text;
  const reflected = reflectPointAcrossSymmetryAxis(position, axis);
  return {
    ...text,
    x: reflected.x,
    y: reflected.y,
  };
}

function findMatchingId<T>(
  values: readonly T[],
  target: T,
  matches: (candidate: T, target: T) => boolean
): number | null {
  const index = values.findIndex((candidate) => matches(candidate, target));
  return index >= 0 ? index + 1 : null;
}

function sameSegment(a: OristudioCpLineSegment, b: OristudioCpLineSegment): boolean {
  return (
    (samePoint(a.a, b.a) && samePoint(a.b, b.b)) ||
    (samePoint(a.a, b.b) && samePoint(a.b, b.a))
  );
}

function sameCircle(a: OristudioCpCircle, b: OristudioCpCircle): boolean {
  return (
    samePoint({ x: a.x, y: a.y }, { x: b.x, y: b.y }) &&
    Math.abs(a.r - b.r) <= POINT_TOLERANCE
  );
}

function sameTextPosition(a: OristudioCpTextElement, b: OristudioCpTextElement): boolean {
  const aPosition = textPosition(a);
  const bPosition = textPosition(b);
  return aPosition !== null && bPosition !== null && samePoint(aPosition, bPosition);
}

function samePointList(a: readonly Point[], b: readonly Point[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((point, index) => {
    const other = b[index];
    return other ? samePoint(point, other) : false;
  });
}

function samePoint(a: Point, b: Point): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= POINT_TOLERANCE;
}

function sortedUniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function preparedPayloads(payloads: OristudioCpCommandPayload[]): PreparedOristudioCpCommandPayloads {
  return {
    ok: true,
    payloads: payloads.map(compactOristudioCpCommandPayload),
  };
}

function compactOristudioCpCommandPayload(
  payload: object
): OristudioCpCommandPayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  ) as OristudioCpCommandPayload;
}

function uniquePayloads(payloads: OristudioCpCommandPayload[]): OristudioCpCommandPayload[] {
  return payloads.filter((payload, index) =>
    payloads.findIndex((candidate) => samePayload(candidate, payload)) === index
  );
}

function samePayload(
  a: OristudioCpCommandPayload,
  b: OristudioCpCommandPayload
): boolean {
  return (
    sameNumberList(a.line_ids ?? [], b.line_ids ?? []) &&
    sameNumberList(a.circle_ids ?? [], b.circle_ids ?? []) &&
    sameNumberList(a.text_ids ?? [], b.text_ids ?? []) &&
    samePointList(a.points ?? [], b.points ?? []) &&
    a.replace_selection === b.replace_selection
  );
}

function sameNumberList(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function hasEntityIds(payload: OristudioCpCommandPayload): boolean {
  return (
    (payload.line_ids?.length ?? 0) > 0 ||
    (payload.circle_ids?.length ?? 0) > 0 ||
    (payload.text_ids?.length ?? 0) > 0
  );
}

function textPosition(text: OristudioCpTextElement): Point | null {
  const x = textCoordinate(text.x);
  const y = textCoordinate(text.y);
  if (x === null || y === null) return null;
  return { x, y };
}

function textCoordinate(value: number | { 0: number }): number | null {
  const coordinate = typeof value === 'number' ? value : value[0];
  return Number.isFinite(coordinate) ? coordinate : null;
}

function normalizeAngle(angle: number): number {
  return ((angle % 180) + 180) % 180;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
