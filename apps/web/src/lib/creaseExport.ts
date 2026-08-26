import type { FoldDocument } from '../engine/types';
import {
  buildSegmentFold,
  flatPlaneAxes,
  type CpSegment,
} from './creasePatternSegmentation';
import { escapeXml } from './xmlEscape';
import { foldedFigureSvgBody, projectedFoldedFigureBounds } from './foldedFigureSvg';
import {
  applyCpModelToFold,
  cpModelToFoldTransform,
  IDENTITY_CP_MODEL_TO_FOLD,
  isClassicFoldAngle,
  type CpModelToFoldTransform,
} from './creaseExportFold';
// The fold-angle encoding is the canvas's, not a second one written in hex: see
// `foldAngleRamp`'s own tests, which pin each mode to a single channel. The
// import direction (`lib/` -> `cp-workspace/`) follows `nativeProjectFile.ts`.
import { foldAngleInk } from '../cp-workspace/foldAngle/foldAngleRamp';
import { parseCssColor } from '../cp-workspace/renderer/cssColor';
import type { Rgba } from '../cp-workspace/renderer/types';
import { degreesToFoldMagnitude } from './foldAngle';
import { rgbColorToHex } from './rgbColor';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpGridMetadata,
} from '../engine/oristudioCpTypes';
import type { Point } from './geometry';
import type { FoldedFigureSide } from './foldedFigureSides';
import {
  DEFAULT_ORISTUDIO_CP_FOLD_ANGLE_DISPLAY,
  DEFAULT_ORISTUDIO_CP_LINE_STYLE,
  DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
  expandedModelBoundsFromPoints,
  orieditaGridLinesForModelBounds,
  visibleOrieditaGridMetadata,
  type OristudioCpFoldAngleDisplay,
  type OristudioCpLineStyle,
} from './creasePatternViewport';
import { alternateDashRuns, cpLineStyleDashPattern, cpLineStyleInk } from './oristudioCpLineStyle';

/** Side of the square content box the crease pattern is drawn into. */
const CP_SIZE = 1024;
const MARGIN = 48;
// Export viewBox (1024) is larger than the editable canvas viewBox (~720); scale
// stroke widths / point radii so exports look like the live crease-pattern view.
const VIEW_SCALE = CP_SIZE / 720;

/**
 * Grid stroke width, in the same page units as the crease strokes.
 *
 * `0.95` is the canvas grid's own CSS width (see `reglRenderer`'s
 * `GRID_WIDTH_CSS`), scaled into the export's larger box. Fixed rather than
 * derived from the chosen line width, because it is fixed on the canvas too:
 * the grid is a backdrop, and thickening it with the creases would let it
 * compete with them.
 */
const GRID_STROKE_WIDTH = 0.95 * VIEW_SCALE;
/** One crease pattern per exported page, so a fixed id stays unique. */
const GRID_CLIP_ID = 'cp-export-grid-clip';

// Caption typography, in the same user units as the content box.
const TITLE_FONT_SIZE = 52;
const SUBTITLE_FONT_SIZE = 30;
const DESCRIPTION_FONT_SIZE = 22;
const TITLE_LINE_HEIGHT = 1.24;
const SUBTITLE_LINE_HEIGHT = 1.3;
const DESCRIPTION_LINE_HEIGHT = 1.5;
/** Outer padding above the title / below the description. */
const CAPTION_PADDING = 56;
/** Title → subtitle. */
const CAPTION_GAP = 12;
/**
 * Caption block → artwork. The crease pattern is drawn inside a margin of its
 * own, which counts toward this gap (see {@link CreaseExportInset}), so the
 * value is the *total* space a reader sees, not an extra band on top of it.
 */
const CONTENT_GAP = 72;
/** Floor for that gap once the artwork's own inset is taken off it. */
const MIN_CONTENT_GAP = 8;
/** Fraction of the font size used as the first-line baseline offset. */
const BASELINE_RATIO = 0.82;

// Exports rasterize through <img> → canvas, which cannot load webfonts, so the
// caption is drawn in whatever the viewing system already has.
const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
/**
 * Average glyph advance as a fraction of the font size for the stack above.
 * Text wrapping needs a width measurement, and the two places that could give a
 * real one — `canvas.measureText` and DOM layout — are unavailable in the unit
 * test environment and would make the renderer non-deterministic. An estimate
 * can wrap a word early or late; it cannot produce a different file on two runs.
 */
const AVERAGE_GLYPH_RATIO = 0.52;

export type CreaseExportFormat = 'svg' | 'png';

/** Light or dark rendering of the exported image. */
export type CreaseExportTheme = 'light' | 'dark';

/**
 * How the folded figure is folded and painted. These go to the kernel as a
 * folded-figure model, so changing any of them means re-folding.
 */
export interface CreaseExportFoldedFigureSettings {
  /** Which surface the figure shows. Front and back are the offered views. */
  side: FoldedFigureSide;
  /** Front / back paper colours, as `#rrggbb`. */
  frontColor: string;
  backColor: string;
  /** 1-based layer-ordering solution to show. */
  foldCase: number;
}

export const DEFAULT_CREASE_EXPORT_FOLDED_FIGURE: CreaseExportFoldedFigureSettings = {
  side: 'Front0',
  // The kernel's own FoldedFigureModel defaults.
  frontColor: '#ffff32',
  backColor: '#e9e9e9',
  foldCase: 1,
};

/** Optional text drawn into the exported image. Empty strings draw nothing. */
export interface CreaseExportCaption {
  title: string;
  subtitle: string;
  description: string;
}

/** Which crease pattern to export: a specific segment, or all of them. */
export interface CreaseExportOptions {
  /** Segment id to export, or null for the whole document (all patterns). */
  segmentId: number | null;
  lineStyle: OristudioCpLineStyle;
  /**
   * Which channel carries a non-180 fold angle, exactly as the View panel's own
   * dropdown chooses it for the canvas. Does nothing for a pattern whose creases
   * are all full folds, which is why the dialogs hide the control there — see
   * `hasNonClassicCreases`.
   */
  foldAngleDisplay: OristudioCpFoldAngleDisplay;
  lineWidth: number;
  pointSize: number;
  includeUnassigned: boolean;
  showBackgroundColor: boolean;
  /**
   * Draw the document's grid under the crease pattern. Needs a grid to draw —
   * see {@link CreaseExportGridSource}; without one this option does nothing and
   * the dialogs disable it.
   */
  showGrid: boolean;
  theme: CreaseExportTheme;
  /**
   * Draw the folded figure beside the crease pattern. Only meaningful for a
   * single pattern with an editable crease-pattern document loaded; the dialog
   * gates it and resolves the folded snapshot alongside these options.
   */
  includeFoldedFigure: boolean;
  foldedFigure: CreaseExportFoldedFigureSettings;
  caption: CreaseExportCaption;
}

