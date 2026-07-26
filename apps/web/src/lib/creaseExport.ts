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
  IDENTITY_CP_MODEL_TO_FOLD,
  type CpModelToFoldTransform,
} from './creaseExportFold';
import type {
  OristudioCpFoldedFigureState,
  OristudioCpFoldedRenderSnapshot,
} from '../engine/oristudioCpTypes';
import {
  DEFAULT_ORISTUDIO_CP_LINE_STYLE,
  DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
  type OristudioCpLineStyle,
} from './creasePatternViewport';

/** Side of the square content box the crease pattern is drawn into. */
const CP_SIZE = 1024;
const MARGIN = 48;
// Export viewBox (1024) is larger than the editable canvas viewBox (~720); scale
// stroke widths / point radii so exports look like the live crease-pattern view.
const VIEW_SCALE = CP_SIZE / 720;

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
  /** Which surface the figure shows: front, back, both, or see-through. */
  side: OristudioCpFoldedFigureState;
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
  lineWidth: number;
  pointSize: number;
  includeUnassigned: boolean;
  showBackgroundColor: boolean;
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
  lineWidth: DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
  // Points are off by default for exports (they add visual noise to a CP image).
  pointSize: 0,
  includeUnassigned: true,
  showBackgroundColor: true,
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
  dash: string;
}

// Line-style rules mirroring the editable crease-pattern view. In the "color"
// style, mountain and valley are distinguished by color alone (solid red /
// solid blue); the black/shape styles use dash patterns instead.
function edgeAppearance(
  assignment: string,
  lineStyle: OristudioCpLineStyle,
  palette: CreaseExportPalette
): EdgeAppearance {
  const black = lineStyle === 'black-one-dot' || lineStyle === 'black-two-dot';
  let stroke: string;
  if (lineStyle === 'black-white') {
    stroke = assignment === 'V' ? palette.monochromeValley : palette.monochromeInk;
  } else if (black) {
    stroke = palette.monochromeInk;
  } else {
    stroke = assignmentColor(assignment, palette);
  }

  let dash = '';
  if (assignment === 'V') {
    if (lineStyle === 'color') dash = ''; // solid blue
    else if (lineStyle === 'black-white') dash = scaleDash([10, 7]);
    else dash = scaleDash([8, 8]); // color-and-shape / dot styles
  } else if (assignment === 'M') {
    // 'color' and 'black-white' keep mountains solid; the shape/dot styles use a
    // dash-dot chain (kept fairly sparse so it doesn't read as dense).
    if (lineStyle === 'color-and-shape' || lineStyle === 'black-one-dot') dash = scaleDash([16, 6, 4, 6]);
    else if (lineStyle === 'black-two-dot') dash = scaleDash([16, 6, 4, 6, 4, 6]);
  }
  return { stroke, dash };
}

function scaleDash(pattern: number[]): string {
  return pattern.map((value) => (value * VIEW_SCALE).toFixed(2)).join(' ');
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
    // `modelPointToCpSvg` / `orieditaTvToSvg`, neither of which flips), and the
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
}

export const EMPTY_CREASE_EXPORT_CONTENT: CreaseExportContent = { foldedFigure: null };

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

  const lines = edges
    .map((edge, index) => {
      const assignment = assignments[index] ?? 'U';
      if (!options.includeUnassigned && isUnassigned(assignment)) return '';
      const { stroke, dash } = edgeAppearance(assignment, options.lineStyle, palette);
      const a = project(edge[0]);
      const b = project(edge[1]);
      const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
      return `  <line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}" stroke="${stroke}" stroke-width="${strokeWidth.toFixed(2)}"${dashAttr} stroke-linecap="round"/>`;
    })
    .filter(Boolean)
    .join('\n');

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
    cp: [backgrounds, lines, points].filter(Boolean).join('\n'),
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

async function svgToPng(svg: string, width: number, height: number): Promise<Uint8Array> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to render crease pattern SVG'));
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
        else reject(new Error('Failed to encode crease pattern PNG'));
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
