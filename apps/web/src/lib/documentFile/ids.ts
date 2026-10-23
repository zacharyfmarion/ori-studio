/**
 * Makes the id of a new thing in a document from the kind of thing it is —
 * a `step`, an `annotation`. Passed in wherever ids are made, so a test can
 * make the same ids on every run.
 */
export type IdFactory<P extends string> = (prefix: P) => string;

/** `<prefix>-<uuid>`: an id no other document, nor any copy of this one, holds. */
export const randomId: IdFactory<string> = (prefix) => `${prefix}-${crypto.randomUUID()}`;
