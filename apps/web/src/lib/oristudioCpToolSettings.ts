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
  | 'lengthen-color-mode'
  | 'divide-mode'
  | 'division-count'
  | 'division-ratio'
  | 'replace-line-type'
  | 'delete-line-type'
  | 'erase-line-type'
  | 'fix-precision'
  | 'polygon-corners'
  | 'square'
  | 'parallel-width'
  | 'candidate-choice'
  | 'completion-stops'
  | 'line-select-help'
  | 'circle-select-help'
  | 'apply-lines'
  | 'measure'
  | 'custom-circle-color';

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

/**
 * Which colour the Extend Line tool gives an extension: the active line type, or
 * whatever the crease being extended already carries.
 *
 * The two are separate Oriedita mouse handlers (`LENGTHEN_CREASE_5` and
 * `LENGTHEN_CREASE_SAME_COLOR_70`); Ori Studio merges them into one rail tool and
 * chooses between them with this option. See `cp-workspace/tools/toolVariants.ts`.
 */
export type OristudioCpLengthenColorMode = 'active' | 'same';

export const ORISTUDIO_CP_LENGTHEN_COLOR_MODES: readonly OristudioCpLengthenColorMode[] = [
  'active',
  'same',
];

/**
 * How the Divided Line tool subdivides the segment it draws: into N equal parts,
 * or at a ratio. The same merge as {@link OristudioCpLengthenColorMode}, over
 * `LINE_SEGMENT_DIVISION_27` and `LINE_SEGMENT_RATIO_SET_28`.
 */
export type OristudioCpDivideMode = 'count' | 'ratio';

export const ORISTUDIO_CP_DIVIDE_MODES: readonly OristudioCpDivideMode[] = ['count', 'ratio'];

/**
 * Which way the Square tool's square sits: edges along the axes, or the same
 * square turned 45°.
 */
export type OristudioCpSquareOrientation = 'normal' | 'diagonal';

export const ORISTUDIO_CP_SQUARE_ORIENTATIONS: readonly OristudioCpSquareOrientation[] = [
  'normal',
  'diagonal',
];

/**
 * Where on the square's **bounding box** the click lands — the nine cells of a
 * transform-origin picker.
 *
 * Deliberately about the bounding box rather than about a corner of the square,
 * which is what keeps it independent of {@link OristudioCpSquareOrientation}:
 * these nine positions mean the same thing whichever way the square is turned,
 * so the picker never changes shape when the orientation flips. The square has
 * four corners either way; all that changes is which cells they land on — the
 * corner cells when normal, the side cells when diagonal.
 */
export type OristudioCpSquareAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/** Row-major, so the array indexes the 3×3 picker directly. */
export const ORISTUDIO_CP_SQUARE_ANCHORS: readonly OristudioCpSquareAnchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

/**
 * What the Square tool's size number is measured in.
 *
 * `grid` is grid cells — how a box-pleater states a size, and the unit that puts
 * corners on grid intersections. `paper` is fractions of the paper edge, for
 * work that is not on a grid at all.
 */
export type OristudioCpSquareSizeUnit = 'grid' | 'paper';

export const ORISTUDIO_CP_SQUARE_SIZE_UNITS: readonly OristudioCpSquareSizeUnit[] = [
  'grid',
  'paper',
];

/**
 * Whether the Square tool's edges take the active line type or are always Edge.
 *
 * Edge by default because a square is usually a boundary, but someone who draws
 * squares in mountain should get that every time — hence a persisted param
 * rather than a hardcoded colour.
 */
export type OristudioCpSquareLineType = 'edge' | 'active';

export const ORISTUDIO_CP_SQUARE_LINE_TYPES: readonly OristudioCpSquareLineType[] = [
  'edge',
  'active',
];

export interface OristudioCpToolOptions {
  lengthenColorMode: OristudioCpLengthenColorMode;
  divideMode: OristudioCpDivideMode;
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
  /** Square size, in {@link OristudioCpToolOptions.squareSizeUnit}. */
  squareSize: number;
  squareSizeUnit: OristudioCpSquareSizeUnit;
  squareOrientation: OristudioCpSquareOrientation;
  squareAnchor: OristudioCpSquareAnchor;
  squareLineType: OristudioCpSquareLineType;
  parallelWidth: number;
  candidateIndex: number | null;
  /**
   * Whether a completion candidate may end on an auxiliary line. Off by default:
   * auxiliary lines are construction guides, so stopping a crease at one is a
   * surprising place to stop — but a designer who draws guides deliberately wants
   * exactly that.
   */
  foldableLineStopsOnAux: boolean;
  customCircleColor: OristudioCpRgbColor;
  textContent: string;
}

