/**
 * The paper style: one style sheet every surface that draws paper reads — the
 * simulator, the inline simulation windows, the 3D and flat folded figures and
 * the References step diagrams.
 *
 * Pure data plus a normaliser, with no React, store or CP-workspace dependency,
 * so the simulator worker and every surface can import it. The plan is
 * `implementation-plans/unified-paper-style-and-export.md`; §1 and §5 fix the
 * shape, the units and the defaults restated here.
 *
 * Units: a pen width is in **points**, because people finish diagrams in
 * Illustrator and Affinity and the diagramming templates state every line in
 * pt. On screen a pen draws at `pt × 4/3 × dpr` device px, non-scaling with
 * zoom, which is how every surface already draws ({@link ptToDevicePx}). A
 * dash is a list of on/off run lengths in multiples of the pen's width, so a
 * 0.4 pt and a 0.75 pt line both read as "dotted"; the resolver multiplies by
 * the device-px width once. Colours are `#rrggbb`; there is no "follow the
 * theme" value and no background — surfaces render transparent and the app
 * paints its ground beneath them.
 */
import { ORIEDITA_DASH_ONE_DOT, ORIEDITA_DASH_VALLEY } from '../oristudioCpLineStyle';

/** A `#rrggbb` colour, lowercase. */
export type Hex = string;

export type PenCap = 'butt' | 'round';

export interface Pen {
  /** Stroke width in pt. */
  width: number;
  color: Hex;
  /**
   * Alternating on/off run lengths in multiples of {@link width}, or null for
   * solid. `[8, 2, 1, 2]` is the dash-dot mountain, `[4, 2]` the dashed valley,
   * `[1, 2]` dotted.
   */
  dash: number[] | null;
  cap: PenCap;
}

export interface PaperLight {
  enabled: boolean;
  /** Degrees clockwise from straight up in the screen plane. */
  azimuth: number;
  /** Degrees out of the screen toward the eye; 90 is on the view axis. */
  elevation: number;
}

export interface PaperStyle {
  version: 1;
  paper: { front: Hex; back: Hex };
  /** Raw and folded paper edges. */
  edges: Pen;
  /**
   * A fold is a line of a crease pattern: this crease exists and goes this
   * way. Drawn wherever a pattern lies on the style's paper — a simulation
   * drawing its creases by direction, the pattern in References.
   */
  mountainFolds: Pen;
  valleyFolds: Pen;
  /**
   * A diagram crease is the instruction on a step: fold here, this way. Only
   * References steps draw one. "Crease" and "fold" alone are used
   * interchangeably in origami, so the names carry the distinction — the
   * *diagram* crease is the instruction, the fold is the pattern's line.
   */
  mountainDiagramCreases: Pen;
  valleyDiagramCreases: Pen;
  /**
   * Draw every fold with the edge pen: a fold that has happened is an edge of
   * the paper, not an instruction to fold. Read by the simulations, which
   * draw mountain and valley otherwise; a folded figure always draws its
   * folds as edges and a step diagram never does.
   */
  foldsAsEdges: boolean;
  /** Existing / auxiliary creases lying on the surface. */
  auxCreases: { visible: boolean; pen: Pen };
  /** References steps only. */
  arrows: Pen;
  /**
   * Aux creases pulled back from the edge of their face, as a fraction of the
   * sheet; 0 = off. Folds are always drawn to the paper's edge.
   */
  erode: number;
  /** Simulator and 3D figure only; the flat figure is drawn unlit. */
  light: PaperLight;
}

/** CSS px per pt. */
export const PT_TO_CSS_PX = 4 / 3;

/** A pen's on-screen width: `pt × 4/3` CSS px, times the device pixel ratio. */
export function ptToDevicePx(pt: number, dpr: number): number {
  return pt * PT_TO_CSS_PX * dpr;
}

/** The inverse of {@link ptToDevicePx} at dpr 1, for stating a legacy px width in pt. */
export function cssPxToPt(px: number): number {
  return px / PT_TO_CSS_PX;
}

