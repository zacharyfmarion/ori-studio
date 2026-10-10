/**
 * A References step's picture, read back from a file (D6): the
 * `StepDiagramModel` a card was drawn from, checked primitive by primitive.
 *
 * The model is plain JSON, but it is not inert the way a paper scene is: its
 * labels become text in every page it is drawn on, and its styles pick pens.
 * So it is held to the unions it was written from — every `kind` and `style`
 * one this build draws, every number finite, labels short — and rebuilt from
 * the fields read, never passed through, so what is kept is only what was
 * checked and is written back in one key order.
 *
 * A primitive kind, style or field this build does not know is a newer
 * build's drawing, not a broken one, and so is a model past what this build
 * draws — more primitives, labels, arrows or points, or a longer label: the
 * read says `unknown`, and the step that holds it is kept verbatim
 * (diagramFile.ts). Only a malformed primitive of a known kind fails the
 * model.
 *
 * React-free and store-free.
 */
import type {
  DiagramLineStyleName,
  DiagramPointStyleName,
  StepDiagramModel,
  StepDiagramPrimitive,
} from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import type { DiagramArc, DiagramSheet } from '../../cp-workspace/references/stepDiagramGeometry';
import { xmlText } from '../../lib/xmlEscape';

/** More than any card draws: a dense sheet's last step carries a few thousand. */
export const STEP_DIAGRAM_MAX_PRIMITIVES = 50_000;

/** A label is a letter or two (`A`, `B'`); anything longer is not one of ours. */
export const STEP_DIAGRAM_MAX_LABEL = 64;

/**
 * What a card marks — a step letters a handful of points and folds once or
 * twice. Bounded on their own, not only within the total, because drawing them
 * is not linear: each label is placed against every line, mark and other
 * label, and each arrow lands against every mark.
 */
export const STEP_DIAGRAM_MAX_LABELS = 64;
export const STEP_DIAGRAM_MAX_ARROWS = 64;
export const STEP_DIAGRAM_MAX_POINTS = 4096;
/** Labels × primitives: what placing the labels costs. A dense card's is a few tens of thousands. */
export const STEP_DIAGRAM_MAX_LABEL_WORK = 1_000_000;

const LINE_STYLES: ReadonlySet<string> = new Set<DiagramLineStyleName>([
  'crease',
  'aux',
  'edge',
  'highlight',
  'valley',
  'mountain',
  'fold-valley',
  'fold-mountain',
  'arrow',
  'dotted',
  'pinch',
  'pinch-mountain',
  'pinch-valley',
  'unfolded',
]);

const POINT_STYLES: ReadonlySet<string> = new Set<DiagramPointStyleName>(['normal', 'highlight', 'action']);

const PRIMITIVE_KINDS: ReadonlySet<string> = new Set<StepDiagramPrimitive['kind']>([
  'sheet',
  'line',
  'arc',
  'fold-arrow',
  'one-way-arrow',
  'push-arrow',
  'rotate',
  'turn-over',
  'region',
  'point',
  'label',
]);

/** The values each enumerated field of a primitive takes; another is a newer build's. */
const PRIMITIVE_ENUMS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  'one-way-arrow': { fold: ['valley', 'mountain'] },
  rotate: { amount: ['eighth', 'quarter', 'half'], direction: ['cw', 'ccw'] },
  'turn-over': { axis: ['vertical', 'horizontal'] },
};

export type StepDiagramModelRead =
  | { status: 'ok'; model: StepDiagramModel }
  /** A primitive kind or style this build does not draw: keep the step verbatim. */
  | { status: 'unknown' }
  | { status: 'malformed' };

/**
 * Read a stored model. `unknown` when any primitive names a kind or style
 * this build does not know, `malformed` when anything of a known kind does
 * not read, and the rebuilt model otherwise.
 */
export function validateStepDiagramModel(value: unknown): StepDiagramModelRead {
  if (!isRecord(value) || !Array.isArray(value.primitives)) return MALFORMED;
  const raw = value.primitives;
  // Unknown wins over malformed: a newer build's model is kept whole, even
  // where a primitive of a kind this build knows looks wrong to it. Past the
  // caps is a newer build's too, told before any primitive is looked at.
  if (raw.length > STEP_DIAGRAM_MAX_PRIMITIVES || isNewerModel(value, raw)) return UNKNOWN;
  const sheet = readSheet(value.sheet);
  if (!sheet) return MALFORMED;
  const primitives: StepDiagramPrimitive[] = [];
  for (const entry of raw) {
    const primitive = readPrimitive(entry);
    if (!primitive) return MALFORMED;
    primitives.push(primitive);
  }
  return { status: 'ok', model: { sheet, primitives } };
}