export const EMPTY_CREASE_EXPORT_CAPTION: CreaseExportCaption = {
  title: '',
  subtitle: '',
  description: '',
};

export const DEFAULT_CREASE_EXPORT_OPTIONS: CreaseExportOptions = {
  segmentId: null,
  lineStyle: DEFAULT_ORISTUDIO_CP_LINE_STYLE,
  foldAngleDisplay: DEFAULT_ORISTUDIO_CP_FOLD_ANGLE_DISPLAY,
  lineWidth: DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
  // Points are off by default for exports (they add visual noise to a CP image).
  pointSize: 0,
  includeUnassigned: true,
  showBackgroundColor: true,
  // The grid is a reading aid for tessellations and box pleating, not part of
  // the pattern, so it is opt-in.
  showGrid: false,
  // Exports default to light whatever the app theme is: a light crease pattern
  // is what prints, embeds, and reads as a crease pattern everywhere else.
  theme: 'light',
  includeFoldedFigure: false,
  foldedFigure: DEFAULT_CREASE_EXPORT_FOLDED_FIGURE,
  caption: EMPTY_CREASE_EXPORT_CAPTION,
};

/** Every colour the exported image can draw with. */
export interface CreaseExportPalette {
  /** Page background. */
  canvas: string;
  /** Facet fill behind the creases. */
  paper: string;
  mountain: string;
  valley: string;
  border: string;
  flat: string;
  unassigned: string;
  point: string;
  /**
   * Grid line. One weight for the whole lattice — the canvas draws its interval
   * lines heavier, but at export size that reads as a crease rather than as
   * ruling, which is the one thing the grid must not do.
   */
  grid: string;
  /**
   * Hue a shallower crease shifts toward under the `color` fold-angle mode.
   *
   * The same value in both themes, which is not an oversight: `--fold-angle-anchor`
   * is defined once at `:root` in `theme.css` with no per-theme override, so a
   * single anchor here is the faithful transcription of the canvas rather than a
   * shortcut. See `cp-workspace/foldAngle/foldAngleRamp.ts` for why magenta.
   */
  foldAngleAnchor: string;
  /** The "black" of the monochrome line styles. */
  monochromeInk: string;
  /** Its muted counterpart (the black-and-white style's valley). */
  monochromeValley: string;
  title: string;
  subtitle: string;
  description: string;
}

export const CREASE_EXPORT_PALETTES: Record<CreaseExportTheme, CreaseExportPalette> = {
  // Light matches the live crease-pattern view (theme --fold-* tokens).
  light: {
    canvas: '#ffffff',
    paper: '#f8f5ec',
    mountain: '#ff4d5d',
    valley: '#60a5fa',
    border: '#111417',
    flat: '#64c8c8',
    unassigned: '#9aa4ad',
    point: '#111417',
    // Light enough to read as ruling on the cream paper rather than as an
    // unassigned crease, which is the nearest thing to it on the page.
    grid: '#ccd3da',
    foldAngleAnchor: '#d946ef',
    monochromeInk: '#000000',
    monochromeValley: '#a2a2a2',
    title: '#111417',
    subtitle: '#4a5560',
    description: '#3b444d',
  },
  // Dark is not an inversion: mountain/valley keep their identity but gain
  // luminance, and the monochrome styles' ink flips light — black creases on a
  // dark canvas would be invisible.
  dark: {
    canvas: '#101317',
    paper: '#1d2229',
    mountain: '#ff7a86',
    valley: '#7cb6ff',
    border: '#e8edf2',
    flat: '#5fd4d4',
    unassigned: '#7c8894',
    point: '#e8edf2',
    grid: '#333c46',
    foldAngleAnchor: '#d946ef',
    monochromeInk: '#f2f4f7',
    monochromeValley: '#8b949e',
    title: '#f2f5f8',
    subtitle: '#aab4be',
    description: '#c3ccd5',
  },
};

export function creaseExportPalette(theme: CreaseExportTheme): CreaseExportPalette {
  return CREASE_EXPORT_PALETTES[theme] ?? CREASE_EXPORT_PALETTES.light;
}

function assignmentColor(assignment: string, palette: CreaseExportPalette): string {
  switch (assignment) {
    case 'M':
      return palette.mountain;
    case 'V':
      return palette.valley;
    case 'B':
      return palette.border;
    case 'F':
      return palette.flat;
    default:
      return palette.unassigned;
  }
}

function isUnassigned(assignment: string): boolean {
  return assignment === 'F' || assignment === 'U' || assignment === 'C' || assignment === 'J';
}

interface EdgeAppearance {
  stroke: string;
  /**
   * 1 for every classic crease, and under the `color` fold-angle mode. Only the
   * `opacity` mode produces anything else, and it is emitted as SVG
   * `stroke-opacity` rather than blended into {@link stroke} — creases draw over
   * the facet fill, the grid, and whatever a reference image left behind, so a
   * colour pre-mixed with the page paints the wrong colour over all of them.
   */
  strokeOpacity: number;
  dash: string;
  /**
   * The direction half of a hinted crease: a second stroke over the same line,
   * taking the alternate marks of its dash. `null` when there is nothing to say.
   */
  hint: { stroke: string; dash: string } | null;
}

/**
 * The Oriedita `LineColor` a FOLD edge assignment stands for, so the export
 * resolves line style through the same ported rules the canvas does. `F` is how
 * an auxiliary (`CYAN_3`) crease round-trips through FOLD.
 */
function edgeLineColor(assignment: string): string {
  switch (assignment) {
    case 'M':
      return 'Red1';
    case 'V':
      return 'Blue2';
    case 'B':
      return 'Black0';
    case 'F':
      return 'Cyan3';
    default:
      return 'None';
  }
}

/**
 * `|ρ|` in kernel magnitude units for a crease that is not a full fold, or
 * `null` for anything the fold-angle encoding must leave alone.
 *
 * Three rules, each of which is a bug if dropped:
 *
 * - **Only `M` and `V` are creases.** `B` and `F` carry a fold angle of `0` by
 *   construction (`defaultFoldAngle`, and the kernel writes 0 for borders), so
 *   reading the angle alone would fade every sheet outline in the document to
 *   the opacity floor.
 * - **An absent angle is classic**, matching `foldAngleFromParts`, which reads an
 *   absent magnitude as a full ±180 fold.
 * - **±180 needs an epsilon.** A classic crease reaches FOLD through the kernel's
 *   unit conversion and can arrive as `179.9999999`; see
 *   {@link isClassicFoldAngle}.
 */