/** The pen widths the UI offers, in pt. */
export const PEN_WIDTH_RANGE = { min: 0.1, max: 12, step: 0.05 } as const;

/** How far a crease may be pulled back, as a fraction of the sheet. */
export const ERODE_RANGE = { min: 0, max: 0.25, step: 0.005 } as const;

/**
 * The erode the Settings slider offers — a tenth of what a style may hold.
 *
 * Erode is a fraction of the *sheet*, so the useful band is tiny: a few
 * percent already pulls a crease clear of its face, and a slider stretched to
 * {@link ERODE_RANGE} spends nine tenths of its travel on settings nobody
 * picks. {@link ERODE_RANGE} stays what a file may carry, so a style saved
 * with more keeps it.
 */
export const ERODE_SLIDER_RANGE = { min: 0, max: 0.04, step: 0.0025 } as const;

/**
 * Fixed origami-convention crease inks, deliberately not theme tokens: mountain
 * and valley have to stay high-contrast and recognisable in either theme.
 */
export const DEFAULT_MOUNTAIN_COLOR: Hex = '#db1f24';
export const DEFAULT_VALLEY_COLOR: Hex = '#1c5cd9';

/** Oriedita's folded-figure paper and line colours (`Colors.FIGURE_FRONT` / `FIGURE_BACK`, black). */
export const ORIEDITA_PAPER_FRONT: Hex = '#ffff32';
export const ORIEDITA_PAPER_BACK: Hex = '#e9e9e9';
export const ORIEDITA_LINE_COLOR: Hex = '#000000';

/**
 * The light every surface used before there was a style: the simulator's
 * `normalize([-0.45, 0.58, 0.68])` in view space, stated as the angles
 * `lightVector` reads. A test pins the round trip to 1e-6.
 */
export const DEFAULT_LIGHT_AZIMUTH = 322.19347;
export const DEFAULT_LIGHT_ELEVATION = 42.80915;

/**
 * The mountain and valley dashes a printed diagram draws — the Diagram
 * preset's, from the Origami House template: dash-dot 8:2:1:2 and dashed 4:2,
 * as multiples of the pen's width.
 */
export const DIAGRAM_MOUNTAIN_DASH: readonly number[] = [8, 2, 1, 2];
export const DIAGRAM_VALLEY_DASH: readonly number[] = [4, 2];

/**
 * The Default preset: Oriedita's paper, the folded figure's 1.2 px edge, the
 * simulator's 1.1 px crease inks and its light, and a simulation drawing every
 * fold as an edge, as a folded figure does. A crease pattern's folds are
 * solid, told apart by colour, as a crease pattern is drawn; a step's diagram
 * creases are the same inks dashed, valley and dash-dot mountain, as a diagram
 * draws the fold it asks for.
 */
export const DEFAULT_PAPER_STYLE: PaperStyle = {
  version: 1,
  paper: { front: ORIEDITA_PAPER_FRONT, back: ORIEDITA_PAPER_BACK },
  edges: { width: 0.9, color: ORIEDITA_LINE_COLOR, dash: null, cap: 'butt' },
  mountainFolds: { width: 0.825, color: DEFAULT_MOUNTAIN_COLOR, dash: null, cap: 'butt' },
  valleyFolds: { width: 0.825, color: DEFAULT_VALLEY_COLOR, dash: null, cap: 'butt' },
  mountainDiagramCreases: {
    width: 0.825,
    color: DEFAULT_MOUNTAIN_COLOR,
    dash: [...DIAGRAM_MOUNTAIN_DASH],
    cap: 'butt',
  },
  valleyDiagramCreases: {
    width: 0.825,
    color: DEFAULT_VALLEY_COLOR,
    dash: [...DIAGRAM_VALLEY_DASH],
    cap: 'butt',
  },
  foldsAsEdges: true,
  // Shown by default: a diagram draws the creases already made, and a folded
  // figure's construction lines are what the pen is for. Oriedita's preset
  // turns them off, as its own folded figure never draws them.
  auxCreases: {
    visible: true,
    pen: { width: 0.5, color: '#9aa4ad', dash: null, cap: 'butt' },
  },
  arrows: { width: 1.05, color: '#000000', dash: null, cap: 'round' },
  erode: 0,
  light: { enabled: true, azimuth: DEFAULT_LIGHT_AZIMUTH, elevation: DEFAULT_LIGHT_ELEVATION },
};

