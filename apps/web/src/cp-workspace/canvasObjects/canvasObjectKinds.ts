import type { WorkspaceState } from '../../store/workspaceStore/types';
import type { CpImage } from '../images/cpImage';
import type { TextAnnotation } from '../annotations/textAnnotation';
import type { CpSuppressionRegion } from '../annotations/suppressionRegion';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import type { InlineSimulation } from '../inlineSimulation/inlineSimulation';
import { imageCanvasObjectKind } from '../images/imageCanvasObject';
import { textCanvasObjectKind } from '../annotations/textCanvasObject';
import { regionCanvasObjectKind } from '../regions/regionCanvasObject';
import { foldedFigureCanvasObjectKind } from '../folded/foldedFigureCanvasObject';
import { inlineSimulationCanvasObjectKind } from '../inlineSimulation/inlineSimulationCanvasObject';

/**
 * Every kind of object the crease-pattern canvas can hold besides creases.
 *
 * A detection solve region is not a kind of its own: it is a `suppressionRegion`
 * whose `solveInput` is attached (`hasAttachedSolveInput`), and the target
 * carries that as `solvable` — Solve is decided by data, never by geometry.
 */
export type CanvasObjectKind =
  | 'image'
  | 'text'
  | 'suppressionRegion'
  | 'folded-figure'
  | 'inline-simulation';

/** The selected object, resolved to its store entry and narrowed by kind. */
export type CanvasObjectTarget =
  | { kind: 'image'; id: string; annotation: CpImage }
  | { kind: 'text'; id: string; annotation: TextAnnotation }
  | { kind: 'suppressionRegion'; id: string; annotation: CpSuppressionRegion; solvable: boolean }
  | { kind: 'folded-figure'; id: string; figure: OristudioCpFoldedFigureEntry }
  | { kind: 'inline-simulation'; id: string; simulation: InlineSimulation };

export type TargetOf<K extends CanvasObjectKind> = Extract<CanvasObjectTarget, { kind: K }>;

/**
 * The store fields whose non-null value means "this kind holds the canvas".
 * Annotation kinds share one; the union is typed against `WorkspaceState` so a
 * new layer widens it by naming its field, and every constant derived below
 * picks the change up without a second edit.
 */
export type CanvasSelectionIdField =
  | 'oristudioCpSelectedAnnotationId'
  | 'oristudioCpActiveFoldedFigureId'
  | 'oristudioCpFocusedInlineSimulationId';

/** The store arrays canvas objects live in. */
export type CanvasEntriesField =
  | 'oristudioCpAnnotations'
  | 'oristudioCpFoldedFigures'
  | 'oristudioCpInlineSimulations';

/** Any entry of any canvas-object array — what a row's `resolve` narrows. */
export type CanvasEntry = WorkspaceState[CanvasEntriesField][number];

/**
 * One row per kind, living beside the kind.
 *
 * The row says which store field holds the kind's selection id and which array
 * holds its entries, so id precedence, entry lookup and the store hook are all
 * derived from the table instead of restating the id fields by hand — the
 * omission that would otherwise let a new kind compile and never resolve.
 */
export interface CanvasObjectKindRow<K extends CanvasObjectKind> {
  kind: K;
  selectionIdField: CanvasSelectionIdField;
  entriesField: CanvasEntriesField;
  /**
   * Narrow one entry to this kind's target, or null. The entry is from the row's
   * own array, but the row still checks its shape: annotation rows share an
   * array and tell each other apart by `kind`.
   */
  resolve(entry: CanvasEntry, id: string): TargetOf<K> | null;
}

/** The mapped `satisfies` makes an unlisted kind a typecheck error. */
export const CANVAS_OBJECT_KINDS = {
  image: imageCanvasObjectKind,
  text: textCanvasObjectKind,
  suppressionRegion: regionCanvasObjectKind,
  'folded-figure': foldedFigureCanvasObjectKind,
  'inline-simulation': inlineSimulationCanvasObjectKind,
} as const satisfies { [K in CanvasObjectKind]: CanvasObjectKindRow<K> };

export type CanvasObjectKindTable = { [K in CanvasObjectKind]: CanvasObjectKindRow<K> };

