/**
 * A Pose check's raster as a PNG, for the report to show before and after.
 * Test-only.
 *
 * Plain, with nothing drawn on top: the paper in two tones by side, the
 * folds and edges in one ink and the aux lines in a lighter one, the ground
 * transparent. It is the replay's picture of a frame, not the GPU's colours:
 * enough to see where a line ends and what paper it is over.
 */
import { deflateSync } from 'node:zlib';
import type { PaperLineRole } from '@treemaker/origami-simulator';
import type { PaperRaster } from '../../cp-workspace/folded/folded3dWindowParity.testSupport';

const FRONT = [244, 239, 230];
const BACK = [205, 188, 169];
const INK = [42, 42, 42];
const AUX_INK = [138, 138, 138];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGBA rows, top first, as a PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width * 4 + 1)] = 0; // no filter
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** A raster painted plainly: the paper by side, each line's ink by its role. */
export function rasterPng(raster: PaperRaster, roleOf: (ink: number) => PaperLineRole | undefined): Buffer {
  const { width, height, face, side, ink } = raster;
  const rgba = new Uint8Array(width * height * 4);
  for (let at = 0; at < width * height; at += 1) {
    const line = ink[at]!;
    const color = line >= 0 ? (roleOf(line) === 'aux' ? AUX_INK : INK) : face[at]! >= 0 ? (side[at]! < 0 ? BACK : FRONT) : null;
    if (!color) continue;
    rgba[at * 4] = color[0]!;
    rgba[at * 4 + 1] = color[1]!;
    rgba[at * 4 + 2] = color[2]!;
    rgba[at * 4 + 3] = 255;
  }
  return encodePng(width, height, rgba);
}