function nonClassicMagnitudeUnits(
  assignment: string,
  angle: number | null | undefined
): number | null {
  if (assignment !== 'M' && assignment !== 'V') return null;
  if (typeof angle !== 'number' || !Number.isFinite(angle)) return null;
  if (isClassicFoldAngle(angle)) return null;
  // Clamped rather than rejected: a hand-written file can carry |ρ| > 180, and a
  // full fold is the safe reading of it. `degreesToFoldMagnitude` returns null
  // outside 0..180, which would silently skip the crease instead.
  return degreesToFoldMagnitude(Math.min(180, Math.abs(angle)));
}

/**
 * Resolve one edge's stroke, dash and opacity — the line-style table first, then
 * the fold-angle encoding on top of whatever ink it produced.
 *
 * Built once per artwork rather than called as a free function, so the palette
 * colours are parsed into {@link Rgba} once instead of once per crease. The
 * dialog rebuilds the whole artwork on every slider drag.
 *
 * The line-style half is the ported table (see lib/oristudioCpLineStyle),
 * rendered with the export palette: its monochrome ink and grey stand in for
 * Oriedita's black and GREY_10 so a dark export stays legible. The fold-angle
 * half is {@link foldAngleInk}, the canvas's own encoder — so the two surfaces
 * cannot drift. What differs is the starting ink: the export runs the same
 * construction over its own palette, so an exported 90° mountain is not
 * pixel-equal to the canvas's.
 */
function edgeAppearances(
  lineStyle: OristudioCpLineStyle,
  display: OristudioCpFoldAngleDisplay,
  palette: CreaseExportPalette
): (
  assignment: string,
  angle: number | null | undefined,
  /** 0 none, 1 mountain, 2 valley — `oristudio:edges_fold_direction_hint`. */
  directionHint?: number
) => EdgeAppearance {
  const anchor = parseCssColor(palette.foldAngleAnchor);
  const parsed = new Map<string, Rgba | null>();
  const toRgba = (hex: string): Rgba | null => {
    const cached = parsed.get(hex);
    if (cached !== undefined) return cached;
    const rgba = parseCssColor(hex);
    parsed.set(hex, rgba);
    return rgba;
  };
  /** The fold-angle encoding on an ink the line-style table has already chosen. */
  const encode = (
    ink: string,
    magnitude: number | null
  ): Pick<EdgeAppearance, 'stroke' | 'strokeOpacity'> => {
    const base = magnitude === null ? null : toRgba(ink);
    if (magnitude === null || base === null || anchor === null) {
      return { stroke: ink, strokeOpacity: 1 };
    }
    const encoded = foldAngleInk(base, magnitude, { display, anchor });
    return {
      stroke: rgbColorToHex({
        red: encoded[0] * 255,
        green: encoded[1] * 255,
        blue: encoded[2] * 255,
      }),
      strokeOpacity: encoded[3],
    };
  };

  return (assignment, angle, directionHint = 0) => {
    const lineColor = edgeLineColor(assignment);
    const ink = styleInk(assignment, lineColor, lineStyle, palette);
    const pattern = cpLineStyleDashPattern(lineStyle, lineColor);
    const base = {
      ...encode(ink, nonClassicMagnitudeUnits(assignment, angle)),
      dash: pattern ? scaleDash(pattern) : '',
    };
    // A hinted crease keeps the undecided grey and dash and takes the alternate
    // marks of that dash in its direction's own full-strength colour — the canvas
    // treatment exactly, and now through the same run list, since
    // `alternateDashRuns` needs no phase for either consumer. A hint is visible
    // state rather than a working note, so it belongs in the picture.
    //
    // The two are not the same picture, and cannot be. They agree on *whether* a
    // hint shows — both ink the crease's own first mark, at distance 0, which is
    // the property that used to fail here — and disagree on how many marks it
    // shows. That is a rate, and there is no zoom at which the rates meet, in
    // either direction:
    //
    // - The canvas's geometry goes through one fixed affine (`cpModelToSvg`, the
    //   400-unit paper across `CP_PAPER_RECT`'s 588 user units) and its dash is in
    //   screen px, so its rate follows the *camera*.
    // - The export fits the drawn document's **bounding box** into
    //   `CP_SIZE - 2 * MARGIN` = 928 and scales the dash by the fixed `VIEW_SCALE`,
    //   so its rate follows the *document*. A pattern drawn across a quarter of
    //   the paper is blown up 4x to fill the page, so its creases carry four
    //   times the marks the canvas gives them at the fit view, where a
    //   paper-filling one carries about the same — and even that one is 10% off,
    //   its geometry landing at 928/588 = 1.578 page units per canvas user unit
    //   against the dash's 1.422.
    //
    // Left that way deliberately, and it is a real divergence from upstream:
    // Oriedita's `SvgExporter` puts every line through `camera.object2TV` and
    // writes its dash arrays as literal user units, so it exports *the view* and
    // its dash keeps exactly the relation to the geometry the screen had. Ours
    // exports the *document* — bounding box fitted to a fixed square page — so
    // that one file gives one picture wherever the user happened to be scrolled,
    // and the price of that is a dash rate the camera no longer sets. Tying the
    // dash to the projector would only move the dependency: a single segment
    // exported alone, blown up to fill the page, would get marks as long as its
    // creases. The property that has to hold is the first mark, and that is
    // pinned in `creaseExport.test.ts`.
    //
    // The `stroke` comparison is the canvas's rule too: under the black-dot styles
    // the direction resolves to the ink the crease already has, so the overlay
    // would repaint it in its own colour and say nothing. It compares the ink the
    // line style chose, *before* any fold-angle encoding: that is the question the
    // rule is asking, and a hinted crease is unassigned, so no encoding applies to
    // it anyway (see {@link nonClassicMagnitudeUnits}).
    const hintAssignment = directionHint === 1 ? 'M' : directionHint === 2 ? 'V' : null;
    if (!hintAssignment || !pattern) return { ...base, hint: null };
    const hintStroke = styleInk(hintAssignment, edgeLineColor(hintAssignment), lineStyle, palette);
    if (hintStroke === ink) return { ...base, hint: null };
    return { ...base, hint: { stroke: hintStroke, dash: scaleDash(alternateDashRuns(pattern)) } };
  };
}