function rowsOf(kinds: CanvasObjectKindTable): readonly CanvasObjectKindRow<CanvasObjectKind>[] {
  return Object.values(kinds) as CanvasObjectKindRow<CanvasObjectKind>[];
}

function selectionIdFieldsOf(kinds: CanvasObjectKindTable): readonly CanvasSelectionIdField[] {
  const fields: CanvasSelectionIdField[] = [];
  for (const row of rowsOf(kinds)) {
    if (!fields.includes(row.selectionIdField)) fields.push(row.selectionIdField);
  }
  return fields;
}

/**
 * Deduplicated at module load, in table order — which is the precedence the
 * canvas has always had: an annotation, then a folded figure, then a window.
 * The store keeps the fields mutually exclusive, so the order only settles a
 * transient overlap.
 */
export const CANVAS_SELECTION_ID_FIELDS: readonly CanvasSelectionIdField[] =
  selectionIdFieldsOf(CANVAS_OBJECT_KINDS);

/** The slice of store state resolution reads. A type, so tests seed literals. */
export type CanvasSelectionFields = Pick<WorkspaceState, CanvasSelectionIdField | CanvasEntriesField>;

/** The selected canvas object's id, or null when creases or nothing hold the canvas. */
export function selectedCanvasObjectIdOf(
  state: Pick<WorkspaceState, CanvasSelectionIdField>,
  kinds: CanvasObjectKindTable = CANVAS_OBJECT_KINDS
): string | null {
  const fields = kinds === CANVAS_OBJECT_KINDS ? CANVAS_SELECTION_ID_FIELDS : selectionIdFieldsOf(kinds);
  for (const field of fields) {
    const id = state[field];
    if (id !== null) return id;
  }
  return null;
}

export interface CanvasObjectEntryHit {
  entriesField: CanvasEntriesField;
  /** The entry as it sits in its array — a stable reference across foreign drags. */
  entry: CanvasEntry;
}

/** Find the store entry with this id in whichever array holds it. */
export function findCanvasObjectEntry(
  state: Pick<WorkspaceState, CanvasEntriesField>,
  id: string,
  kinds: CanvasObjectKindTable = CANVAS_OBJECT_KINDS
): CanvasObjectEntryHit | null {
  const seen = new Set<CanvasEntriesField>();
  for (const row of rowsOf(kinds)) {
    if (seen.has(row.entriesField)) continue;
    seen.add(row.entriesField);
    const entries: readonly CanvasEntry[] = state[row.entriesField];
    const entry = entries.find((candidate) => candidate.id === id);
    if (entry) return { entriesField: row.entriesField, entry };
  }
  return null;
}

/** Try each row that answers for the entry's array. */
export function resolveCanvasObjectEntry(
  hit: CanvasObjectEntryHit,
  id: string,
  kinds: CanvasObjectKindTable = CANVAS_OBJECT_KINDS
): CanvasObjectTarget | null {
  for (const row of rowsOf(kinds)) {
    if (row.entriesField !== hit.entriesField) continue;
    const target = row.resolve(hit.entry, id);
    if (target) return target;
  }
  return null;
}

export function resolveCanvasObjectById(
  state: CanvasSelectionFields,
  id: string,
  kinds: CanvasObjectKindTable = CANVAS_OBJECT_KINDS
): CanvasObjectTarget | null {
  const hit = findCanvasObjectEntry(state, id, kinds);
  return hit ? resolveCanvasObjectEntry(hit, id, kinds) : null;
}

/**
 * The selected canvas object, or null.
 *
 * Null also for a dangling id — an entry that undo, a delete or a document
 * replacement removed while the selection field still names it — and for a
 * folded figure the kind row declines (an imported or preserved-frame one).
 */
export function resolveSelectedCanvasObject(
  state: CanvasSelectionFields,
  kinds: CanvasObjectKindTable = CANVAS_OBJECT_KINDS
): CanvasObjectTarget | null {
  const id = selectedCanvasObjectIdOf(state, kinds);
  return id === null ? null : resolveCanvasObjectById(state, id, kinds);
}

export function canvasObjectKindOf(
  state: CanvasSelectionFields,
  id: string,
  kinds: CanvasObjectKindTable = CANVAS_OBJECT_KINDS
): CanvasObjectKind | null {
  return resolveCanvasObjectById(state, id, kinds)?.kind ?? null;
}