/**
 * A model a newer build drew: a field of the model or its sheet, or a
 * primitive's kind, style, enumerated value or field, this build has no name
 * for; or more labels, arrows or points than it places, or a longer label.
 */
function isNewerModel(value: Record<string, unknown>, raw: readonly unknown[]): boolean {
  if (hasOtherKey(value, MODEL_KEYS) || isNewerSheet(value.sheet)) return true;
  const counts = { label: 0, arrow: 0, point: 0 };
  for (const entry of raw) {
    if (isNewerPrimitive(entry)) return true;
    if (!isRecord(entry)) continue;
    if (entry.kind === 'label' || entry.kind === 'point') counts[entry.kind] += 1;
    // Every arrow and glyph is drawn by its shapes: one cap for them all.
    else if (typeof entry.kind === 'string' && ARROW_KINDS.has(entry.kind)) counts.arrow += 1;
  }
  return (
    counts.label > STEP_DIAGRAM_MAX_LABELS ||
    counts.arrow > STEP_DIAGRAM_MAX_ARROWS ||
    counts.point > STEP_DIAGRAM_MAX_POINTS ||
    counts.label * raw.length > STEP_DIAGRAM_MAX_LABEL_WORK
  );
}

/** A model as the file stores it, or null when the reader would refuse it. */
export function storedStepDiagramModel(model: StepDiagramModel): StepDiagramModel | null {
  const read = validateStepDiagramModel(JSON.parse(JSON.stringify(model)) as unknown);
  return read.status === 'ok' ? read.model : null;
}

const MALFORMED: StepDiagramModelRead = { status: 'malformed' };
const UNKNOWN: StepDiagramModelRead = { status: 'unknown' };

/** The fields a model, its sheet, an arc and each kind of primitive are written with. */
const MODEL_KEYS: ReadonlySet<string> = new Set(['sheet', 'primitives']);
const SHEET_KEYS: ReadonlySet<string> = new Set(['width', 'height', 'centre', 'axes']);
const AXES_KEYS: ReadonlySet<string> = new Set(['x', 'y']);
const ARC_KEYS: ReadonlySet<string> = new Set(['center', 'radius', 'from', 'to', 'ccw']);
const PRIMITIVE_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  sheet: new Set(['kind', 'width', 'height']),
  line: new Set(['kind', 'from', 'to', 'style', 'dashPhase']),
  arc: new Set(['kind', ...ARC_KEYS, 'style']),
  'fold-arrow': new Set(['kind', 'out']),
  'one-way-arrow': new Set(['kind', 'out', 'fold']),
  'push-arrow': new Set(['kind', 'from', 'to']),
  rotate: new Set(['kind', 'at', 'amount', 'direction']),
  'turn-over': new Set(['kind', 'at', 'axis']),
  region: new Set(['kind', 'corners']),
  point: new Set(['kind', 'at', 'style']),
  label: new Set(['kind', 'at', 'text', 'style']),
};

function isNewerSheet(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return hasOtherKey(value, SHEET_KEYS) || (isRecord(value.axes) && hasOtherKey(value.axes, AXES_KEYS));
}

function hasOtherKey(value: Record<string, unknown>, known: ReadonlySet<string>): boolean {
  return Object.keys(value).some((key) => !known.has(key));
}

const ARROW_KINDS: ReadonlySet<string> = new Set(['fold-arrow', 'one-way-arrow', 'push-arrow', 'rotate']);

/**
 * A primitive whose `kind`, field, enumerated value, or `style` for a kind
 * that has one, this build does not know; or a label longer than it draws.
 */
function isNewerPrimitive(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (!PRIMITIVE_KINDS.has(value.kind)) return true;
  if (hasOtherKey(value, PRIMITIVE_KEYS[value.kind])) return true;
  const arc = value.kind === 'fold-arrow' || value.kind === 'one-way-arrow' ? value.out : null;
  if (isRecord(arc) && hasOtherKey(arc, ARC_KEYS)) return true;
  if (value.kind === 'label' && typeof value.text === 'string' && value.text.length > STEP_DIAGRAM_MAX_LABEL) return true;
  const enums = PRIMITIVE_ENUMS[value.kind];
  if (enums) {
    for (const [field, values] of Object.entries(enums)) {
      if (typeof value[field] === 'string' && !values.includes(value[field])) return true;
    }
  }
  if (typeof value.style !== 'string') return false;
  switch (value.kind) {
    case 'line':
    case 'arc':
      return !LINE_STYLES.has(value.style);
    case 'point':
    case 'label':
      return !POINT_STYLES.has(value.style);
    default:
      return false;
  }
}

