/**
 * The document's crease patterns, as the References workspace picks between
 * them.
 *
 * The workspace answers for one sheet at a time (plan D12): a document holding
 * several disjoint patterns is several separate folding problems, and the step
 * numbering of two of them concatenated means nothing. The frames analysis
 * already splits the document — `crates/oristudio-precrease/src/components.rs`
 * groups segments by border loop — so this module only *orders* and *draws*
 * that split; it computes no geometry of its own beyond fitting a thumbnail
 * into its box.
 *
 * The simulator's equivalent (`creasePatternSegmentation.ts`) flood-fills the
 * faces of a FOLD document. Deliberately not reused: References works from
 * `CpGeometryTransport` and never builds a fold, and a precrease component is
 * the thing the planner actually plans.
 */
import { SEG_ATTR_STRIDE, type CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { PrecreaseComponent, SheetAnalysis } from './sheetFrames';

/** One row of the sheet picker. */
export interface ReferencesSheet {
  /** The precrease component id — what `referencesSelectedSheet` holds. */
  id: number;
  /** Can it be planned at all? A refused sheet still gets a row, greyed. */
  plannable: boolean;
  /** Creases in the sheet, its border included: the row's size chip. */
  creaseCount: number;
}

/**
 * Every sheet in the document, biggest first.
 *
 * The same order `plannableComponents` plans in, so "sheet 1" means the same
 * pattern in the sidebar and in the plan; refused sheets sort after the
 * plannable ones rather than being dropped, because a sheet the planner will
 * not take is a thing the user needs to see and be told about.
 */
export function referencesSheets(analysis: SheetAnalysis | null): ReferencesSheet[] {
  if (!analysis) return [];
  return analysis.components
    .map((component) => ({
      id: component.id,
      plannable: component.frame !== null && component.rf_rect !== null,
      creaseCount: component.segment_indices.length + component.border_segment_indices.length,
    }))
    .sort((a, b) => {
      if (a.plannable !== b.plannable) return a.plannable ? -1 : 1;
      return b.creaseCount - a.creaseCount;
    });
}

/**
 * The sheet the workspace is actually working on.
 *
 * A stored id survives edits that do not touch it and is dropped when it names
 * nothing — the analysis is recomputed on every revision, and a component id
 * from a previous shape of the document may now be a different pattern or no
 * pattern at all. Falls back to the first plannable sheet, so the workspace
 * always has something to answer for.
 */
export function resolveSelectedSheet(
  sheets: readonly ReferencesSheet[],
  stored: number | null
): number | null {
  if (stored !== null && sheets.some((sheet) => sheet.id === stored)) return stored;
  return sheets.find((sheet) => sheet.plannable)?.id ?? sheets[0]?.id ?? null;
}

/** The 1-based crease ids belonging to a sheet, border included. */
export function sheetLineIds(component: PrecreaseComponent): Set<number> {
  const ids = new Set<number>();
  for (const index of component.segment_indices) ids.add(index + 1);
  for (const index of component.border_segment_indices) ids.add(index + 1);
  return ids;
}

/** The 1-based crease ids of a sheet's border loop. */
export function sheetBorderLineIds(component: PrecreaseComponent): Set<number> {
  return new Set(component.border_segment_indices.map((index) => index + 1));
}

export type ReferencesThumbnailStroke = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Which class the stroke takes; `border` is the paper's own edge. */
  kind: 'border' | 'mountain' | 'valley' | 'other';
};

export interface ReferencesSheetThumbnail {
  viewBox: string;
  strokes: ReferencesThumbnailStroke[];
}

/** `Red1` and `Blue2` from `LINE_COLOR_BY_NUMBER` — Oriedita's own codes. */
const CP_MOUNTAIN = 1;
const CP_VALLEY = 2;

/**
 * Which way a thumbnail's stroke folds.
 *
 * Read from the raw colour number rather than through `lineColorName`, which
 * throws on a code outside its table: a thumbnail that cannot read a colour
 * should draw a plain line, not take the sidebar down. The planner's own steps
 * do not come through here — the crate settles their direction and `Step`
 * carries it (plan D24). This is the picker's own reading of a raw pattern,
 * which has no plan yet.
 */
function strokeKind(colorNumber: number, isBorder: boolean): ReferencesThumbnailStroke['kind'] {
  if (isBorder) return 'border';
  if (colorNumber === CP_MOUNTAIN) return 'mountain';
  if (colorNumber === CP_VALLEY) return 'valley';
  return 'other';
}

/**
 * A sheet drawn to fit `size`, in its own coordinates.
 *
 * Model space is y-down and so is SVG, so the strokes go through unflipped; the
 * only transform is the uniform fit, which keeps the pattern's aspect ratio —
 * a squashed thumbnail is a different crease pattern.
 */
export function sheetThumbnail(
  geometry: CpGeometryTransport,
  component: PrecreaseComponent,
  size = 100
): ReferencesSheetThumbnail | null {
  const endpoints = geometry.segEndpoints;
  const attr = geometry.segAttr;
  const border = new Set(component.border_segment_indices);
  const indices = [...component.border_segment_indices, ...component.segment_indices];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const index of indices) {
    const base = index * 4;
    if (base + 3 >= endpoints.length) continue;
    minX = Math.min(minX, endpoints[base], endpoints[base + 2]);
    maxX = Math.max(maxX, endpoints[base], endpoints[base + 2]);
    minY = Math.min(minY, endpoints[base + 1], endpoints[base + 3]);
    maxY = Math.max(maxY, endpoints[base + 1], endpoints[base + 3]);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const span = Math.max(maxX - minX, maxY - minY);
  if (!(span > 0)) return null;
  const scale = size / span;
  const offsetX = (size - (maxX - minX) * scale) / 2;
  const offsetY = (size - (maxY - minY) * scale) / 2;
  const at = (x: number, y: number) => ({
    x: (x - minX) * scale + offsetX,
    y: (y - minY) * scale + offsetY,
  });

  const strokes: ReferencesThumbnailStroke[] = [];
  for (const index of indices) {
    const base = index * 4;
    if (base + 3 >= endpoints.length) continue;
    const a = at(endpoints[base], endpoints[base + 1]);
    const b = at(endpoints[base + 2], endpoints[base + 3]);
    strokes.push({
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      kind: strokeKind(attr[index * SEG_ATTR_STRIDE] ?? 0, border.has(index)),
    });
  }
  // Border last so the paper's edge draws over the creases that end on it.
  strokes.sort((a, b) => Number(a.kind === 'border') - Number(b.kind === 'border'));
  return { viewBox: `0 0 ${size} ${size}`, strokes };
}