/** A line colour's stroke under `lineStyle`, in the export palette. */
function styleInk(
  assignment: string,
  lineColor: string,
  lineStyle: OristudioCpLineStyle,
  palette: CreaseExportPalette
): string {
  switch (cpLineStyleInk(lineStyle, lineColor)) {
    case 'black':
      return palette.monochromeInk;
    case 'grey':
      return palette.monochromeValley;
    case 'own':
      return assignmentColor(assignment, palette);
  }
}

function scaleDash(pattern: readonly number[]): string {
  return pattern.map((value) => (value * VIEW_SCALE).toFixed(2)).join(' ');
}

/**
 * The cap a crease's stroke ends with: round on a solid one, butt on a dashed
 * one.
 *
 * A cap is decoration on the two ends of a stroke. On a dashed stroke it is
 * decoration on the ends of every *mark*, which stops being decoration and
 * becomes the pattern: `stroke-linecap="round"` adds half the stroke width at
 * each end of each mark, so the marks grow by `strokeWidth` and the gaps shrink
 * by it. The line-width slider runs to 8, where the stroke is 17.07 units
 * against the undecided dash's 9.96-unit gaps — the gaps close and the dash is
 * gone. Measured over the whole slider, rasterized: an undecided crease exports
 * 100% ink from width 5 up, and the mountain chain (4.27-unit gaps) from width
 * 2. A picture that says "this is a crease" about a crease the user has not
 * decided is the one thing this dash exists to prevent.
 *
 * Shortening the marks to pay for the caps does not work: at width 8 the stroke
 * is wider than the undecided pattern's whole 14.22-unit period, so no array
 * leaves a gap under a round cap. Butt is also what the other two renderings of
 * these same patterns use — the canvas extrudes butt-ended quads (see
 * `strokeProgram`) and Oriedita's `SvgExporter` writes no `stroke-linecap` at
 * all — so with it the export inks exactly the runs it emits, at the canvas's
 * ink fraction rather than 1.5x it.
 *
 * Solid strokes keep the round cap: there the two half-discs are just the ends
 * of the crease, and they fill the notch where several creases meet a vertex.
 */
function strokeLinecap(dash: string): 'butt' | 'round' {
  return dash ? 'butt' : 'round';
}

export interface CreaseExportProjector {
  /** Project a vertex of the exported fold into the content box. */
  project: (vertex: number) => { x: number; y: number };
  /**
   * Project an arbitrary point in the fold's own coordinates. Content drawn
   * from another source (the folded figure) goes through this so it lands at
   * the same scale as the crease pattern rather than being fitted separately.
   */
  projectPoint: (point: { x: number; y: number }) => { x: number; y: number };
  /** Page units per unit of the fold's own coordinates. */
  scale: number;
  /** Y of the top of the projected crease pattern inside the content box. */
  contentTop: number;
  /** Height of the projected crease pattern inside the content box. */
  contentHeight: number;
}

export function foldProjector(fold: FoldDocument): CreaseExportProjector {
  const coords = fold.vertices_coords ?? [];
  const axes = flatPlaneAxes(fold);
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const coord of coords) {
    const u = coord[axes[0]] ?? 0;
    const v = coord[axes[1]] ?? 0;
    if (u < minU) minU = u;
    if (v < minV) minV = v;
    if (u > maxU) maxU = u;
    if (v > maxV) maxV = v;
  }
  if (!Number.isFinite(minU)) {
    minU = 0;
    minV = 0;
    maxU = 1;
    maxV = 1;
  }
  const spanU = Math.max(maxU - minU, 1e-6);
  const spanV = Math.max(maxV - minV, 1e-6);
  const span = CP_SIZE - MARGIN * 2;
  const scale = Math.min(span / spanU, span / spanV);
  const width = (maxU - minU) * scale;
  const height = (maxV - minV) * scale;
  const offsetX = (CP_SIZE - width) / 2;
  const offsetY = (CP_SIZE - height) / 2;
  const projectPoint = (point: { x: number; y: number }) => ({
    x: offsetX + (point.x - minU) * scale,
    // No y flip: FOLD coordinates are already y-down, matching SVG. Both
    // producers agree — the CP editor's model space is y-down (see
    // `cpModelToSvg`, which does not flip), and the
    // TreeMaker engine converts its internal y-up vertices on the way out
    // (`to_fold_document` emits `paper_height - loc.y`). Flipping here mirrored
    // every exported image relative to the editor.
    y: offsetY + (point.y - minV) * scale,
  });
  const project = (vertex: number) => {
    const coord = coords[vertex];
    return projectPoint({ x: coord?.[axes[0]] ?? 0, y: coord?.[axes[1]] ?? 0 });
  };
  return { project, projectPoint, scale, contentTop: offsetY, contentHeight: height };
}

export interface CreaseExportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CreaseExportTextBlock {
  lines: string[];
  fontSize: number;
  lineAdvance: number;
  weight: number;
  color: string;
  /** Top of the block, in page coordinates. */
  top: number;
}

export interface CreaseExportLayout {
  width: number;
  height: number;
  cp: CreaseExportRect;
  /** Where the folded figure draws, when one is included. */
  folded: CreaseExportRect | null;
  title: CreaseExportTextBlock | null;
  subtitle: CreaseExportTextBlock | null;
  description: CreaseExportTextBlock | null;
}

/**
 * Blank space the artwork already carries inside its own box, so the caption
 * can sit a consistent distance from the *drawn* crease pattern rather than
 * from the box edge — which is what made a lone title look adrift.
 */
export interface CreaseExportInset {
  top: number;
  bottom: number;
}

export const NO_CREASE_EXPORT_INSET: CreaseExportInset = { top: 0, bottom: 0 };

/** Measured extent of a folded figure, in projected (content box) units. */
export interface CreaseExportFoldedBox {
  width: number;
  height: number;
}

function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * AVERAGE_GLYPH_RATIO;
}

/**
 * Greedy word wrap against an estimated glyph advance. Explicit newlines are
 * kept as hard breaks; a single word wider than the line is split rather than
 * allowed to overflow the page.
 */
export function wrapExportText(text: string, maxWidth: number, fontSize: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * AVERAGE_GLYPH_RATIO)));
  const lines: string[] = [];

  for (const paragraph of trimmed.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || estimateTextWidth(candidate, fontSize) <= maxWidth) {
        current = candidate;
        continue;
      }
      lines.push(current);
      current = word;
    }
    if (current) lines.push(current);
  }

  // Hard-split any line that is a single over-long word.
  return lines.flatMap((line) => {
    if (estimateTextWidth(line, fontSize) <= maxWidth) return [line];
    const chunks: string[] = [];
    for (let index = 0; index < line.length; index += maxChars) {
      chunks.push(line.slice(index, index + maxChars));
    }
    return chunks;
  });
}

