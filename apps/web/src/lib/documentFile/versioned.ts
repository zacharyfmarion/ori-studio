import { isRecord } from './values';

/** A document read from a file. */
export interface ReadVersioned<D> {
  document: D;
  /**
   * The file was written by a newer build (`formatVersion` above this one's,
   * or a field of the document this build cannot carry). The document shown
   * is a best-effort reading; nothing may change it, and {@link raw} is what
   * is written back.
   */
  readOnly: boolean;
  /** The value as read, for writing back a read-only document unchanged. */
  raw: Record<string, unknown>;
}

export interface ReadVersionedOptions<D> {
  /** This build's `formatVersion`. */
  version: number;
  /** The document, read leniently: a best-effort reading of any record. */
  read: (value: Record<string, unknown>) => D;
  /**
   * The first field of the document itself that a newer build wrote and this
   * one cannot carry, or `null`; for a format that names its document's
   * fields rather than carrying the ones it does not know. Such a field opens
   * the document read-only, as a newer `formatVersion` does.
   */
  newerField?: (value: Record<string, unknown>) => string | null;
}

/**
 * A versioned document: `null` for a value that is not a record at all — no
 * document — and otherwise its reading, read-only when a newer build wrote it.
 * A `formatVersion` that is not a number reads as 1, the first.
 */
export function readVersioned<D>(
  value: unknown,
  { version, read, newerField }: ReadVersionedOptions<D>
): ReadVersioned<D> | null {
  if (!isRecord(value)) return null;
  const formatVersion = typeof value.formatVersion === 'number' ? value.formatVersion : 1;
  const document = read(value);
  const readOnly = formatVersion > version || (newerField !== undefined && newerField(value) !== null);
  return { document, readOnly, raw: value };
}

export interface WriteVersionedOptions<D> {
  /** This build's `formatVersion`. */
  version: number;
  /** Every field of the document but `formatVersion`, in the order written. */
  write: (document: D) => Record<string, unknown>;
}

/**
 * The value written for a versioned document. A read-only one is written as
 * it was read — the very value, never re-read or rebuilt — and any other with
 * this build's `formatVersion` first, then the fields `write` names.
 */
export function writeVersioned<D>(
  document: D,
  readOnlyRaw: Record<string, unknown> | null,
  { version, write }: WriteVersionedOptions<D>
): Record<string, unknown> {
  return readOnlyRaw ?? { formatVersion: version, ...write(document) };
}
