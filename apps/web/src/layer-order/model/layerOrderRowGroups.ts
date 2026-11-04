/**
 * How the constraints list groups its constraints into rows (D21, "The
 * list"): stored one constraint each, as the record and the engine hold
 * them, and shown one row per subject and verb, "D in front of H, K".
 *
 * - A row sits at the place of its earliest constraint, and a later Add for
 *   the same subject and verb joins it. It goes as a whole, by its trash
 *   ({@link withoutRow}): a row has no per-object remove (D21, your words
 *   after trying it, 2026-10-26).
 * - A row is keyed by its subject and its verb as read ({@link LayerRowKey}),
 *   so its key survives the removal of any of its constraints and a turn of
 *   the figure: the verb is read from the front here, which groups exactly as
 *   the side shown does, since turning over flips every row's verb at once.
 *   It is not the sign: one verb from one side is either sign, by how each
 *   object faces, and grouping by sign would split "D in front of H, K"
 *   whenever H and K face different ways.
 * - Committed and carried rows never share a row. Carried rows group by what
 *   the restore found: the ones that can still apply (intact or clashing)
 *   together, since a clash is marked on each constraint as it is for
 *   committed rows; the others only within one status, so a row never
 *   mixes reasons. A carried row whose subject or object no longer exists,
 *   whose two faces are one face now, or whose reason names its own object
 *   (an ambiguous object) stays a row of its own.
 *
 * Pure: no React, no store, no engine calls.
 */
import { constraintVerb, type LayerConstraint, type LayerFace } from './layerOrderEngineFacts';
import type { LayerCarriedRow, LayerFigure, LayerRow, LayerRows } from './layerOrderState';

/** A row of the list's key: its kind, subject and verb as read, or a stored row's own id for one that stays alone. */
export type LayerRowKey = string;

/** One row of the list: one stored constraint, or several with one subject and verb. */
export interface LayerRowGroup {
  readonly key: LayerRowKey;
  readonly kind: LayerRow['kind'];
  /** The stored constraints it shows, in their objects' letter order. */
  readonly members: readonly LayerRow[];
}

/** A row's subject, object and sign, whichever kind it is; a face that no longer exists is null. */
export function rowParts(row: LayerRow): { subject: LayerFace | null; object: LayerFace | null; sign: 1 | -1 } {
  if (row.kind === 'committed') {
    const [subject, object, sign] = row.constraint;
    return { subject, object, sign };
  }
  const { subject, object, sign } = row.facts;
  return { subject, object, sign };
}

function verbAsRead(constraint: LayerConstraint, figure: LayerFigure | null): string {
  return constraintVerb(constraint, 'front', figure?.frontUp[constraint[1]] === 1);
}

/** What the restore found, as rows group by it: the rows that can still apply share one class. */
function carriedClass(row: LayerCarriedRow): string {
  const { status } = row.facts;
  if (status.status === 'intact' || status.status === 'clashing') return 'applies';
  return status.status === 'gone' ? `gone_${status.cause}` : status.status;
}

function carriedKey(row: LayerCarriedRow, figure: LayerFigure | null): LayerRowKey {
  const { status, subject, object, sign, subjectState } = row.facts;
  const alone =
    subject === null ||
    object === null ||
    subject === object ||
    (status.status === 'ambiguous' && subjectState !== 'ambiguous');
  if (alone) return `carried:row:${row.id}`;
  return `carried:${carriedClass(row)}:${subject}:${verbAsRead([subject, object, sign], figure)}`;
}

/** The key of the committed row `constraint` would show in: its subject and its verb as read. */
export function constraintRowKey(constraint: LayerConstraint, figure: LayerFigure | null): LayerRowKey {
  return `committed:${constraint[0]}:${verbAsRead(constraint, figure)}`;
}

/** The key of the row a stored constraint shows in. */
export function rowKeyOf(row: LayerRow, figure: LayerFigure | null): LayerRowKey {
  return row.kind === 'carried' ? carriedKey(row, figure) : constraintRowKey(row.constraint, figure);
}

/** The list's rows, in its order: the committed ones, then the carried ones, each at its earliest constraint's place. */
export function rowGroupsOf(rows: LayerRows, figure: LayerFigure | null): LayerRowGroup[] {
  const groups: { key: LayerRowKey; kind: LayerRow['kind']; members: LayerRow[] }[] = [];
  const byKey = new Map<LayerRowKey, (typeof groups)[number]>();
  for (const row of [...rows.committed, ...rows.carried]) {
    const key = rowKeyOf(row, figure);
    const found = byKey.get(key);
    if (found) {
      found.members.push(row);
      continue;
    }
    const group = { key, kind: row.kind, members: [row] };
    groups.push(group);
    byKey.set(key, group);
  }
  const rank = (row: LayerRow) => {
    const { object } = rowParts(row);
    return object === null ? Infinity : (figure?.letterRank[object] ?? object);
  };
  return groups.map((group) =>
    group.members.length < 2
      ? group
      : { ...group, members: [...group.members].sort((a, b) => rank(a) - rank(b) || a.id - b.id) }
  );
}

/** The row with `key`, or null. */
export function rowGroupByKey(groups: readonly LayerRowGroup[], key: LayerRowKey | null): LayerRowGroup | null {
  if (key === null) return null;
  return groups.find((group) => group.key === key) ?? null;
}

/** The rows without the list row `key`: every stored constraint it shows goes, and the other rows keep their places. */
export function withoutRow(rows: LayerRows, key: LayerRowKey, figure: LayerFigure | null): LayerRows {
  const stays = <T extends LayerRow>(row: T) => rowKeyOf(row, figure) !== key;
  return { committed: rows.committed.filter(stays), carried: rows.carried.filter(stays) };
}
