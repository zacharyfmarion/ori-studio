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
import { SEG_ATTR_STRIDE, type CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { HINT_MOUNTAIN, HINT_VALLEY } from '../../lib/foldAngle';
import {
  fitSheetThumbnail,
  type SheetStroke,
  type SheetStrokeRole,
  type SheetThumbnail,
} from '../sheets/sheetThumbnail';
import { sheetOutline } from './referencesViewGeometry';
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

/** Oriedita's colour codes, as `LINE_COLOR_BY_NUMBER` names them. */
const CP_ANGLE = -2;
const CP_BLACK = 0;
const CP_MOUNTAIN = 1;
const CP_VALLEY = 2;
const CP_CYAN = 3;
const CP_GREY = 10;

/**
 * What a crease is on the paper, from its colour: the kernel's own FOLD
 * reading (`fold_assignment_for_line_color`) — black is the paper's edge, red
 * and blue the folds, cyan through grey the aux lines it exports as `F` — so a
 * card here and the Simulate rail's card of the same pattern agree. A crease
 * folded to an angle takes its hinted direction.
 *
 * Read from the raw number rather than through `lineColorName`, which throws on
 * a code outside its table: a thumbnail that cannot read a colour should draw
 * an unassigned line, not take the sidebar down. The planner's own steps do
 * not come through here — the crate settles their direction and `Step`
 * carries it (plan D24). This is the picker's own reading of a raw pattern,
 * which has no plan yet.
 */
function strokeRole(attr: Int32Array, index: number): SheetStrokeRole {
  // An unreadable slot is no colour at all, and falls through to unassigned.
  const color = attr[index * SEG_ATTR_STRIDE] ?? Number.NaN;
  if (color === CP_BLACK) return 'edge';
  if (color === CP_MOUNTAIN) return 'mountain';
  if (color === CP_VALLEY) return 'valley';
  if (color >= CP_CYAN && color <= CP_GREY) return 'aux';
  if (color === CP_ANGLE) {
    const hint = attr[index * SEG_ATTR_STRIDE + 4];
    if (hint === HINT_MOUNTAIN) return 'mountain';
    if (hint === HINT_VALLEY) return 'valley';
  }
  return 'unassigned';
}

/**
 * A sheet drawn to fit `size`, in its own coordinates: the component's lines
 * read out of the transport — its border, its creases and its aux lines — on
 * the paper the canvas fills ({@link sheetOutline}), then the shared fit
 * (`fitSheetThumbnail`).
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
  for (const index of component.segment_indices) add(index, strokeRole(attr, index));
  for (const index of component.aux_segment_indices) add(index, 'aux');
  const outline = sheetOutline(geometry, sheetBorderLineIds(component));
  return fitSheetThumbnail(
    strokes,
    size,
    outline.length >= 3 ? [outline.map(({ x, y }) => [x, y] as const)] : []
  );
}