/**
 * Place the artwork and the caption on the page.
 *
 * With no caption and no folded figure the page is exactly the 1024² content
 * box — the shape every export had before captions existed — so a plain crease
 * pattern export is unchanged.
 */
export function layoutCreaseExport(
  caption: CreaseExportCaption,
  palette: CreaseExportPalette,
  foldedBox: CreaseExportFoldedBox | null = null,
  inset: CreaseExportInset = NO_CREASE_EXPORT_INSET
): CreaseExportLayout {
  // The crease pattern's box already ends in a margin, which becomes the gap to
  // the folded figure; the figure's own box is tight, so it takes a matching
  // margin on the outside edge.
  const contentWidth = CP_SIZE + (foldedBox ? foldedBox.width + MARGIN : 0);
  const contentHeight = Math.max(CP_SIZE, foldedBox?.height ?? 0);
  const textWidth = contentWidth - MARGIN * 2;

  const titleLines = wrapExportText(caption.title, textWidth, TITLE_FONT_SIZE);
  const subtitleLines = wrapExportText(caption.subtitle, textWidth, SUBTITLE_FONT_SIZE);
  const descriptionLines = wrapExportText(caption.description, textWidth, DESCRIPTION_FONT_SIZE);

  const titleAdvance = TITLE_FONT_SIZE * TITLE_LINE_HEIGHT;
  const subtitleAdvance = SUBTITLE_FONT_SIZE * SUBTITLE_LINE_HEIGHT;
  const descriptionAdvance = DESCRIPTION_FONT_SIZE * DESCRIPTION_LINE_HEIGHT;

  let cursor = 0;
  let title: CreaseExportTextBlock | null = null;
  let subtitle: CreaseExportTextBlock | null = null;
  if (titleLines.length > 0 || subtitleLines.length > 0) {
    cursor += CAPTION_PADDING;
    if (titleLines.length > 0) {
      title = {
        lines: titleLines,
        fontSize: TITLE_FONT_SIZE,
        lineAdvance: titleAdvance,
        weight: 700,
        color: palette.title,
        top: cursor,
      };
      cursor += titleLines.length * titleAdvance;
    }
    if (subtitleLines.length > 0) {
      if (title) cursor += CAPTION_GAP;
      subtitle = {
        lines: subtitleLines,
        fontSize: SUBTITLE_FONT_SIZE,
        lineAdvance: subtitleAdvance,
        weight: 400,
        color: palette.subtitle,
        top: cursor,
      };
      cursor += subtitleLines.length * subtitleAdvance;
    }
    cursor += Math.max(MIN_CONTENT_GAP, CONTENT_GAP - inset.top);
  }

  const contentTop = cursor;
  cursor += contentHeight;

  let description: CreaseExportTextBlock | null = null;
  if (descriptionLines.length > 0) {
    cursor += Math.max(MIN_CONTENT_GAP, CONTENT_GAP - inset.bottom);
    description = {
      lines: descriptionLines,
      fontSize: DESCRIPTION_FONT_SIZE,
      lineAdvance: descriptionAdvance,
      weight: 400,
      color: palette.description,
      top: cursor,
    };
    cursor += descriptionLines.length * descriptionAdvance + CAPTION_PADDING;
  }

  return {
    width: contentWidth,
    height: cursor,
    cp: { x: 0, y: contentTop, width: CP_SIZE, height: CP_SIZE },
    folded: foldedBox
      ? {
          x: CP_SIZE,
          y: contentTop,
          width: foldedBox.width,
          height: foldedBox.height,
        }
      : null,
    title,
    subtitle,
    description,
  };
}

function renderTextBlock(block: CreaseExportTextBlock | null, pageWidth: number): string {
  if (!block) return '';
  const centerX = (pageWidth / 2).toFixed(2);
  const lines = block.lines.map((line, index) => {
    const baseline = block.top + block.lineAdvance * index + block.fontSize * BASELINE_RATIO;
    return `  <text x="${centerX}" y="${baseline.toFixed(2)}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${block.fontSize}" font-weight="${block.weight}" fill="${block.color}">${escapeXml(line)}</text>`;
  });
  return lines.join('\n');
}

/**
 * Serialize a crease pattern (the whole document, or a single segment) to a
 * standalone SVG that matches the live editable view: the same line style,
 * width, and point size options, no M/V "view mode" toggle. `fold` is the
 * document's simulation fold; `segments` come from `segmentFoldDocument`.
 */
export function serializeCreasePatternSvg(
  fold: FoldDocument,
  segments: CpSegment[],
  options: CreaseExportOptions = DEFAULT_CREASE_EXPORT_OPTIONS,
  content: CreaseExportContent = EMPTY_CREASE_EXPORT_CONTENT
): string {
  return composeCreaseExportSvg(
    buildCreaseExportArtwork(fold, segments, options, content),
    options.caption
  ).svg;
}

export interface CreaseExportDocument {
  svg: string;
  width: number;
  height: number;
}

/**
 * The drawn part of an export, independent of the caption.
 *
 * Kept separate so the dialog can re-run the cheap caption/layout pass on every
 * keystroke without re-serializing a crease pattern that has not changed.
 */
export interface CreaseExportArtwork {
  /** Crease-pattern body, in content-box coordinates. */
  cp: string;
  /** Blank space inside the content box, above and below the drawn pattern. */
  inset: CreaseExportInset;
  /** Folded-figure body, drawn relative to its own box origin. */
  folded: string | null;
  foldedBox: CreaseExportFoldedBox | null;
  palette: CreaseExportPalette;
}

/**
 * Resolved content the options alone cannot describe.
 *
 * The folded figure comes from an async kernel fold, so the dialog computes it
 * for the preview and hands the same snapshot to the export — the file is then
 * exactly what the preview showed, rather than a second fold that might differ.
 */
export interface CreaseExportContent {
  foldedFigure: OristudioCpFoldedRenderSnapshot | null;
  /**
   * Places the figure's kernel coordinates in this fold's space. Usually the
   * identity; see {@link CpModelToFoldTransform}.
   */
  foldedFigureTransform?: CpModelToFoldTransform;
  /**
   * The grid `showGrid` draws, or null when this export has no grid behind it —
   * a TreeMaker design, or any fold with no editable crease-pattern document.
   */
  grid?: CreaseExportGridSource | null;
}

/**
 * The document's grid, and where the document's coordinates sit in the fold
 * being exported.
 *
 * Both are needed because neither is recoverable from the fold alone: FOLD
 * carries no grid, and an imported fold has been rescaled into the unit square
 * while the document's own creases are still in file coordinates (see
 * {@link CpModelToFoldTransform}).
 */
