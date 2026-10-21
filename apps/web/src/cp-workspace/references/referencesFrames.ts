/**
 * The References workspace's sheets — what it lists, picks between and plans —
 * read from the CP kernel's sheet index
 * (`implementation-plans/large-document-open-and-select.md`, 2.2).
 *
 * The index (`sheets/cpSheetIndex`) decides what a sheet is and which lines it
 * holds, so References lists the sheets the other workspaces list. The planner
 * frames each outline (`outlineComponents`: three milliseconds for 204 sheets)
 * and does its expensive work — a sheet's creases merged into lines, their
 * exactness probed — for one sheet at a time: the planner for the sheet being
 * planned (`plannerCreateForSheet`), and {@link ensureReferencesSheetDetail}
 * for a crease picked in Find. It used to analyse every sheet of the canvas on
 * every visit, and again for every plan: 3.5 s and 1.5 s on a canvas of 204
 * sheets.
 *
 * So a listed sheet carries its outline, its frame or refusal, and its lines
 * split as the planner splits them — border, creases, aux lines — and nothing
 * the merge or the probe makes: `unit_segments`, `aux_unit_segments` and
 * `merged_lines` are empty and `exactness` is null until the detail is asked
 * for. Its id is the index's: the sheet's place in reading order, top left
 * first.
 *
 * With no border line on the canvas at all, the pattern is planned on the
 * default paper, as it always was (`paperFallbackRect`).
 */
