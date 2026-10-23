/**
 * A newer build's value: well formed, but past what this build reads — a
 * kind, a field or an enumerated value it has no name for, or a number past
 * the ranges it holds. A reader returns it beside `null`, which is damage, so
 * its caller can tell the two apart: damage is dropped, and news is carried
 * verbatim and written back unchanged.
 */
export const NEWER: unique symbol = Symbol('newer');

/**
 * A record with a key outside `known`: a field a newer build wrote. A reading
 * built from named fields would drop it on the way in and lose it on the way
 * out, so the record is a newer build's, whole.
 */
export function hasNewerKey(value: Record<string, unknown>, known: ReadonlySet<string>): boolean {
  return Object.keys(value).some((key) => !known.has(key));
}