/**
 * The addressable fields of a style. A pen is overridden whole; the two paper
 * colours and the aux toggle are addressed on their own because a user pins one
 * of them without the other.
 */
export interface PaperStyleFieldValues {
  'paper.front': Hex;
  'paper.back': Hex;
  edges: Pen;
  mountainFolds: Pen;
  valleyFolds: Pen;
  mountainDiagramCreases: Pen;
  valleyDiagramCreases: Pen;
  foldsAsEdges: boolean;
  'auxCreases.visible': boolean;
  'auxCreases.pen': Pen;
  arrows: Pen;
  erode: number;
  light: PaperLight;
}

export type PaperStyleField = keyof PaperStyleFieldValues;
export type PaperStyleValue<F extends PaperStyleField> = PaperStyleFieldValues[F];

export const PAPER_STYLE_FIELDS: readonly PaperStyleField[] = [
  'paper.front',
  'paper.back',
  'edges',
  'mountainFolds',
  'valleyFolds',
  'mountainDiagramCreases',
  'valleyDiagramCreases',
  'foldsAsEdges',
  'auxCreases.visible',
  'auxCreases.pen',
  'arrows',
  'erode',
  'light',
];

export function isPaperStyleField(value: unknown): value is PaperStyleField {
  return typeof value === 'string' && (PAPER_STYLE_FIELDS as readonly string[]).includes(value);
}

/**
 * A sparse record of the fields an object overrides — what a folded figure or
 * an inline simulation carries in `.osf` as its `appearance`. Everything not
 * here follows the app style.
 */
export type PaperStyleOverrides = Partial<{ [F in PaperStyleField]: PaperStyleValue<F> }>;

export function getPaperStyleField<F extends PaperStyleField>(
  style: PaperStyle,
  field: F
): PaperStyleValue<F> {
  switch (field) {
    case 'paper.front':
      return style.paper.front as PaperStyleValue<F>;
    case 'paper.back':
      return style.paper.back as PaperStyleValue<F>;
    case 'auxCreases.visible':
      return style.auxCreases.visible as PaperStyleValue<F>;
    case 'auxCreases.pen':
      return style.auxCreases.pen as PaperStyleValue<F>;
    default:
      return style[field as Exclude<F, `${string}.${string}`>] as unknown as PaperStyleValue<F>;
  }
}

/** A copy of `style` with one field replaced. The input is not mutated. */
export function setPaperStyleField<F extends PaperStyleField>(
  style: PaperStyle,
  field: F,
  value: PaperStyleValue<F>
): PaperStyle {
  switch (field) {
    case 'paper.front':
      return { ...style, paper: { ...style.paper, front: value as Hex } };
    case 'paper.back':
      return { ...style, paper: { ...style.paper, back: value as Hex } };
    case 'auxCreases.visible':
      return { ...style, auxCreases: { ...style.auxCreases, visible: value as boolean } };
    case 'auxCreases.pen':
      return { ...style, auxCreases: { ...style.auxCreases, pen: value as Pen } };
    default:
      return { ...style, [field]: value };
  }
}

/** The one merge: an app style with an object's overrides applied on top. */
export function effectivePaperStyle(base: PaperStyle, overrides?: PaperStyleOverrides): PaperStyle {
  if (!overrides) return base;
  let style = base;
  for (const field of PAPER_STYLE_FIELDS) {
    const value = overrides[field];
    if (value === undefined) continue;
    style = setPaperStyleField(style, field, value as PaperStyleValue<typeof field>);
  }
  return style;
}

/**
 * Six-digit hex, the one form every consumer can rely on: `input type="color"`
 * only ever produces it and the SVG painter writes it. Case is folded to
 * lowercase so a hand-written preset's `#FFFFFF` is the same colour as the
 * picker's `#ffffff`; any other spelling is rejected.
 */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function parseHex(value: unknown): Hex | undefined {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : undefined;
}