import { bucketCount, COUNT_BUCKETS } from '../../analytics';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { SEG_ATTR_STRIDE } from '../../engine/oristudioCpGeometry';
import type { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { reportError } from '../../monitoring';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { getPrecreaseClient } from '../../store/workspaceStore/precreaseRuntime';
import { ensureCpSheetIndex } from '../sheets/cpSheetIndex';
import {
  paperFallbackRect,
  type PrecreaseComponent,
  type PrecreaseTolerances,
  type PrecreaseWarning,
  type SheetAnalysis,
} from './sheetFrames';
import { referencesRevisionKey } from './useReferencesView';

/** A line as the planner splits a sheet's lines (`LineKind::from_color`). */
type LineRole = 'border' | 'crease' | 'aux';

function roleOf(color: number): LineRole {
  if (color === 0) return 'border';
  if (color === 1 || color === 2 || color < 0) return 'crease';
  return 'aux';
}

/**
 * Whether line `line` has a position: all four of its coordinates finite. One
 * without is never drawn, and the planner rejects any input that holds one.
 */
function isPlaced(geometry: CpGeometryTransport, line: number): boolean {
  const ends = geometry.segEndpoints;
  for (let at = line * 4; at < line * 4 + 4; at += 1) {
    if (!Number.isFinite(ends[at])) return false;
  }
  return true;
}

/**
 * The sheets of `index`, each framed (`outlines`, one per sheet, in the
 * index's order) and given its lines out of `geometry`, which must be the
 * geometry the index was built from.
 *
 * An aux line is only ever drawn in a frame, so a refused sheet lists none. A
 * crease in no sheet is reported unassigned; a border line in none is a border
 * that does not close, which is no sheet and nothing to report. A line with no
 * position is left out of every sheet and reported as that, so the sheets
 * around it can still be planned.
 */
export function referencesFramesFromIndex(
  index: CpSheetIndex,
  geometry: CpGeometryTransport,
  outlines: readonly PrecreaseComponent[],
  tolerances: PrecreaseTolerances
): SheetAnalysis {
  const components = outlines.map(listedSheet);
  const sheetOf = index.transport.lineSheet;
  const attr = geometry.segAttr;
  const count = geometry.segEndpoints.length / 4;
  const unassigned: number[] = [];
  let unplaced = 0;
  for (let line = 0; line < count; line += 1) {
    if (!isPlaced(geometry, line)) {
      unplaced += 1;
      continue;
    }
    const role = roleOf(attr[line * SEG_ATTR_STRIDE]);
    const component = components[sheetOf[line]];
    if (!component) {
      if (role === 'crease') unassigned.push(line);
      continue;
    }
    if (role === 'border') component.border_segment_indices.push(line);
    else if (role === 'crease') component.segment_indices.push(line);
    else if (component.frame) component.aux_segment_indices.push(line);
  }
  const warnings: PrecreaseWarning[] = [];
  if (unassigned.length > 0) warnings.push({ kind: 'unassigned_segments', count: unassigned.length });
  if (unplaced > 0) warnings.push({ kind: 'non_finite_segments', count: unplaced });
  return analysisOf(components, unassigned, warnings, count, tolerances);
}

/**
 * The canvas as one sheet of the default paper, for a pattern with no border
 * line at all: every line on it with a position, as the planner places lines on
 * a sheet it found itself. `paper` is that paper framed.
 */
export function referencesFallbackFrames(
  geometry: CpGeometryTransport,
  paper: PrecreaseComponent,
  tolerances: PrecreaseTolerances
): SheetAnalysis {
  const sheet = { ...listedSheet(paper), id: 0, is_fallback: true };
  const attr = geometry.segAttr;
  const count = geometry.segEndpoints.length / 4;
  let unplaced = 0;
  for (let line = 0; line < count; line += 1) {
    if (!isPlaced(geometry, line)) unplaced += 1;
    else if (roleOf(attr[line * SEG_ATTR_STRIDE]) === 'aux') sheet.aux_segment_indices.push(line);
    else sheet.segment_indices.push(line);
  }
  const [x0, y0, x1, y1] = paperFallbackRect();
  const warnings: PrecreaseWarning[] = [{ kind: 'no_border_fallback', paper: [x0, y0, x1, y1] }];
  if (unplaced > 0) warnings.push({ kind: 'non_finite_segments', count: unplaced });
  return analysisOf([sheet], [], warnings, count, tolerances);
}

function listedSheet(outline: PrecreaseComponent): PrecreaseComponent {
  return {
    ...outline,
    border_segment_indices: [],
    segment_indices: [],
    unit_segments: [],
    aux_segment_indices: [],
    aux_unit_segments: [],
    merged_lines: [],
    exactness: null,
  };
}

function analysisOf(
  components: PrecreaseComponent[],
  unassigned: number[],
  warnings: PrecreaseWarning[],
  count: number,
  tolerances: PrecreaseTolerances
): SheetAnalysis {
  return {
    components,
    unassigned_segments: unassigned,
    warnings,
    segment_count: count,
    tol: tolerances.tol,
    snap_radius: tolerances.snap_radius,
  };
}

function hasBorder(geometry: CpGeometryTransport): boolean {
  const attr = geometry.segAttr;
  const count = geometry.segEndpoints.length / 4;
  for (let line = 0; line < count; line += 1) {
    if (attr[line * SEG_ATTR_STRIDE] === 0 && isPlaced(geometry, line)) return true;
  }
  return false;
}

/** A sheet's lines as the planner's worker takes them (`plannerCreateForSheet`). */
export interface ReferencesSheetLines {
  /** The outline, `[x, y, …]`. */
  outline: Float64Array;
  /** `[x1, y1, x2, y2, …]` in model space. */
  segments: Float64Array;
  /** One Oriedita colour code per segment. */
  colors: Int32Array;
  /** Each segment's 0-based number in the document. */
  indices: Uint32Array;
}

/** Every line of a listed sheet — border, creases and aux lines — out of `geometry`. */
export function referencesSheetLines(
  geometry: CpGeometryTransport,
  component: PrecreaseComponent
): ReferencesSheetLines {
  const ids = [
    ...component.border_segment_indices,
    ...component.segment_indices,
    ...component.aux_segment_indices,
  ].sort((a, b) => a - b);
  const segments = new Float64Array(ids.length * 4);
  const colors = new Int32Array(ids.length);
  ids.forEach((id, i) => {
    segments.set(geometry.segEndpoints.subarray(id * 4, id * 4 + 4), i * 4);
    colors[i] = geometry.segAttr[id * SEG_ATTR_STRIDE];
  });
  return {
    outline: Float64Array.from(component.outline.flat()),
    segments,
    colors,
    indices: Uint32Array.from(ids),
  };
}

/** The frames of one revision of the creases: what the workspace lists. */
export interface ReferencesFrames {
  revision: string;
  analysis: SheetAnalysis;
}

/**
 * The sheets of the open crease pattern, as References lists them; null with no
 * pattern, or when the index could not be built. One revision at a time, kept:
 * the creases' revision does not change with a selection, and both the panel
 * and a pick ask for the same one.
 */
export function ensureReferencesFrames(
  state: OristudioCpDocumentState | null
): Promise<ReferencesFrames | null> {
  if (!state?.geometry) return Promise.resolve(null);
  const revision = referencesRevisionKey(state);
  if (framesCache?.revision === revision) return framesCache.promise;
  const geometry = state.geometry;
  const promise = (async (): Promise<ReferencesFrames | null> => {
    const index = await ensureCpSheetIndex(state.document);
    if (!index || index.transport.lineSheet.length !== geometry.segEndpoints.length / 4) {
      return null;
    }
    const client = getPrecreaseClient();
    const tolerances = await client.tolerances();
    if (index.sheetCount === 0 && !hasBorder(geometry)) {
      const [x0, y0, x1, y1] = paperFallbackRect();
      const [paper] = await client.outlineComponents(
        Float64Array.from([x0, y0, x1, y0, x1, y1, x0, y1]),
        Uint32Array.from([0, 4])
      );
      return paper
        ? { revision, analysis: referencesFallbackFrames(geometry, paper, tolerances) }
        : null;
    }
    const outlines = await client.outlineComponents(
      index.transport.outlineCoords,
      index.transport.outlineOffsets
    );
    return { revision, analysis: referencesFramesFromIndex(index, geometry, outlines, tolerances) };
  })();
  // A failure is not kept: the next ask tries again.
  framesCache = { revision, promise };
  promise.then(
    (frames) => {
      if (!frames && framesCache?.promise === promise) framesCache = null;
      if (frames) reportUnplacedCreases(state.loadSerial, frames.analysis);
    },
    () => {
      if (framesCache?.promise === promise) framesCache = null;
    }
  );
  return promise;
}

let framesCache: { revision: string; promise: Promise<ReferencesFrames | null> } | null = null;

/**
 * Creases left out for having no position, reported once per document: no
 * tool should write one, so each is a bug somewhere, and the sidebar line alone
 * would hide it. A bucketed count is all that is sent.
 */
function reportUnplacedCreases(loadSerial: number, analysis: SheetAnalysis): void {
  if (reportedLoadSerial === loadSerial) return;
  const unplaced = analysis.warnings.find(
    (warning): warning is Extract<PrecreaseWarning, { kind: 'non_finite_segments' }> =>
      warning.kind === 'non_finite_segments'
  );
  if (!unplaced) return;
  reportedLoadSerial = loadSerial;
  reportError(new Error('References left out creases with non-finite coordinates'), {
    surface: 'references:non-finite-creases',
    handled: true,
    tags: { count_bucket: bucketCount(unplaced.count, COUNT_BUCKETS) },
  });
}

let reportedLoadSerial: number | null = null;

/**
 * The open pattern's sheets for `revision` of its creases; null when they could
 * not be read, or when the pattern has moved on from `revision` — whoever asked
 * for that revision is asking for the next one by then.
 */
export async function referencesFramesOf(revision: string): Promise<SheetAnalysis | null> {
  const frames = await ensureReferencesFrames(useWorkspaceStore.getState().oristudioCpDocument);
  return frames?.revision === revision ? frames.analysis : null;
}

/**
 * One listed sheet with what only the planner's merge and probe make: its
 * creases in the unit frame, merged into lines, their exactness, and its aux
 * lines in the unit frame — for this revision of the creases. Kept for the
 * last few sheets asked about, since a reader picks crease after crease on one.
 */
export function ensureReferencesSheetDetail(
  geometry: CpGeometryTransport,
  revision: string,
  component: PrecreaseComponent
): Promise<PrecreaseComponent> {
  const key = `${revision}#${component.id}`;
  const known = detailCache.get(key);
  if (known) return known;
  const lines = referencesSheetLines(geometry, component);
  const promise = getPrecreaseClient()
    .sheetComponent(component.id, lines.outline, lines.segments, lines.colors, lines.indices)
    .then((analysis) => {
      const [detail] = analysis.components;
      if (!detail) throw new Error(`sheet ${component.id} came back empty`);
      // Listed as the index lists it: the detail adds to the sheet, it does not
      // move it.
      return { ...detail, outline: component.outline, is_fallback: component.is_fallback };
    });
  detailCache.set(key, promise);
  promise.catch(() => detailCache.delete(key));
  while (detailCache.size > DETAIL_SLOTS) {
    const oldest = detailCache.keys().next().value;
    if (oldest === undefined) break;
    detailCache.delete(oldest);
  }
  return promise;
}

const DETAIL_SLOTS = 4;
const detailCache = new Map<string, Promise<PrecreaseComponent>>();

/** Forget every revision's frames and details, and what was reported: for tests. */
export function resetReferencesFrames(): void {
  framesCache = null;
  detailCache.clear();
  reportedLoadSerial = null;
}
