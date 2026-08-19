/**
 * Reader for Oriedita's `.oriconfig` export — the zip of the app config directory
 * written by `FileSaveServiceImpl.exportPref`.
 *
 * The one thing this file exists to get right: Java's `ZipOutputStream` sets
 * general-purpose **bit 3** (measured flags `0x0808` on a real export), which
 * moves the sizes out of the local file header and into a trailing data
 * descriptor. Every local header in a Java archive therefore reports a
 * compressed size of **zero**. A reader that walks local headers and believes
 * their size fields inflates nothing at all and hands back empty files without
 * raising anything — so this reads the central directory, where the real sizes
 * live, and consults the local header only for the two variable-length fields
 * that say where the entry's data starts.
 *
 * Zip64 is not handled: an exported app config directory is a few kilobytes, and
 * its sentinel values fail the bounds checks below as a damaged archive.
 */

/** Entry names the settings import consumes. */
const WANTED_ENTRY_NAMES = ['config.json', 'hotkey.properties'] as const;

export type OriconfigEntryName = (typeof WANTED_ENTRY_NAMES)[number];

export type OriconfigArchiveFailureReason =
  /** No end-of-central-directory record anywhere in the tail — this is not a zip. */
  | 'not-a-zip'
  /** A zip whose own offsets and lengths do not fit inside the bytes we were given. */
  | 'truncated'
  /** The runtime has no `DecompressionStream`, and the archive needs one. */
  | 'no-decompression-support'
  /**
   * An entry did not decode to the bytes the archive says it holds — it would not
   * inflate, ran past its declared size, or failed its CRC.
   */
  | 'entry-failed';

/** An entry we wanted but cannot decode, because its compression method is one we do not implement. */
export interface UnsupportedOriconfigEntry {
  name: OriconfigEntryName;
  method: number;
}

export interface OriconfigArchiveRead {
  ok: true;
  entries: Map<OriconfigEntryName, string>;
  unsupportedEntries: UnsupportedOriconfigEntry[];
}

export interface OriconfigArchiveFailure {
  ok: false;
  reason: OriconfigArchiveFailureReason;
}

export type OriconfigArchiveResult = OriconfigArchiveRead | OriconfigArchiveFailure;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

const EOCD_SIZE = 22;
const CENTRAL_RECORD_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const MAX_ZIP_COMMENT_LENGTH = 0xffff;

const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

/**
 * Thrown by the bounds-checked reads below and caught once, at the only exported
 * function, where it becomes a `truncated` result. Every offset in a zip is a
 * claim the file makes about itself; checking each one inline would bury the
 * structure of the walk in null handling.
 */
class DamagedArchiveError extends Error {}

function readUint16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) throw new DamagedArchiveError();
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) throw new DamagedArchiveError();
  return view.getUint32(offset, true);
}

function readBytes(bytes: Uint8Array, offset: number, length: number): Uint8Array {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength)
    throw new DamagedArchiveError();
  return bytes.subarray(offset, offset + length);
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

/**
 * The zip's own integrity field. Deflate is not self-checking: a flipped bit in
 * the compressed stream usually still inflates, to *different* bytes and often at
 * the same length — measured 718 of 821 single-bit corruptions of the real sample
 * archive produce a well-formed but wrong `hotkey.properties`. Without this the
 * import silently rebinds the user's keyboard from a damaged download.
 */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isWantedEntryName(name: string): name is OriconfigEntryName {
  return (WANTED_ENTRY_NAMES as readonly string[]).includes(name);
}

/**
 * Locate the end-of-central-directory record by scanning backwards.
 *
 * The signature can also occur by chance inside compressed data, so a candidate
 * only counts when its comment length is consistent with the bytes that follow
 * it — which is what makes scanning from the end safe rather than merely likely.
 */
function findEndOfCentralDirectory(view: DataView): number | null {
  const earliest = Math.max(0, view.byteLength - EOCD_SIZE - MAX_ZIP_COMMENT_LENGTH);
  for (let offset = view.byteLength - EOCD_SIZE; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + EOCD_SIZE + commentLength <= view.byteLength) return offset;
  }
  return null;
}

interface LocatedEntry {
  name: OriconfigEntryName;
  method: number;
  data: Uint8Array;
  /** The central directory's claim about the decoded entry — checked, never trusted. */
  uncompressedSize: number;
  crc: number;
}

/**
 * Walk the central directory and slice out the compressed bytes of the entries we
 * want. Entries we do not want are stepped over without being read: the archive is
 * the whole app config directory, so unrelated bundles ride along, and a bundle we
 * never use has no business failing the import.
 */