export interface CreaseExportGridSource {
  metadata: OristudioCpGridMetadata;
  transform: CpModelToFoldTransform;
}

export const EMPTY_CREASE_EXPORT_CONTENT: CreaseExportContent = { foldedFigure: null };

/**
 * The grid an export of `fold` should draw, or null when `document` is absent.
 *
 * The single place the two halves are resolved together, so every caller that
 * opens an export or share preview hands the artwork the same pair.
 */
export function creaseExportGridSource(
  fold: FoldDocument,
  document: OristudioCpDocumentSnapshot | null | undefined
): CreaseExportGridSource | null {
  if (!document) return null;
  return {
    metadata: document.crease_pattern.grid,
    transform: cpModelToFoldTransform(fold, document),
  };
}

/**
 * Grid lines under one exported crease pattern, in content-box coordinates.
 *
 * The lattice comes from the same generator the live canvas draws with, over the
 * *drawn pattern's* own extent rather than a viewport: an exported image has no
 * scrollable region, so a grid that ran past the artwork would only add margin
 * ruling. `visibleOrieditaGridMetadata` is what makes a document whose grid state
 * is `Hidden` still export a grid — asking for one here is the same act as
 * showing it on the canvas, and upstream stores visibility in that state.
 */
function creaseExportGridSvg(
  source: CreaseExportGridSource,
  fold: FoldDocument,
  projectPoint: (point: Point) => Point,
  palette: CreaseExportPalette
): string {
  const { transform } = source;
  if (!Number.isFinite(transform.scale) || transform.scale === 0) return '';
  const axes = flatPlaneAxes(fold);
  const coords = fold.vertices_coords ?? [];
  if (coords.length === 0) return '';

  // Grid indices are counted in the document's own space, so the fold's extent
  // has to travel back through the transform before it can bound them.
  const toModel = (point: Point): Point => ({
    x: (point.x - transform.offsetX) / transform.scale,
    y: (point.y - transform.offsetY) / transform.scale,
  });
  const bounds = expandedModelBoundsFromPoints(
    coords.map((coord) => toModel({ x: coord[axes[0]] ?? 0, y: coord[axes[1]] ?? 0 })),
    0
  );

  const lines = orieditaGridLinesForModelBounds(
    bounds,
    visibleOrieditaGridMetadata(source.metadata)
  );
  if (lines.length === 0) return '';

  const project = (point: Point) => projectPoint(applyCpModelToFold(point, transform));
  const body = lines
    .map((line) => {
      const a = project(line.a);
      const b = project(line.b);
      return `    <line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}" stroke="${palette.grid}" stroke-width="${GRID_STROKE_WIDTH.toFixed(2)}"/>`;
    })
    .join('\n');

  // A lattice is generated in whole cells, so it always overhangs the sheet.
  // Clip it to the sheet's own outline rather than to a box: paper is not
  // necessarily rectangular, and on a hexagon a box leaves ruling floating in
  // the corners with nothing under it.
  const projectVertex = (vertex: number) => {
    const coord = coords[vertex];
    return projectPoint({ x: coord?.[axes[0]] ?? 0, y: coord?.[axes[1]] ?? 0 });
  };
  const outline = foldOutlineLoops(fold)
    .map(
      (loop) =>
        `M ${loop
          .map((vertex) => {
            const point = projectVertex(vertex);
            return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
          })
          .join(' L ')} Z`
    )
    .join(' ');

  // Falls back to the pattern's box when the fold carries no faces to take an
  // outline from — a box is still better than ruling across the whole page.
  const clipShape = outline
    ? `<path d="${outline}" clip-rule="evenodd"/>`
    : boundingRectSvg([
        project({ x: bounds.minX, y: bounds.minY }),
        project({ x: bounds.maxX, y: bounds.minY }),
        project({ x: bounds.minX, y: bounds.maxY }),
        project({ x: bounds.maxX, y: bounds.maxY }),
      ]);

  return [
    `  <defs><clipPath id="${GRID_CLIP_ID}">${clipShape}</clipPath></defs>`,
    `  <g clip-path="url(#${GRID_CLIP_ID})">`,
    body,
    '  </g>',
  ].join('\n');
}

function boundingRectSvg(points: Point[]): string {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(Math.max(...xs) - x).toFixed(2)}" height="${(Math.max(...ys) - y).toFixed(2)}"/>`;
}

/**
 * Closed vertex loops bounding the sheet, as indices into `vertices_coords`.
 *
 * An edge used by exactly one face is on the boundary of the union of the faces,
 * which is the paper. Derived from the faces rather than from `B` assignments,
 * which say what a crease *is* — a document is free to draw an edge crease
 * across the middle of a sheet, and upstream files do.
 *
 * Disjoint patterns come back as separate loops, and so does a hole; drawn as
 * one even-odd path, that is exactly the region to keep.
 */
