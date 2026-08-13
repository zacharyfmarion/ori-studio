import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A zip writer with every field left under the test's control.
 *
 * The committed `.oriconfig` fixtures are real Java and Info-ZIP output, which is
 * the point of them — but a fixture cannot be asked "what if the central directory
 * lied about this one number". This builds that archive on demand, so a bounds or
 * integrity check can be tested against the exact malformation it exists to catch
 * rather than against a hand-hexed blob nobody can re-derive later.
 */
export interface TestZipEntry {
  name: string;
  /** Uncompressed content. */
  data: string | Uint8Array;
  /** 8 (deflate, default), 0 (stored), or anything else to fake an unsupported method. */
  method?: number;
  /** Java's `ZipOutputStream` sets general-purpose bit 3, zeroing the local sizes. */
  dataDescriptor?: boolean;
  /** Written into the local header only, so it can disagree with the central record. */
  localExtra?: Uint8Array;
  centralExtra?: Uint8Array;
  /** Overrides for the central directory's claims about the entry. */
  compressedSizeOverride?: number;
  uncompressedSizeOverride?: number;
  crcOverride?: number;
  localHeaderOffsetOverride?: number;
  /** Replaces the entry's payload without touching the sizes derived from `data`. */
  payloadOverride?: Uint8Array;
}

export interface TestZipOptions {
  comment?: string;
  centralDirectoryOffsetOverride?: number;
  entryCountOverride?: number;
}

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const EOCD_SIGNATURE = 0x06054b50;

function encode(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value;
}

export function buildZip(entries: TestZipEntry[], options: TestZipOptions = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  const centralRecords: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = encode(entry.data);
    const method = entry.method ?? 8;
    const payload =
      entry.payloadOverride ??
      (method === 8 ? new Uint8Array(deflateRawSync(Buffer.from(raw))) : raw);
    const checksum = crc32(Buffer.from(raw)) >>> 0;

    const nameBytes = new TextEncoder().encode(entry.name);
    const localExtra = entry.localExtra ?? new Uint8Array(0);
    const centralExtra = entry.centralExtra ?? new Uint8Array(0);
    const flags = entry.dataDescriptor ? 0x0808 : 0x0800;

    const local = new Uint8Array(30 + nameBytes.length + localExtra.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL_SIGNATURE, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flags, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, entry.dataDescriptor ? 0 : checksum, true);
    localView.setUint32(18, entry.dataDescriptor ? 0 : payload.length, true);
    localView.setUint32(22, entry.dataDescriptor ? 0 : raw.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, localExtra.length, true);
    local.set(nameBytes, 30);
    local.set(localExtra, 30 + nameBytes.length);

    const localHeaderOffset = offset;
    parts.push(local, payload);
    offset += local.length + payload.length;

    if (entry.dataDescriptor) {
      const descriptor = new Uint8Array(16);
      const descriptorView = new DataView(descriptor.buffer);
      descriptorView.setUint32(0, DESCRIPTOR_SIGNATURE, true);
      descriptorView.setUint32(4, checksum, true);
      descriptorView.setUint32(8, payload.length, true);
      descriptorView.setUint32(12, raw.length, true);
      parts.push(descriptor);
      offset += descriptor.length;
    }

    const central = new Uint8Array(46 + nameBytes.length + centralExtra.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, CENTRAL_SIGNATURE, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, flags, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, entry.crcOverride ?? checksum, true);
    centralView.setUint32(20, entry.compressedSizeOverride ?? payload.length, true);
    centralView.setUint32(24, entry.uncompressedSizeOverride ?? raw.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, centralExtra.length, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint32(42, entry.localHeaderOffsetOverride ?? localHeaderOffset, true);
    central.set(nameBytes, 46);
    central.set(centralExtra, 46 + nameBytes.length);
    centralRecords.push(central);
  }

  const centralDirectoryOffset = offset;
  let centralDirectorySize = 0;
  for (const record of centralRecords) {
    parts.push(record);
    centralDirectorySize += record.length;
  }

  const comment = new TextEncoder().encode(options.comment ?? '');
  const eocd = new Uint8Array(22 + comment.length);
  const eocdView = new DataView(eocd.buffer);
  const count = options.entryCountOverride ?? centralRecords.length;
  eocdView.setUint32(0, EOCD_SIGNATURE, true);
  eocdView.setUint16(8, count, true);
  eocdView.setUint16(10, count, true);
  eocdView.setUint32(12, centralDirectorySize, true);
  eocdView.setUint32(16, options.centralDirectoryOffsetOverride ?? centralDirectoryOffset, true);
  eocdView.setUint16(20, comment.length, true);
  eocd.set(comment, 22);
  parts.push(eocd);

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const archive = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    archive.set(part, at);
    at += part.length;
  }
  return archive;
}
