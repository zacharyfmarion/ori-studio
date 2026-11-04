const MiB = 1024 * 1024;

/**
 * What a Defox import admits. Defox saves a project indented, so a file is
 * about three times the JSON it holds: the file is read whole, but only what
 * it holds is parsed and kept. Its bytes move to the import worker rather than
 * being copied, and are compacted where they lie, so a file at these limits
 * takes no more memory than one at the earlier 64 MiB file limit, which was
 * held four times over: as bytes and as text on the main thread, as the
 * worker's copy of the text, and re-encoded there to be measured.
 */
export const DEFOX_LIMITS = {
  /** The file as saved, indentation and all. */
  fileBytes: 192 * MiB,
  /** Its JSON without the whitespace between tokens. */
  contentBytes: 64 * MiB,
  /** One step's kept saved state, as a string; a longer one is a newer build's. */
  snapshotLength: 2 * MiB,
  /** Every step's CP, picture and saved state, as two-byte strings. */
  outputBytes: 128 * MiB,
  /** How long opening a project may take, and then drawing each of its steps. */
  renderMs: 30_000,
} as const;