function foldOutlineLoops(fold: FoldDocument): number[][] {
  const faces = fold.faces_vertices ?? [];
  if (faces.length === 0) return [];

  const uses = new Map<string, { a: number; b: number; count: number }>();
  for (const face of faces) {
    for (let index = 0; index < face.length; index += 1) {
      const a = face[index] ?? 0;
      const b = face[(index + 1) % face.length] ?? 0;
      if (a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const entry = uses.get(key);
      if (entry) entry.count += 1;
      else uses.set(key, { a, b, count: 1 });
    }
  }

  const unwalked = new Map<number, number[]>();
  const link = (from: number, to: number) => {
    const list = unwalked.get(from);
    if (list) list.push(to);
    else unwalked.set(from, [to]);
  };
  for (const { a, b, count } of uses.values()) {
    if (count !== 1) continue;
    link(a, b);
    link(b, a);
  }

  const walk = (from: number, to: number) => {
    const list = unwalked.get(from);
    const at = list?.indexOf(to) ?? -1;
    if (list && at >= 0) list.splice(at, 1);
  };

  const loops: number[][] = [];
  for (const start of unwalked.keys()) {
    for (;;) {
      const first = unwalked.get(start)?.[0];
      if (first === undefined) break;
      const loop = [start];
      let current = first;
      walk(start, current);
      walk(current, start);
      while (current !== start) {
        loop.push(current);
        const next = unwalked.get(current)?.[0];
        // Only reachable on a boundary that does not close — malformed faces.
        // The path's own `Z` closes what is left.
        if (next === undefined) break;
        walk(current, next);
        walk(next, current);
        current = next;
      }
      loops.push(loop);
    }
  }
  return loops;
}

export function buildCreaseExportArtwork(
  fold: FoldDocument,
  segments: CpSegment[],
  options: CreaseExportOptions,
  content: CreaseExportContent = EMPTY_CREASE_EXPORT_CONTENT
): CreaseExportArtwork {
  const palette = creaseExportPalette(options.theme);
  const segment =
    options.segmentId != null ? segments.find((entry) => entry.id === options.segmentId) : undefined;
  const targetFold = segment ? buildSegmentFold(fold, segment) : fold;
  const { project, projectPoint, scale, contentTop, contentHeight } = foldProjector(targetFold);

  const faces = targetFold.faces_vertices ?? [];
  const edges = targetFold.edges_vertices ?? [];
  const assignments = targetFold.edges_assignment ?? [];
  // Only the *direction* rides in the extension; the unknown-ness is in
  // `edges_assignment` itself, so a fold without this array simply draws its
  // unassigned creases plain.
  const directionHints = (targetFold as { 'oristudio:edges_fold_direction_hint'?: number[] })[
    'oristudio:edges_fold_direction_hint'
  ] ?? [];
  const strokeWidth = Math.max(0.5, options.lineWidth * 1.5 * VIEW_SCALE);

  const backgrounds =
    options.showBackgroundColor && faces.length
      ? faces
          .map((face) => {
            const points = face
              .map(project)
              .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
              .join(' ');
            return `  <polygon points="${points}" fill="${palette.paper}" stroke="none"/>`;
          })
          .join('\n')
      : '';

  const foldAngles = targetFold.edges_foldAngle;
  const appearanceFor = edgeAppearances(options.lineStyle, options.foldAngleDisplay, palette);
  const lines = edges
    .map((edge, index) => {
      const assignment = assignments[index] ?? 'U';
      if (!options.includeUnassigned && isUnassigned(assignment)) return '';
      const { stroke, strokeOpacity, dash, hint } = appearanceFor(
        assignment,
        foldAngles?.[index],
        directionHints[index] ?? 0
      );
      const a = project(edge[0]);
      const b = project(edge[1]);
      const ends = `x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}"`;
      const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
      // Omitted at full opacity, so a pattern of classic creases still serializes
      // byte-for-byte what it did before fold angles reached the export.
      const opacityAttr =
        strokeOpacity < 1 ? ` stroke-opacity="${strokeOpacity.toFixed(3)}"` : '';
      const line = `  <line ${ends} stroke="${stroke}" stroke-width="${strokeWidth.toFixed(2)}"${opacityAttr}${dashAttr} stroke-linecap="${strokeLinecap(dash)}"/>`;
      if (!hint) return line;
      // Second, over the first: the marks are congruent, so this repaints half
      // of them rather than adding ink beside them. No `stroke-dashoffset` —
      // both strokes start their pattern at the crease's own start, which is
      // what makes a short crease show its direction at all.
      //
      // It carries the base crease's opacity so the two halves of one crease can
      // never drift apart. Today that is always 1: a hinted crease is unassigned,
      // and only `M`/`V` are ever faded.
      return `${line}\n  <line ${ends} stroke="${hint.stroke}" stroke-width="${strokeWidth.toFixed(2)}"${opacityAttr} stroke-dasharray="${hint.dash}" stroke-linecap="${strokeLinecap(hint.dash)}"/>`;
    })
    .filter(Boolean)
    .join('\n');

  const grid =
    options.showGrid && content.grid
      ? creaseExportGridSvg(content.grid, targetFold, projectPoint, palette)
      : '';

  let points = '';
  if (options.pointSize > 0) {
    const radius = options.pointSize * 1.6 * VIEW_SCALE;
    const drawn = new Set<number>();
    const dots: string[] = [];
    for (const edge of edges) {
      for (const vertex of edge) {
        if (drawn.has(vertex)) continue;
        drawn.add(vertex);
        const point = project(vertex);
        dots.push(
          `  <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${radius.toFixed(2)}" fill="${palette.point}"/>`
        );
      }
    }
    points = dots.join('\n');
  }

  // The folded figure is drawn through the crease pattern's own projector, so
  // paper and folded form share a scale and read as the same model at the same
  // size — then shifted to its own box origin, which the compose pass places.
  let folded: string | null = null;
  let foldedBox: CreaseExportFoldedBox | null = null;
  const foldedSnapshot = options.includeFoldedFigure ? content.foldedFigure : null;
  const foldedTransform = content.foldedFigureTransform ?? IDENTITY_CP_MODEL_TO_FOLD;
  // The figure comes back in kernel coordinates, which are not always the
  // fold's own — an imported fold is rescaled to the unit square.
  const projectFoldedPoint = (point: { x: number; y: number }) =>
    projectPoint(applyCpModelToFold(point, foldedTransform));
  if (foldedSnapshot) {
    const bounds = projectedFoldedFigureBounds(foldedSnapshot, projectFoldedPoint);
    if (bounds) {
      // Fit the figure's height to the drawn crease pattern's, so the two line
      // up top and bottom. The kernel's folded coordinates carry a display
      // scale of their own (an imported figure can come back twice the size of
      // the paper it was folded from), which is not a size worth reproducing.
      const height = bounds.maxY - bounds.minY;
      const fit = height > 0 ? contentHeight / height : 1;
      foldedBox = { width: (bounds.maxX - bounds.minX) * fit, height: contentTop + contentHeight };
      folded = foldedFigureSvgBody(foldedSnapshot, {
        project: (point) => {
          const projected = projectFoldedPoint(point);
          return {
            x: (projected.x - bounds.minX) * fit,
            y: (projected.y - bounds.minY) * fit + contentTop,
          };
        },
        scale: scale * foldedTransform.scale * fit,
      });
    }
  }

  return {
    // Grid between the paper and the creases: it is ruling *on* the sheet, and
    // nothing in the pattern should have to compete with it.
    cp: [backgrounds, grid, lines, points].filter(Boolean).join('\n'),
    inset: { top: contentTop, bottom: contentTop },
    folded,
    foldedBox,
    palette,
  };
}

/** Place artwork and caption on the page and emit the standalone SVG. */
export function composeCreaseExportSvg(
  artwork: CreaseExportArtwork,
  caption: CreaseExportCaption
): CreaseExportDocument {
  const { palette } = artwork;
  const layout = layoutCreaseExport(caption, palette, artwork.foldedBox, artwork.inset);
  // Only wrap the artwork when it actually moves: an export with no caption is
  // byte-for-byte what it was before captions existed.
  const placedCp =
    layout.cp.x === 0 && layout.cp.y === 0
      ? artwork.cp
      : `  <g transform="translate(${layout.cp.x.toFixed(2)}, ${layout.cp.y.toFixed(2)})">\n${artwork.cp}\n  </g>`;
  const placedFolded =
    artwork.folded && layout.folded
      ? `  <g transform="translate(${layout.folded.x.toFixed(2)}, ${layout.folded.y.toFixed(2)})">\n${artwork.folded}\n  </g>`
      : '';

  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width.toFixed(2)}" height="${layout.height.toFixed(2)}" viewBox="0 0 ${layout.width.toFixed(2)} ${layout.height.toFixed(2)}" role="img" aria-label="Crease pattern">`,
    `  <rect width="100%" height="100%" fill="${palette.canvas}"/>`,
    renderTextBlock(layout.title, layout.width),
    renderTextBlock(layout.subtitle, layout.width),
    placedCp,
    placedFolded,
    renderTextBlock(layout.description, layout.width),
    '</svg>',
  ]
    .filter(Boolean)
    .join('\n');

  return { svg, width: layout.width, height: layout.height };
}