export function isPenCap(value: unknown): value is PenCap {
  return value === 'butt' || value === 'round';
}

/**
 * A dash is a list of finite, non-negative run lengths with at least one
 * positive run; anything else is not a dash. An empty list is solid, as SVG
 * reads `stroke-dasharray: none`.
 */
export function parseDash(value: unknown): number[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  if (value.length === 0) return null;
  const runs: number[] = [];
  for (const run of value) {
    if (typeof run !== 'number' || !Number.isFinite(run) || run < 0) return undefined;
    runs.push(run);
  }
  return runs.some((run) => run > 0) ? runs : undefined;
}

function parseWidth(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(PEN_WIDTH_RANGE.max, Math.max(PEN_WIDTH_RANGE.min, value));
}

/**
 * A pen from untrusted data. Width and colour are required; a missing dash is
 * solid and a missing cap is butt, so a hand-written preset can state a pen as
 * `{ width, color }` — but a dash or cap that is present and malformed rejects
 * the pen, because guessing what the author meant is how an export silently
 * comes out wrong.
 */
export function parsePen(value: unknown): Pen | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const width = parseWidth(raw.width);
  const color = parseHex(raw.color);
  const dash = raw.dash === undefined ? null : parseDash(raw.dash);
  const cap = raw.cap === undefined ? 'butt' : isPenCap(raw.cap) ? raw.cap : undefined;
  if (width === undefined || color === undefined || dash === undefined || cap === undefined) {
    return undefined;
  }
  return { width, color, dash, cap };
}

function parseErode(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(ERODE_RANGE.max, Math.max(ERODE_RANGE.min, value));
}

/** Wrap an angle into [0, 360), the range a stored azimuth keeps. */
export function wrapDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function parseLight(value: unknown): PaperLight | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const { enabled, azimuth, elevation } = raw;
  if (typeof enabled !== 'boolean') return undefined;
  if (typeof azimuth !== 'number' || !Number.isFinite(azimuth)) return undefined;
  if (typeof elevation !== 'number' || !Number.isFinite(elevation)) return undefined;
  return {
    enabled,
    azimuth: wrapDegrees(azimuth),
    elevation: Math.min(90, Math.max(-90, elevation)),
  };
}

/**
 * One field's value from untrusted data, or undefined when it is malformed.
 * The overrides normaliser drops such a field; the style normaliser falls back
 * to the default for it.
 */
export function parsePaperStyleField<F extends PaperStyleField>(
  field: F,
  value: unknown
): PaperStyleValue<F> | undefined {
  switch (field) {
    case 'paper.front':
    case 'paper.back':
      return parseHex(value) as PaperStyleValue<F> | undefined;
    case 'edges':
    case 'mountainFolds':
    case 'valleyFolds':
    case 'mountainDiagramCreases':
    case 'valleyDiagramCreases':
    case 'auxCreases.pen':
    case 'arrows':
      return parsePen(value) as PaperStyleValue<F> | undefined;
    case 'auxCreases.visible':
    case 'foldsAsEdges':
      return (typeof value === 'boolean' ? value : undefined) as PaperStyleValue<F> | undefined;
    case 'erode':
      return parseErode(value) as PaperStyleValue<F> | undefined;
    case 'light':
      return parseLight(value) as PaperStyleValue<F> | undefined;
    default:
      return undefined;
  }
}

/** Read a field out of a style-shaped object without trusting its shape. */
function rawField(source: Record<string, unknown>, field: PaperStyleField): unknown {
  switch (field) {
    case 'paper.front':
    case 'paper.back': {
      const paper = source.paper;
      if (!paper || typeof paper !== 'object') return undefined;
      return (paper as Record<string, unknown>)[field === 'paper.front' ? 'front' : 'back'];
    }
    case 'auxCreases.visible':
    case 'auxCreases.pen': {
      const aux = source.auxCreases;
      if (!aux || typeof aux !== 'object') return undefined;
      return (aux as Record<string, unknown>)[field === 'auxCreases.visible' ? 'visible' : 'pen'];
    }
    default:
      return source[field];
  }
}