export const DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS: OristudioCpToolOptions = {
  // Same-colour, because that is what the `E` chord did when Extend Line and
  // Lengthen by Same Color were two rail buttons, and `E` is in the adopted
  // single-key layout. The option is persisted, so this only decides first run.
  lengthenColorMode: 'same',
  divideMode: 'count',
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
  // Four cells: big enough to see on any grid, small enough not to swamp the
  // sheet on a coarse one.
  squareSize: 4,
  squareSizeUnit: 'grid',
  squareOrientation: 'normal',
  squareAnchor: 'top-left',
  squareLineType: 'edge',
  parallelWidth: 1,
  candidateIndex: null,
  foldableLineStopsOnAux: false,
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
  // The merged-tool pairs. Both variants of a pair list the mode selector, so it
  // is present whichever way the mode currently resolves — and the operand
  // control below it (count vs ratio) swaps with the resolved operation, with no
  // conditional rendering in the panel.
  LengthenCrease: ['lengthen-color-mode'],
  LengthenCreaseSameColor: ['lengthen-color-mode'],
  LineSegmentDivision: ['divide-mode', 'division-count'],
  LineSegmentRatioSet: ['divide-mode', 'division-ratio'],
  PolygonSetNoCorners: ['polygon-corners'],
  // No 'line-color': the square carries its own line-type param, and offering
  // the generic crease-colour picker beside it would give one decision two
  // controls that disagree in Edge mode.
  SquareGenerate: ['square'],
  ParallelDrawWidth: ['parallel-width'],
  ReplaceLineTypeSelect: ['replace-line-type'],
  DeleteLineTypeSelect: ['delete-line-type'],
  LineSegmentDelete: ['erase-line-type'],
  FixInaccurate: ['fix-precision'],
  VertexMakeAngularlyFlatFoldable: ['completion-stops'],
  FoldableLineDraw: ['completion-stops'],
  SelectLineIntersecting: ['line-select-help'],
  UnselectLineIntersecting: ['line-select-help'],
  CreaseDeleteIntersecting: ['line-select-help'],
  DisplayLengthBetweenPoints1: ['measure'],
  DisplayLengthBetweenPoints2: ['measure'],
  DisplayAngleBetweenThreePoints1: ['measure'],
  DisplayAngleBetweenThreePoints2: ['measure'],
  DisplayAngleBetweenThreePoints3: ['measure'],
  CircleChangeColor: ['custom-circle-color'],
  CircleDrawTangentLine: ['circle-select-help', 'candidate-choice'],
  CircleDrawInverted: ['circle-select-help'],
  CircleDrawConcentric: ['circle-select-help'],
  CircleDrawConcentricSelect: ['circle-select-help', 'candidate-choice'],
  CircleDrawConcentricTwoCircleSelect: ['circle-select-help'],
  // Text is authored entirely on the canvas (inline editor, drag, right-click /
  // Delete); it has no side-panel settings — only the tool instructions show.
  Text: [],
  VoronoiCreate: ['apply-lines'],
  Axiom5: ['candidate-choice'],
  Axiom7: ['candidate-choice'],
};

/**
 * Which tool options each settings group owns.
 *
 * The same knowledge `CpContextToolGroup` switches on to render the controls,
 * written out so the panel's reset can name what it would put back. Keep the two
 * in step: a group that renders a control for an option it does not claim here
 * has a setting the reset cannot reach.
 *
 * Groups absent from this table own no options — they are help text or act on
 * the selection.
 */
const TOOL_OPTION_KEYS_BY_GROUP: Partial<
  Record<OristudioCpToolSettingGroup, readonly (keyof OristudioCpToolOptions)[]>
> = {
  'angle-system': ['angleSystemDivider', 'angleSystemAngles'],
  'lengthen-color-mode': ['lengthenColorMode'],
  'divide-mode': ['divideMode'],
  'division-count': ['divisionCount'],
  'division-ratio': ['divisionRatio'],
  'replace-line-type': ['customFromLineType', 'customToLineType'],
  'delete-line-type': ['customLineType'],
  'erase-line-type': ['customLineType'],
  'fix-precision': ['fixPrecision', 'fixPrecisionUseBp', 'fixPrecisionUse22_5'],
  'polygon-corners': ['polygonCorners'],
  square: [
    'squareSize',
    'squareSizeUnit',
    'squareOrientation',
    'squareAnchor',
    'squareLineType',
  ],
  'parallel-width': ['parallelWidth'],
  'candidate-choice': ['candidateIndex'],
  'completion-stops': ['foldableLineStopsOnAux'],
  'custom-circle-color': ['customCircleColor'],
};

/** The options behind a set of groups, deduplicated. */
export function cpToolOptionKeysForGroups(
  groups: readonly OristudioCpToolSettingGroup[]
): (keyof OristudioCpToolOptions)[] {
  const keys = new Set<keyof OristudioCpToolOptions>();
  for (const group of groups) {
    for (const key of TOOL_OPTION_KEYS_BY_GROUP[group] ?? []) keys.add(key);
  }
  return [...keys];
}

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
