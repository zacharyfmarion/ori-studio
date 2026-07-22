import { describe, expect, it } from 'vitest';

import { decodeCompactGeometryBytes } from './oristudioCpNativeClient';

// Golden buffer produced by the REAL Rust encoder (CompactGeometry::to_bytes) for
// a known geometry: seg_endpoints=[1,2,3,4], seg_attr=[5,6,7,8],
// seg_custom_color=[9,10,11], point_coords=[12,13], everything else empty, default
// tail. Regenerate from crates/oristudio-cp/src/geometry_transport.rs if the format
// changes. This pins the TS decoder against actual Rust bytes (cross-language).
const GOLDEN_BYTES = new Uint8Array([49,71,67,79,4,0,0,0,4,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,153,1,0,0,123,34,116,101,120,116,115,34,58,91,93,44,34,103,114,105,100,34,58,123,34,105,110,116,101,114,118,97,108,95,103,114,105,100,95,115,105,122,101,34,58,52,44,34,103,114,105,100,95,115,105,122,101,34,58,56,44,34,103,114,105,100,95,120,97,34,58,49,46,48,44,34,103,114,105,100,95,120,98,34,58,48,46,48,44,34,103,114,105,100,95,120,99,34,58,49,46,48,44,34,103,114,105,100,95,121,97,34,58,49,46,48,44,34,103,114,105,100,95,121,98,34,58,48,46,48,44,34,103,114,105,100,95,121,99,34,58,49,46,48,44,34,103,114,105,100,95,97,110,103,108,101,34,58,57,48,46,48,44,34,98,97,115,101,95,115,116,97,116,101,34,58,34,87,105,116,104,105,110,80,97,112,101,114,34,44,34,118,101,114,116,105,99,97,108,95,115,99,97,108,101,95,112,111,115,105,116,105,111,110,34,58,48,44,34,104,111,114,105,122,111,110,116,97,108,95,115,99,97,108,101,95,112,111,115,105,116,105,111,110,34,58,48,44,34,100,114,97,119,95,100,105,97,103,111,110,97,108,95,103,114,105,100,108,105,110,101,115,34,58,102,97,108,115,101,125,44,34,111,112,101,114,97,116,105,111,110,95,102,114,97,109,101,34,58,123,34,97,99,116,105,118,101,34,58,102,97,108,115,101,44,34,112,111,105,110,116,115,34,58,91,123,34,120,34,58,48,46,48,44,34,121,34,58,48,46,48,125,44,123,34,120,34,58,48,46,48,44,34,121,34,58,48,46,48,125,44,123,34,120,34,58,48,46,48,44,34,121,34,58,48,46,48,125,44,123,34,120,34,58,48,46,48,44,34,121,34,58,48,46,48,125,93,125,44,34,109,101,116,97,100,97,116,97,34,58,123,125,125,0,0,0,0,0,0,240,63,0,0,0,0,0,0,0,64,0,0,0,0,0,0,8,64,0,0,0,0,0,0,16,64,5,0,0,0,6,0,0,0,7,0,0,0,8,0,0,0,9,10,11,0,0,0,0,0,0,40,64,0,0,0,0,0,0,42,64]);

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  // A standalone ArrayBuffer copy (offset 0), matching what invoke returns.
  return bytes.slice().buffer;
}

describe('decodeCompactGeometryBytes', () => {
  it('decodes the real Rust-encoded golden buffer', () => {
    const geometry = decodeCompactGeometryBytes(bufferOf(GOLDEN_BYTES));
    expect(Array.from(geometry.segEndpoints)).toEqual([1, 2, 3, 4]);
    expect(Array.from(geometry.segAttr)).toEqual([5, 6, 7, 8]);
    expect(Array.from(geometry.segCustomColor)).toEqual([9, 10, 11]);
    expect(Array.from(geometry.auxEndpoints)).toEqual([]);
    expect(Array.from(geometry.pointCoords)).toEqual([12, 13]);
    expect(Array.from(geometry.circleData)).toEqual([]);
    // Tail round-trips through JSON (grid/operationFrame present by default).
    expect(geometry.tail).toBeTruthy();
    // Views are real typed arrays.
    expect(geometry.segEndpoints).toBeInstanceOf(Float64Array);
    expect(geometry.segAttr).toBeInstanceOf(Int32Array);
    expect(geometry.segCustomColor).toBeInstanceOf(Uint8Array);
  });

  it('throws on a bad magic', () => {
    const bytes = GOLDEN_BYTES.slice();
    bytes[0] ^= 0xff;
    expect(() => decodeCompactGeometryBytes(bufferOf(bytes))).toThrow();
  });

  it('throws on a truncated buffer (length disagrees with header)', () => {
    const bytes = GOLDEN_BYTES.slice(0, GOLDEN_BYTES.length - 1);
    expect(() => decodeCompactGeometryBytes(bufferOf(bytes))).toThrow();
  });

  it('throws on a buffer too small for the header', () => {
    expect(() => decodeCompactGeometryBytes(new ArrayBuffer(4))).toThrow();
  });
});