function readSheet(value: unknown): DiagramSheet | null {
  if (!isRecord(value)) return null;
  const width = positive(value.width);
  const height = positive(value.height);
  if (width === null || height === null) return null;
  const sheet: DiagramSheet = { width, height };
  if (value.centre !== undefined) {
    const centre = readPoint(value.centre);
    if (!centre) return null;
    sheet.centre = centre;
  }
  if (value.axes !== undefined) {
    if (!isRecord(value.axes)) return null;
    const x = readPoint(value.axes.x);
    const y = readPoint(value.axes.y);
    if (!x || !y) return null;
    sheet.axes = { x, y };
  }
  return sheet;
}

function readPrimitive(value: unknown): StepDiagramPrimitive | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case 'sheet': {
      const width = positive(value.width);
      const height = positive(value.height);
      return width === null || height === null ? null : { kind: 'sheet', width, height };
    }
    case 'line': {
      const from = readPoint(value.from);
      const to = readPoint(value.to);
      const style = lineStyle(value.style);
      if (!from || !to || !style) return null;
      if (value.dashPhase === undefined) return { kind: 'line', from, to, style };
      const dashPhase = finite(value.dashPhase);
      return dashPhase === null ? null : { kind: 'line', from, to, style, dashPhase };
    }
    case 'arc': {
      const arc = readArc(value);
      const style = lineStyle(value.style);
      return arc && style ? { kind: 'arc', ...arc, style } : null;
    }
    case 'fold-arrow': {
      const out = readArc(value.out);
      return out ? { kind: 'fold-arrow', out } : null;
    }
    case 'one-way-arrow': {
      const out = readArc(value.out);
      const fold = value.fold === 'valley' || value.fold === 'mountain' ? value.fold : null;
      return out && fold ? { kind: 'one-way-arrow', out, fold } : null;
    }
    case 'push-arrow': {
      const from = readPoint(value.from);
      const to = readPoint(value.to);
      return from && to ? { kind: 'push-arrow', from, to } : null;
    }
    case 'rotate': {
      const at = readPoint(value.at);
      const amount =
        value.amount === 'eighth' || value.amount === 'quarter' || value.amount === 'half' ? value.amount : null;
      const direction = value.direction === 'cw' || value.direction === 'ccw' ? value.direction : null;
      return at && amount && direction ? { kind: 'rotate', at, amount, direction } : null;
    }
    case 'turn-over': {
      const at = readPoint(value.at);
      if (!at) return null;
      if (value.axis === undefined) return { kind: 'turn-over', at };
      return value.axis === 'vertical' || value.axis === 'horizontal' ? { kind: 'turn-over', at, axis: value.axis } : null;
    }
    case 'region': {
      if (!Array.isArray(value.corners) || value.corners.length < 3) return null;
      const corners: (readonly [number, number])[] = [];
      for (const corner of value.corners) {
        const point = readPoint(corner);
        if (!point) return null;
        corners.push(point);
      }
      return { kind: 'region', corners };
    }
    case 'point': {
      const at = readPoint(value.at);
      const style = pointStyle(value.style);
      return at && style ? { kind: 'point', at, style } : null;
    }
    case 'label': {
      const at = readPoint(value.at);
      const style = pointStyle(value.style);
      if (!at || !style || typeof value.text !== 'string') return null;
      const text = xmlText(value.text);
      if (text.length === 0 || text.length > STEP_DIAGRAM_MAX_LABEL) return null;
      return { kind: 'label', at, text, style };
    }
    default:
      return null;
  }
}

function readArc(value: unknown): DiagramArc | null {
  if (!isRecord(value)) return null;
  const center = readPoint(value.center);
  const radius = finite(value.radius);
  const from = finite(value.from);
  const to = finite(value.to);
  if (!center || radius === null || radius < 0 || from === null || to === null) return null;
  if (typeof value.ccw !== 'boolean') return null;
  return { center, radius, from, to, ccw: value.ccw };
}

function lineStyle(value: unknown): DiagramLineStyleName | null {
  return typeof value === 'string' && LINE_STYLES.has(value) ? (value as DiagramLineStyleName) : null;
}

function pointStyle(value: unknown): DiagramPointStyleName | null {
  return typeof value === 'string' && POINT_STYLES.has(value) ? (value as DiagramPointStyleName) : null;
}

function readPoint(value: unknown): readonly [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const x = finite(value[0]);
  const y = finite(value[1]);
  return x === null || y === null ? null : [x, y];
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positive(value: unknown): number | null {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
