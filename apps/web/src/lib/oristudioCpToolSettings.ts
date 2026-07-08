import type {
  OristudioCpCustomLineType,
  OristudioCpRgbColor,
} from '../engine/oristudioCpTypes';
import type {
  OristudioCpCommandDefinition,
  OristudioCpOperationId,
} from './oristudioCpCommands';

export type OristudioCpToolSettingGroup =
  | 'line-color'
  | 'angle-system'
  | 'division-count'
  | 'division-ratio'
  | 'replace-line-type'
  | 'delete-line-type'
  | 'erase-line-type'
  | 'fix-precision'
  | 'polygon-corners'
  | 'parallel-width'
  | 'candidate-choice'
  | 'line-select-help'
  | 'circle-select-help'
  | 'apply-lines'
  | 'measurement-readout'
  | 'custom-circle-color'
  | 'text-content';

export interface OristudioCpRatioExpression {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface OristudioCpRatioHalf {
  a: number;
  b: number;
  c: number;
}

export interface OristudioCpToolOptions {
  divisionCount: number;
  divisionRatio: OristudioCpRatioExpression;
  angleSystemDivider: number;
  angleSystemAngles: [number, number, number, number, number, number];
  customFromLineType: OristudioCpCustomLineType;
  customToLineType: OristudioCpCustomLineType;
  customLineType: OristudioCpCustomLineType;
  fixPrecision: number;
  fixPrecisionUseBp: boolean;
  fixPrecisionUse22_5: boolean;
  polygonCorners: number;
  parallelWidth: number;
  candidateIndex: number | null;
  customCircleColor: OristudioCpRgbColor;
  textContent: string;
}

export const DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS: OristudioCpToolOptions = {
  divisionCount: 2,
  divisionRatio: {
    a: 1,
    b: 0,
    c: 0,
    d: 0,
    e: 1,
    f: 2,
  },
  angleSystemDivider: 8,
  angleSystemAngles: [40, 60, 80, 30, 50, 100],
  customFromLineType: 'Any',
  customToLineType: 'Edge',
  customLineType: 'Any',
  fixPrecision: 0.05,
  fixPrecisionUseBp: true,
  fixPrecisionUse22_5: true,
  polygonCorners: 5,
  parallelWidth: 1,
  candidateIndex: null,
  customCircleColor: { red: 100, green: 200, blue: 200 },
  textContent: '',
};

export const ORISTUDIO_CP_CUSTOM_LINE_TYPE_OPTIONS = [
  { value: 'Any', label: 'Any' },
  { value: 'Edge', label: 'Edge' },
  { value: 'MountainAndValley', label: 'M/V' },
  { value: 'Mountain', label: 'Mountain' },
  { value: 'Valley', label: 'Valley' },
  { value: 'Aux', label: 'Auxiliary' },
] as const satisfies readonly {
  value: OristudioCpCustomLineType;
  label: string;
}[];

export const ORISTUDIO_CP_REPLACE_TARGET_LINE_TYPE_OPTIONS =
  ORISTUDIO_CP_CUSTOM_LINE_TYPE_OPTIONS.filter(
    (option) => option.value !== 'Any' && option.value !== 'MountainAndValley'
  );

export const ORISTUDIO_CP_RATIO_PRESETS = [
  {
    label: '1:1',
    expression: ratioExpressionFromHalves(
      { a: 1, b: 0, c: 0 },
      { a: 1, b: 0, c: 0 }
    ),
  },
  {
    label: '1:2',
    expression: ratioExpressionFromHalves(
      { a: 1, b: 0, c: 0 },
      { a: 2, b: 0, c: 0 }
    ),
  },
  {
    label: '2:1',
    expression: ratioExpressionFromHalves(
      { a: 2, b: 0, c: 0 },
      { a: 1, b: 0, c: 0 }
    ),
  },
  {
    label: '1:sqrt(2)',
    expression: DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS.divisionRatio,
  },
  {
    label: 'sqrt(2):1',
    expression: ratioExpressionFromHalves(
      { a: 0, b: 1, c: 2 },
      { a: 1, b: 0, c: 0 }
    ),
  },
] as const;

const LINE_COLOR_OPERATION_IDS = new Set<OristudioCpOperationId>([
  'CreaseMakeMv',
  'CreasesAlternateMv',
  'LengthenCrease',
  'DrawCreaseFree',
  'DrawCreaseRestricted',
  'DrawCreaseSymmetric',
  'DrawCreaseAngleRestricted',
  'DrawCreaseAngleRestricted3',
  'DrawCreaseAngleRestricted5',
  'SquareBisector',
  'Inward',
  'PerpendicularDraw',
  'SymmetricDraw',
  'FishBoneDraw',
  'DoubleSymmetricDraw',
  'VertexMakeAngularlyFlatFoldable',
  'FoldableLineInput',
  'ParallelDraw',
  'ParallelDrawWidth',
  'ContinuousSymmetricDraw',
  'FoldableLineDraw',
  'Axiom5',
  'Axiom7',
  'PolygonSetNoCorners',
  'DrawBlintz',
  'DrawFishBase',
  'DrawDoveBase',
  'DrawBirdBase',
  'DrawFrogBase',
  'VoronoiCreate',
  'CircleDrawTangentLine',
]);

const TOOL_SETTING_GROUPS_BY_OPERATION: Partial<
  Record<OristudioCpOperationId, readonly OristudioCpToolSettingGroup[]>
> = {
  AngleSystem: ['angle-system'],
  DrawCreaseAngleRestricted: ['angle-system', 'candidate-choice'],
  DrawCreaseAngleRestricted3: ['angle-system', 'candidate-choice'],
  DrawCreaseAngleRestricted5: ['angle-system', 'candidate-choice'],
  LineSegmentDivision: ['division-count'],
  LineSegmentRatioSet: ['division-ratio'],
  PolygonSetNoCorners: ['polygon-corners'],
  ParallelDrawWidth: ['parallel-width'],
  ReplaceLineTypeSelect: ['replace-line-type'],
  DeleteLineTypeSelect: ['delete-line-type'],
  LineSegmentDelete: ['erase-line-type'],
  FixInaccurate: ['fix-precision'],
  SelectLineIntersecting: ['line-select-help'],
  UnselectLineIntersecting: ['line-select-help'],
  CreaseDeleteIntersecting: ['line-select-help'],
  DisplayLengthBetweenPoints1: ['measurement-readout'],
  DisplayLengthBetweenPoints2: ['measurement-readout'],
  DisplayAngleBetweenThreePoints1: ['measurement-readout'],
  DisplayAngleBetweenThreePoints2: ['measurement-readout'],
  DisplayAngleBetweenThreePoints3: ['measurement-readout'],
  CircleChangeColor: ['custom-circle-color'],
  CircleDrawTangentLine: ['circle-select-help', 'candidate-choice'],
  CircleDrawInverted: ['circle-select-help'],
  CircleDrawConcentric: ['circle-select-help'],
  CircleDrawConcentricSelect: ['circle-select-help', 'candidate-choice'],
  CircleDrawConcentricTwoCircleSelect: ['circle-select-help'],
  Text: ['text-content'],
  VoronoiCreate: ['apply-lines'],
  Axiom5: ['candidate-choice'],
  Axiom7: ['candidate-choice'],
};

export function cpToolSettingGroupsForOperation(
  operationId: OristudioCpOperationId
): readonly OristudioCpToolSettingGroup[] {
  const groups: OristudioCpToolSettingGroup[] = [];
  if (LINE_COLOR_OPERATION_IDS.has(operationId)) {
    groups.push('line-color');
  }
  groups.push(...(TOOL_SETTING_GROUPS_BY_OPERATION[operationId] ?? []));
  return groups;
}

export function cpToolSettingGroupsForCommand(
  command: OristudioCpCommandDefinition | null | undefined
): readonly OristudioCpToolSettingGroup[] {
  return command ? cpToolSettingGroupsForOperation(command.operationId) : [];
}

export function evaluateOrieditaRatioExpression(
  expression: OristudioCpRatioExpression
): { ratioS: number; ratioT: number } {
  return {
    ratioS: evaluateRatioPart(expression.a, expression.b, expression.c),
    ratioT: evaluateRatioPart(expression.d, expression.e, expression.f),
  };
}

function evaluateRatioPart(a: number, b: number, c: number): number {
  const linear = Number.isFinite(a) ? a : 0;
  const radical = Number.isFinite(b) ? b : 0;
  const radicand = Number.isFinite(c) ? Math.max(0, c) : 0;
  const value = linear + radical * Math.sqrt(radicand);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function ratioExpressionFromHalves(
  left: OristudioCpRatioHalf,
  right: OristudioCpRatioHalf
): OristudioCpRatioExpression {
  return {
    a: left.a,
    b: left.b,
    c: left.c,
    d: right.a,
    e: right.b,
    f: right.c,
  };
}

export function ratioHalvesFromExpression(
  expression: OristudioCpRatioExpression
): { left: OristudioCpRatioHalf; right: OristudioCpRatioHalf } {
  return {
    left: { a: expression.a, b: expression.b, c: expression.c },
    right: { a: expression.d, b: expression.e, c: expression.f },
  };
}

export function formatOrieditaRatioHalf(half: OristudioCpRatioHalf): string {
  const a = normalizedRatioNumber(half.a);
  const b = normalizedRatioNumber(half.b);
  const c = normalizedRatioNumber(half.c);
  if (b === 0) return formatOrieditaRatioNumber(a);

  const radical = `${formatRatioCoefficient(Math.abs(b))}sqrt(${formatOrieditaRatioNumber(c)})`;
  if (a === 0) return b < 0 ? `-${radical}` : radical;
  return `${formatOrieditaRatioNumber(a)} ${b < 0 ? '-' : '+'} ${radical}`;
}

export function parseOrieditaRatioHalfInput(
  input: string
): OristudioCpRatioHalf | null {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, '');
  if (normalized.length === 0) return null;
  const number = parseFiniteNumber(normalized);
  if (number !== null) {
    return { a: number, b: 0, c: 0 };
  }

  const sqrtStart = normalized.indexOf('sqrt(');
  if (sqrtStart < 0 || normalized.indexOf('sqrt(', sqrtStart + 1) >= 0) {
    return null;
  }
  if (!normalized.endsWith(')')) return null;

  const prefix = normalized.slice(0, sqrtStart);
  const radicand = parseFiniteNumber(normalized.slice(sqrtStart + 5, -1));
  if (radicand === null || radicand < 0) return null;
  const coefficients = parseRatioPrefix(prefix);
  if (!coefficients) return null;
  return {
    a: coefficients.a,
    b: coefficients.b,
    c: radicand,
  };
}

export function formatOrieditaRatioNumber(value: number): string {
  const normalized = normalizedRatioNumber(value);
  return Number.isInteger(normalized)
    ? normalized.toString()
    : normalized.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function normalizedRatioNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.abs(value) < 1e-9 ? 0 : value;
}

function formatRatioCoefficient(value: number): string {
  return value === 1 ? '' : `${formatOrieditaRatioNumber(value)}*`;
}

function parseFiniteNumber(value: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRatioPrefix(prefix: string): OristudioCpRatioHalf | null {
  const normalized = prefix.endsWith('*') ? prefix.slice(0, -1) : prefix;
  if (normalized === '' || normalized === '+') return { a: 0, b: 1, c: 0 };
  if (normalized === '-') return { a: 0, b: -1, c: 0 };

  const separatorIndex = lastSignIndexAfterFirstCharacter(normalized);
  if (separatorIndex < 0) {
    const coefficient = parseSignedCoefficient(normalized);
    return coefficient === null ? null : { a: 0, b: coefficient, c: 0 };
  }

  const a = parseFiniteNumber(normalized.slice(0, separatorIndex));
  const b = parseSignedCoefficient(normalized.slice(separatorIndex));
  if (a === null || b === null) return null;
  return { a, b, c: 0 };
}

function lastSignIndexAfterFirstCharacter(value: string): number {
  for (let index = value.length - 1; index > 0; index -= 1) {
    if (value[index] === '+' || value[index] === '-') return index;
  }
  return -1;
}

function parseSignedCoefficient(value: string): number | null {
  const trimmed = value.endsWith('*') ? value.slice(0, -1) : value;
  if (trimmed === '' || trimmed === '+') return 1;
  if (trimmed === '-') return -1;
  return parseFiniteNumber(trimmed);
}
