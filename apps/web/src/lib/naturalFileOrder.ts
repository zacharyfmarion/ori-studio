/**
 * Files in the order a person numbering them reads them: `step-2` before
 * `step-10`, `Step-1` beside `step-1`, whatever order the platform's picker or
 * a drop handed them over in. Names that differ only in case keep a fixed
 * order between them, and identical names keep the order they came in.
 *
 * Every batch import orders its files with this: the Diagram's step import
 * and picture upload, and Fold's Import CP.
 */
export function naturalFileOrder<T extends { name: string }>(files: readonly T[]): T[] {
  const order = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  // `sort` is stable, so identical names stay in the order they arrived.
  return [...files].sort((a, b) => order.compare(a.name, b.name) || a.name.localeCompare(b.name));
}