/**
 * Rasterize a standalone SVG document through an offscreen canvas. Shared with
 * the folded-figure export, which composes a different page from the same
 * primitives.
 */
export async function svgToPng(svg: string, width: number, height: number): Promise<Uint8Array> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to render export SVG'));
    });
    image.src = url;
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas rendering is unavailable');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Failed to encode export PNG'));
      }, 'image/png');
    });
    return new Uint8Array(await pngBlob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function renderCreasePatternPng(
  fold: FoldDocument,
  segments: CpSegment[],
  options: CreaseExportOptions = DEFAULT_CREASE_EXPORT_OPTIONS,
  content: CreaseExportContent = EMPTY_CREASE_EXPORT_CONTENT
): Promise<Uint8Array> {
  const page = composeCreaseExportSvg(
    buildCreaseExportArtwork(fold, segments, options, content),
    options.caption
  );
  return svgToPng(page.svg, page.width, page.height);
}

/**
 * The share card's fixed geometry: 1.91:1, the aspect Twitter/X, Facebook, Discord,
 * Slack, and iMessage all lay out as a large-image card.
 *
 * 1000x525 rather than the conventional 1200x630, chosen by measuring the corpus: it is
 * 22% fewer bytes (median card 91 KB -> 71 KB, densest 261 KB -> 208 KB) with no visible
 * loss even on a 6,256-crease pattern, where individual pleats still resolve. Detail does
 * collapse further down — at 600 wide the pleat bands merge into hatching, and by 400 the
 * mountain/valley colours average into a haze — so this is the small end of the range that
 * still renders a dense CP honestly, not the smallest that fits.
 */
export const SHARE_CARD_WIDTH = 1000;
export const SHARE_CARD_HEIGHT = 525;
/**
 * Breathing room so the artwork never touches the card edge. Non-zero because Discord
 * rounds card corners and some surfaces trim an edge pixel — at zero padding the pattern's
 * border stroke is what gets shaved.
 */
export const SHARE_CARD_PADDING = 20;

export interface ShareCardFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Fit a page of arbitrary aspect into the card, preserving aspect and centring.
 *
 * **Upscaling is deliberate.** The obvious implementation rasterizes at the SVG's own
 * dimensions, which is how openscad-studio shipped 90x54 thumbnails that no platform
 * would render as a large card (see implementation-plans/share-2d-thumbnail-improvement.md).
 * A card is a fixed-size surface; whatever goes on it is scaled to suit, in both directions.
 */
export function computeShareCardFrame(
  sourceWidth: number,
  sourceHeight: number,
  cardWidth: number = SHARE_CARD_WIDTH,
  cardHeight: number = SHARE_CARD_HEIGHT,
  padding: number = SHARE_CARD_PADDING
): ShareCardFrame {
  const safeSourceWidth = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : 1;
  const safeSourceHeight = Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : 1;
  // Padding that would leave no room at all is padding we ignore; a card with a sliver of
  // artwork is worse than a card with none of the requested margin.
  const safePadding = Math.max(
    0,
    Math.min(
      Number.isFinite(padding) && padding > 0 ? padding : 0,
      (Math.min(cardWidth, cardHeight) - 1) / 2
    )
  );
  const boxWidth = cardWidth - safePadding * 2;
  const boxHeight = cardHeight - safePadding * 2;
  const scale = Math.min(boxWidth / safeSourceWidth, boxHeight / safeSourceHeight);
  const width = safeSourceWidth * scale;
  const height = safeSourceHeight * scale;
  return {
    x: (cardWidth - width) / 2,
    y: (cardHeight - height) / 2,
    width,
    height,
  };
}

export interface ShareCardOptions {
  /** Card fill behind the artwork. Use the export palette's `canvas`. */
  background: string;
  width?: number;
  height?: number;
  padding?: number;
}

/**
 * Rasterize a composed export page onto a fixed-size social card.
 *
 * Distinct from {@link svgToPng}, which renders a page at its own dimensions because an
 * exported file should be exactly what the preview showed. A share card is the opposite
 * contract: a fixed canvas the artwork is fitted into.
 */
export async function svgToPngCard(
  svg: string,
  sourceWidth: number,
  sourceHeight: number,
  options: ShareCardOptions
): Promise<Uint8Array> {
  const cardWidth = options.width ?? SHARE_CARD_WIDTH;
  const cardHeight = options.height ?? SHARE_CARD_HEIGHT;
  const frame = computeShareCardFrame(
    sourceWidth,
    sourceHeight,
    cardWidth,
    cardHeight,
    options.padding ?? SHARE_CARD_PADDING
  );

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to render share card SVG'));
    });
    image.src = url;
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = cardWidth;
    canvas.height = cardHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas rendering is unavailable');
    // The page already paints its own background, but only where the artwork lands. The
    // letterboxed remainder needs the same fill or the card reads as a transparent PNG,
    // which several platforms composite onto black.
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, cardWidth, cardHeight);
    ctx.drawImage(image, frame.x, frame.y, frame.width, frame.height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Failed to encode share card PNG'));
      }, 'image/png');
    });
    return new Uint8Array(await pngBlob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Render a crease pattern straight to a share card PNG. */
export function renderCreasePatternCardPng(
  fold: FoldDocument,
  segments: CpSegment[],
  options: CreaseExportOptions = DEFAULT_CREASE_EXPORT_OPTIONS,
  content: CreaseExportContent = EMPTY_CREASE_EXPORT_CONTENT
): Promise<Uint8Array> {
  const artwork = buildCreaseExportArtwork(fold, segments, options, content);
  const page = composeCreaseExportSvg(artwork, options.caption);
  return svgToPngCard(page.svg, page.width, page.height, {
    background: artwork.palette.canvas,
  });
}