/**
 * Normalise an untrusted (persisted, imported) style into a complete one. Each
 * field that is missing or malformed takes its default, so a preset written for
 * a later schema still applies what it can, and a corrupt value never reaches
 * a renderer.
 */
export function normalizePaperStyle(source: unknown): PaperStyle {
  if (!source || typeof source !== 'object') return DEFAULT_PAPER_STYLE;
  const raw = source as Record<string, unknown>;
  let style = DEFAULT_PAPER_STYLE;
  for (const field of PAPER_STYLE_FIELDS) {
    const value = parsePaperStyleField(field, rawField(raw, field));
    if (value !== undefined) style = setPaperStyleField(style, field, value);
  }
  return style;
}

/**
 * Normalise an untrusted overrides record: unknown keys and malformed values
 * are dropped, never defaulted — an override that is not there means "follow
 * the app style", which is the safe reading of a value we cannot use.
 */
export function normalizePaperStyleOverrides(source: unknown): PaperStyleOverrides {
  const overrides: PaperStyleOverrides = {};
  if (!source || typeof source !== 'object') return overrides;
  const raw = source as Record<string, unknown>;
  for (const field of PAPER_STYLE_FIELDS) {
    if (!(field in raw)) continue;
    const value = parsePaperStyleField(field, raw[field]);
    if (value !== undefined) assignOverride(overrides, field, value);
  }
  return overrides;
}

function assignOverride<F extends PaperStyleField>(
  overrides: PaperStyleOverrides,
  field: F,
  value: PaperStyleValue<F>
): void {
  (overrides as Record<F, PaperStyleValue<F>>)[field] = value;
}

/** True when no field is overridden, so the record can be left off a file. */
export function hasPaperStyleOverrides(overrides: PaperStyleOverrides | undefined): boolean {
  return !!overrides && PAPER_STYLE_FIELDS.some((field) => overrides[field] !== undefined);
}

/** Structural equality over a field's value: a hex, a number, a boolean, a pen or a light. */
export function paperStyleValueEquals(
  a: PaperStyleValue<PaperStyleField> | undefined,
  b: PaperStyleValue<PaperStyleField> | undefined
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const left: Record<string, unknown> = { ...a };
  const right: Record<string, unknown> = { ...b };
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => {
    const x = left[key];
    const y = right[key];
    if (Array.isArray(x) || Array.isArray(y)) return dashEquals(x as number[] | null, y as number[] | null);
    return x === y;
  });
}

/** Structural equality over every field of two styles. */
export function paperStyleEquals(a: PaperStyle, b: PaperStyle): boolean {
  return PAPER_STYLE_FIELDS.every((field) =>
    paperStyleValueEquals(getPaperStyleField(a, field), getPaperStyleField(b, field))
  );
}

/**
 * An object's overrides with one field pinned, or cleared with `undefined`.
 * The input is not mutated; the *same* record comes back when nothing would
 * change, so a store can skip the write, and `undefined` comes back when the
 * last override goes, so the field can be left off a file.
 */
export function withPaperStyleOverride<F extends PaperStyleField>(
  overrides: PaperStyleOverrides | undefined,
  field: F,
  value: PaperStyleValue<F> | undefined
): PaperStyleOverrides | undefined {
  if (paperStyleValueEquals(overrides?.[field], value)) return overrides;
  const next: PaperStyleOverrides = { ...overrides };
  if (value === undefined) delete next[field];
  else assignOverride(next, field, value);
  return hasPaperStyleOverrides(next) ? next : undefined;
}

/**
 * How the mountain and valley pens stand against the edge pen.
 *
 * `color` is the convention inks, solid; `mono` is the edge pen's colour,
 * solid; `mono-dashed` the edge pen's colour with Oriedita's CP dashes — and
 * anything else is `custom`. Width and cap are not part of the answer. What
 * reads it: a new edge ink keeps `mono` folds on it (`edgeInkEdits`), and a
 * saved simulator setting from before the paper style migrates through it.
 */
