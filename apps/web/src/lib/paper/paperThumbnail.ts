/**
 * The little picture of a paper style a preset card shows: a crease-pattern
 * square beside a small folded figure, drawn with the style's own pens, paper
 * and light.
 *
 * Geometry only — the caller turns it into SVG — and no React, store or
 * CP-workspace import, so it is a unit test away from a renderer.
 *
 * The shading is the app's, not an approximation of it: `shadeFor` and
 * `shadeColor` are the one flat-lighting formula every surface paints with, so
 * a card previews the face colours the simulator and the exporter will
 * actually produce for that light rather than a lookalike that drifts from
 * them.
 */
import { shadeColor, shadeFor, type Vec3Like } from '@treemaker/origami-simulator';
import { hexToUnitRgb, lightVector, unitRgbToHex } from './paperStyleResolve';
import { PT_TO_CSS_PX, type Hex, type PaperStyle, type Pen } from './paperStyle';

/** The drawing's own coordinate space; a card scales it through a viewBox. */
export const PAPER_THUMBNAIL_WIDTH = 136;
export const PAPER_THUMBNAIL_HEIGHT = 74;
const PAD = 7;
/** The gap between the crease-pattern square and the figure beside it. */
const GAP = 9;
/** The figure is drawn a little smaller than the square, so the two read as a pair. */
const FIGURE_SCALE = 0.92;

export interface PaperThumbnailSheet {
  x: number;
  y: number;
  size: number;
  fill: Hex;
  stroke: Hex;
  strokeWidth: number;
}

export interface PaperThumbnailLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: Hex;
  strokeWidth: number;
  /** An SVG `stroke-dasharray`, or null for a solid pen. */
  dash: string | null;
}

export interface PaperThumbnailFace {
  /** An SVG path `d`. */
  d: string;
  fill: Hex;
  stroke: Hex;
  strokeWidth: number;
}

export interface PaperThumbnail {
  width: number;
  height: number;
  sheet: PaperThumbnailSheet;
  /** Two mountain diagonals and two valley midlines, in that order. */
  lines: PaperThumbnailLine[];
  faces: PaperThumbnailFace[];
}

/** A face of the folded figure: which side of the paper shows, its normal, its outline. */
interface FigureFace {
  side: 'front' | 'back';
  normal: Vec3Like;
  points: readonly (readonly [number, number])[];
}

/**
 * A flap of paper folded once, in the unit square the figure is drawn into: a
 * front quad, and the back showing along the fold. Fixed geometry, so every
 * preset's figure differs only by the style.
 */
const FIGURE: readonly FigureFace[] = [
  {
    side: 'front',
    normal: [-0.3, 0.5, 0.8],
    points: [
      [0.35, 0.36],
      [0.85, 0.49],
      [0.6, 0.79],
      [0.1, 0.66],
    ],
  },
  {
    side: 'back',
    normal: [0.2, 0.8, 0.55],
    points: [
      [0.35, 0.36],
      [0.56, 0.28],
      [1, 0.4],
      [0.85, 0.49],
    ],
  },
];

/** The creases of the square: `[from, to]` in unit coordinates, by the pen that draws them. */
const CREASES: readonly { pen: 'mountainFolds' | 'valleyFolds'; from: [number, number]; to: [number, number] }[] = [
  { pen: 'mountainFolds', from: [0, 0], to: [1, 1] },
  { pen: 'mountainFolds', from: [1, 0], to: [0, 1] },
  { pen: 'valleyFolds', from: [0.5, 0], to: [0.5, 1] },
  { pen: 'valleyFolds', from: [0, 0.5], to: [1, 0.5] },
];

/** A pen's width in the drawing's space: pt at the same 4/3 every surface draws it at. */
function penWidth(pen: Pen): number {
  return round(pen.width * PT_TO_CSS_PX);
}

/** A pen's dash, its multiples resolved against its own width, as SVG writes it. */
function penDash(pen: Pen, width: number): string | null {
  if (!pen.dash || pen.dash.length === 0) return null;
  return pen.dash.map((run) => round(run * width)).join(' ');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The style's picture, {@link PAPER_THUMBNAIL_WIDTH} × {@link PAPER_THUMBNAIL_HEIGHT}. */
export function paperThumbnail(style: PaperStyle): PaperThumbnail {
  const size = PAPER_THUMBNAIL_HEIGHT - PAD * 2;
  const x = PAD + 2;
  const y = PAD;
  const edgeWidth = penWidth(style.edges);

  const lines = CREASES.map(({ pen: role, from, to }) => {
    const pen = style[role];
    const width = penWidth(pen);
    return {
      x1: round(x + from[0] * size),
      y1: round(y + from[1] * size),
      x2: round(x + to[0] * size),
      y2: round(y + to[1] * size),
      stroke: pen.color,
      strokeWidth: width,
      dash: penDash(pen, width),
    };
  });

  const figureX = x + size + GAP;
  const figureSize = size * FIGURE_SCALE;
  const light = lightVector(style.light.azimuth, style.light.elevation);
  const faces = FIGURE.map((face) => {
    const shade = style.light.enabled ? shadeFor(face.normal, light) : 1;
    const base = face.side === 'front' ? style.paper.front : style.paper.back;
    return {
      d: `${face.points
        .map(
          (point, index) =>
            `${index === 0 ? 'M' : 'L'} ${round(figureX + point[0] * figureSize)} ${round(y + point[1] * figureSize)}`
        )
        .join(' ')} Z`,
      fill: unitRgbToHex(shadeColor(hexToUnitRgb(base), shade)),
      stroke: style.edges.color,
      strokeWidth: edgeWidth,
    };
  });

  return {
    width: PAPER_THUMBNAIL_WIDTH,
    height: PAPER_THUMBNAIL_HEIGHT,
    sheet: {
      x,
      y,
      size,
      fill: style.paper.front,
      stroke: style.edges.color,
      strokeWidth: edgeWidth,
    },
    lines,
    faces,
  };
}
