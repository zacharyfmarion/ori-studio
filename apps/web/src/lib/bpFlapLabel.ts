/**
 * Default display labels for BP flaps (and their dual tree leaves).
 *
 * A flap's label is drawn on the same canvas as the edge-length numbers, so a
 * numeric default reads as just another length. Fall back to letters instead —
 * A…Z, then AA, AB, … — which stay short at any zoom and can't be mistaken for
 * a measurement. A flap the user has named keeps that name.
 *
 * The label is a pure function of the flap id (which is its tree vertex id), so
 * it is stable across the tree and packing panes and unique per flap. It is
 * display-only: nothing here is persisted to `.bps`.
 */

/** Excel-style letters for a zero-based index: 0→A, 25→Z, 26→AA, 27→AB. */
export function bpDefaultFlapLabel(id: number): string {
  let index = Number.isFinite(id) ? Math.max(0, Math.trunc(id)) : 0;
  let label = '';
  do {
    label = String.fromCharCode(65 + (index % 26)) + label;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return label;
}

/** A flap's display label: its name when set, otherwise its letter default. */
export function bpFlapLabel(id: number, name: string): string {
  return name.trim() || bpDefaultFlapLabel(id);
}