export type PaperCreaseStyle = 'color' | 'mono' | 'mono-dashed' | 'custom';

/** The CSS-px crease width Oriedita draws its dash patterns at. */
const ORIEDITA_CREASE_PX = DEFAULT_PAPER_STYLE.mountainFolds.width * PT_TO_CSS_PX;

/**
 * Oriedita's CP dashes as this schema states a dash: fixed multiples of the
 * pen's width. Oriedita's patterns are device px at its 1.1 px crease, so the
 * multiples are those runs over 1.1 — at the default 0.825 pt (1.1 px) fold
 * pen they resolve to exactly `[10, 3, 3, 3]` and `[8, 8]` on a standard
 * display, and a heavier pen dashes proportionally longer. They are constants,
 * not a quotient of whatever width the pen has when the mode is applied: the
 * mode is *defined* by them, so a weight change afterwards leaves the dash
 * alone and the pens still read `mono-dashed` (§5).
 */
export const ORIEDITA_MOUNTAIN_DASH_MULTIPLES: readonly number[] = ORIEDITA_DASH_ONE_DOT.map(
  (run) => run / ORIEDITA_CREASE_PX
);
export const ORIEDITA_VALLEY_DASH_MULTIPLES: readonly number[] = ORIEDITA_DASH_VALLEY.map(
  (run) => run / ORIEDITA_CREASE_PX
);

/**
 * Two dashes are the same within a millionth of a pen width: a preset typed
 * or written to six decimals still reads as its mode, and no renderer can
 * draw a smaller difference.
 */
const DASH_RUN_TOLERANCE = 1e-6;

/**
 * Whether two dashes are the same pattern. Exported because the named dashes
 * the Settings field offers are recognised the same way {@link creaseStyleOf}
 * recognises its modes — one tolerance, so a dash reads the same wherever it
 * is matched.
 */
export function dashEquals(a: readonly number[] | null, b: readonly number[] | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.length === b.length &&
    a.every((run, i) => Math.abs(run - (b[i] ?? Number.NaN)) < DASH_RUN_TOLERANCE)
  );
}

export function creaseStyleOf(style: PaperStyle): PaperCreaseStyle {
  const { mountainFolds: mountain, valleyFolds: valley, edges } = style;
  if (
    mountain.color === DEFAULT_MOUNTAIN_COLOR &&
    valley.color === DEFAULT_VALLEY_COLOR &&
    mountain.dash === null &&
    valley.dash === null
  ) {
    return 'color';
  }
  if (mountain.color !== edges.color || valley.color !== edges.color) return 'custom';
  if (mountain.dash === null && valley.dash === null) return 'mono';
  if (
    dashEquals(mountain.dash, ORIEDITA_MOUNTAIN_DASH_MULTIPLES) &&
    dashEquals(valley.dash, ORIEDITA_VALLEY_DASH_MULTIPLES)
  ) {
    return 'mono-dashed';
  }
  return 'custom';
}

/** Write the mountain and valley pens for a mode; see {@link creaseStyleOf}. */
export function applyCreaseStyle(
  style: PaperStyle,
  mode: Exclude<PaperCreaseStyle, 'custom'>
): PaperStyle {
  const { mountainFolds: mountain, valleyFolds: valley, edges } = style;
  switch (mode) {
    case 'color':
      return {
        ...style,
        mountainFolds: { ...mountain, color: DEFAULT_MOUNTAIN_COLOR, dash: null },
        valleyFolds: { ...valley, color: DEFAULT_VALLEY_COLOR, dash: null },
      };
    case 'mono':
      return {
        ...style,
        mountainFolds: { ...mountain, color: edges.color, dash: null },
        valleyFolds: { ...valley, color: edges.color, dash: null },
      };
    case 'mono-dashed':
      return {
        ...style,
        mountainFolds: {
          ...mountain,
          color: edges.color,
          dash: [...ORIEDITA_MOUNTAIN_DASH_MULTIPLES],
        },
        valleyFolds: {
          ...valley,
          color: edges.color,
          dash: [...ORIEDITA_VALLEY_DASH_MULTIPLES],
        },
      };
  }
}
