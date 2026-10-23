/**
 * The kit a document stored in the project file is read and written with,
 * by the three rules every such document keeps, so a desktop build that lags
 * the web build never deletes what it cannot show:
 *
 * - **Malformed is dropped.** What does not read is left out, and the rest
 *   of the document opens.
 * - **Unknown is kept.** A kind, a field or a value this build has no name
 *   for is a newer build's ({@link NEWER}, {@link hasNewerKey}): carried
 *   verbatim and written back unchanged ({@link readEntries}).
 * - **A newer document opens read-only**, and is written back as it came
 *   ({@link readVersioned}, {@link writeVersioned}).
 *
 * Only the "is this a newer build's?" machinery is shared; each document
 * keeps its own reading of its own fields. React-free and store-free.
 */
export { readEntries } from './entries';
export { randomId, type IdFactory } from './ids';
export { NEWER, hasNewerKey } from './newer';
export { finiteNumber, isRecord, sameJson } from './values';
export {
  readVersioned,
  writeVersioned,
  type ReadVersioned,
  type ReadVersionedOptions,
  type WriteVersionedOptions,
} from './versioned';