function locateWantedEntries(
  view: DataView,
  bytes: Uint8Array,
  eocdOffset: number,
): LocatedEntry[] {
  const entryCount = readUint16(view, eocdOffset + 10);
  let recordOffset = readUint32(view, eocdOffset + 16);
  const located: LocatedEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(view, recordOffset) !== CENTRAL_FILE_SIGNATURE) throw new DamagedArchiveError();
    const method = readUint16(view, recordOffset + 10);
    const crc = readUint32(view, recordOffset + 16);
    const compressedSize = readUint32(view, recordOffset + 20);
    const uncompressedSize = readUint32(view, recordOffset + 24);
    const nameLength = readUint16(view, recordOffset + 28);
    const extraLength = readUint16(view, recordOffset + 30);
    const commentLength = readUint16(view, recordOffset + 32);
    const localHeaderOffset = readUint32(view, recordOffset + 42);
    const name = decodeText(readBytes(bytes, recordOffset + CENTRAL_RECORD_SIZE, nameLength));

    if (isWantedEntryName(name)) {
      if (readUint32(view, localHeaderOffset) !== LOCAL_FILE_SIGNATURE)
        throw new DamagedArchiveError();
      // The local header repeats the name and extra fields at its own lengths, and
      // they genuinely differ from the central record's — Info-ZIP writes a longer
      // timestamp extra field locally than it does centrally.
      const localNameLength = readUint16(view, localHeaderOffset + 26);
      const localExtraLength = readUint16(view, localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + LOCAL_HEADER_SIZE + localNameLength + localExtraLength;
      located.push({
        name,
        method,
        data: readBytes(bytes, dataOffset, compressedSize),
        uncompressedSize,
        crc,
      });
    }

    recordOffset += CENTRAL_RECORD_SIZE + nameLength + extraLength + commentLength;
  }

  return located;
}

/**
 * Inflate at most `limit` bytes, where the limit is the size the central directory
 * declared for this entry.
 *
 * Reading the whole stream and checking the length afterwards is not equivalent.
 * Deflate's expansion ratio is unbounded, so a 600 KB `.oriconfig` can declare a
 * 40-byte entry and inflate to 600 MB — enough to exhaust a browser tab, and
 * enough that `TextDecoder` throws `Cannot create a string longer than
 * 0x1fffffe8 characters` straight out of this module. Stopping at the declared
 * size makes the archive's own numbers the bound.
 */
async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array | null> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      // A DecompressionStream only takes views onto a plain ArrayBuffer, so the
      // entry's slice is copied out of whatever buffer the caller handed us.
      controller.enqueue(new Uint8Array(data));
      controller.close();
    },
  });

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  } catch {
    return null;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  if (total !== limit) return null;

  const inflated = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    inflated.set(chunk, at);
    at += chunk.byteLength;
  }
  return inflated;
}

/**
 * Read `config.json` and `hotkey.properties` out of an `.oriconfig` archive.
 *
 * A missing entry is not a failure — an export from a user who never edited a
 * hotkey has no `hotkey.properties` at all — so callers should treat the returned
 * map as the answer to "what did this archive actually carry".
 */
export async function readOriconfigArchive(
  data: ArrayBuffer | Uint8Array,
): Promise<OriconfigArchiveResult> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset === null) return { ok: false, reason: 'not-a-zip' };

  let located: LocatedEntry[];
  try {
    located = locateWantedEntries(view, bytes, eocdOffset);
  } catch (error) {
    if (error instanceof DamagedArchiveError) return { ok: false, reason: 'truncated' };
    throw error;
  }

  if (
    located.some((entry) => entry.method === METHOD_DEFLATED) &&
    typeof DecompressionStream === 'undefined'
  ) {
    return { ok: false, reason: 'no-decompression-support' };
  }

  const entries = new Map<OriconfigEntryName, string>();
  const unsupportedEntries: UnsupportedOriconfigEntry[] = [];

  for (const entry of located) {
    if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATED) {
      unsupportedEntries.push({ name: entry.name, method: entry.method });
      continue;
    }
    const decoded =
      entry.method === METHOD_STORED
        ? entry.data
        : await inflateRaw(entry.data, entry.uncompressedSize);
    if (
      decoded === null ||
      decoded.byteLength !== entry.uncompressedSize ||
      crc32(decoded) !== entry.crc
    ) {
      return { ok: false, reason: 'entry-failed' };
    }
    entries.set(entry.name, decodeText(decoded));
  }

  return { ok: true, entries, unsupportedEntries };
}
