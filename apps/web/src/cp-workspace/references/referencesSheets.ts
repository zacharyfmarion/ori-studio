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
 * the thing the planner actually plans. What the two *do* share is the card
 * each pattern is drawn on — `../sheets` fits both readings into the same
 * thumbnail, so the two rails list the same patterns the same way.
 */
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import {
  fitSheetThumbnail,
  type SheetStroke,
  type SheetStrokeRole,
  type SheetThumbnail,
} from '../sheets/sheetThumbnail';
import { creaseRoleAt } from './creaseRole';
import type { ModelBounds } from './referencesStepGeometry';
import type { PrecreaseComponent, PrecreaseFrame, SheetAnalysis } from './sheetFrames';

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

/**
 * Where a sheet is, in model space: the box around its outline.
 *
 * How a sheet is named when it has to outlive the analysis that numbered it —
 * in a saved file, or in the plan cache — since a component id is an index
 * into one run of the frames analysis and another run may number the sheets
 * differently. Null for a component with no outline.
 */
export function sheetBounds(component: PrecreaseComponent): ModelBounds | null {
  if (component.outline.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of component.outline) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Whether two sheet boxes name the same sheet, to within `relativeSlack` of the
 * sheet's size.
 *
 * The default is for two boxes from the same analysis of the same creases,
 * which agree to the last bit unless the sheet moved; it only absorbs a JSON
 * round trip of the numbers. A box read back from a file another build wrote
 * is matched looser (`locateSheet`), since a change to how the analysis finds
 * a sheet's corners may move them by its own tolerance.
 */
export function sameSheetBounds(a: ModelBounds, b: ModelBounds, relativeSlack = 1e-9): boolean {
  const scale = Math.max(1, Math.abs(a.maxX - a.minX), Math.abs(a.maxY - a.minY));
  const slack = scale * relativeSlack;
  return (
    Math.abs(a.minX - b.minX) <= slack &&
    Math.abs(a.minY - b.minY) <= slack &&
    Math.abs(a.maxX - b.maxX) <= slack &&
    Math.abs(a.maxY - b.maxY) <= slack
  );
}

/**
 * Whether two frames are the same frame: the origin to within a billionth of
 * the sheet, the axes and the size alike. Two sheets can share a box — a
 * square and the diamond on its edge midpoints — but never a frame.
 */
export function sameSheetFrame(a: PrecreaseFrame, b: PrecreaseFrame): boolean {
  const scale = Math.max(1, Math.abs(a.width), Math.abs(a.height));
  const near = (x: number, y: number, unit: number) => Math.abs(x - y) <= unit * 1e-9;
  return (
    near(a.origin[0], b.origin[0], scale) &&
    near(a.origin[1], b.origin[1], scale) &&
    near(a.x_axis[0], b.x_axis[0], 1) &&
    near(a.x_axis[1], b.x_axis[1], 1) &&
    near(a.y_axis[0], b.y_axis[0], 1) &&
    near(a.y_axis[1], b.y_axis[1], 1) &&
    near(a.width, b.width, scale) &&
    near(a.height, b.height, scale)
  );
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

/**
 * A sheet drawn to fit `size`, in its own coordinates: the component's lines
 * read out of the transport — its border, its creases and its aux lines — then
 * the shared fit (`fitSheetThumbnail`).
 */
export function sheetThumbnail(
  geometry: CpGeometryTransport,
  component: PrecreaseComponent,
  size = 100
): SheetThumbnail | null {
  const endpoints = geometry.segEndpoints;
  const attr = geometry.segAttr;
  const strokes: SheetStroke[] = [];
  const add = (index: number, role: SheetStrokeRole) => {
    const base = index * 4;
    if (base + 3 >= endpoints.length) return;
    strokes.push({
      x1: endpoints[base],
      y1: endpoints[base + 1],
      x2: endpoints[base + 2],
      y2: endpoints[base + 3],
      role,
    });
  };
  for (const index of component.border_segment_indices) add(index, 'edge');
  for (const index of component.segment_indices) add(index, creaseRoleAt(attr, index));
  for (const index of component.aux_segment_indices) add(index, 'aux');
  return fitSheetThumbnail(strokes, size);
}
