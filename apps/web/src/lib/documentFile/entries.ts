import { NEWER } from './newer';
import { isRecord } from './values';

/**
 * A list of the entries a document addresses by id — steps, annotations,
 * nodes — read by the file's rules:
 *
 * - **Malformed is dropped.** An entry that is not a record, has no id (a
 *   string, not empty), or that `read` returns `null` for, is left out, and
 *   the rest of the list reads.
 * - **Unknown is kept.** An entry `read` returns {@link NEWER} for is a newer
 *   build's: `carry` makes this build's stand-in for it, which holds the entry
 *   as it came, to be written back unchanged.
 * - **The first id wins.** Two entries with one id would make every edit by
 *   id ambiguous, so a later entry with an id already read is malformed, and
 *   is never read. An entry that was dropped claims no id.
 *
 * A value that is not an array is no entries. Each entry's own fields are
 * `read`'s to judge.
 */
export function readEntries<T>(
  value: unknown,
  read: (id: string, entry: Record<string, unknown>) => T | typeof NEWER | null,
  carry: (id: string, entry: Record<string, unknown>) => T
): T[] {
  if (!Array.isArray(value)) return [];
  const entries: T[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = entry.id;
    if (typeof id !== 'string' || id.length === 0 || ids.has(id)) continue;
    const reading = read(id, entry);
    if (reading === null) continue;
    entries.push(reading === NEWER ? carry(id, entry) : reading);
    ids.add(id);
  }
  return entries;
}
