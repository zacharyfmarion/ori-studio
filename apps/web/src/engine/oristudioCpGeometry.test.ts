/**
 * End-to-end correctness gates for the compact geometry transport.
 *
 * These drive the real wasm kernel (initialized synchronously from the built
 * `.wasm`) so the gates cover the whole path — encoder, typed-array marshalling,
 * and the TS accessor/decoder — against `document_snapshot`, the structured
 * oracle the compact path is meant to replace:
 *
 *  - **Parity gate:** for the same document, `document_geometry` decoded to a
 *    snapshot equals `document_snapshot` field-for-field.
 *  - **Round-trip identity gate:** `restore_from_compact` of that geometry
 *    reproduces the original document exactly.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
  document_geometry,
  document_snapshot,
  free_document,
  load_document,
  restore_from_compact,
} from '../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import {
  CpGeometry,
  decodeCpGeometryToSnapshot,
  type CpGeometryTransport,
} from './oristudioCpGeometry';
import {
  batterySegments,
  batterySnapshot,
  initCpWasm,
  loadBatteryDocument,
} from './oristudioCpTestSupport';
import type { OristudioCpDocumentSnapshot } from './oristudioCpTypes';

beforeAll(initCpWasm);

describe('compact geometry transport', () => {
  it('decodes to a snapshot identical to document_snapshot (parity gate)', () => {
    const handle = loadBatteryDocument();
    const structured = document_snapshot(handle) as OristudioCpDocumentSnapshot;
    const transport = document_geometry(handle) as CpGeometryTransport;

    expect(decodeCpGeometryToSnapshot(transport)).toEqual(structured);
    free_document(handle);
  });

  /**
   * The guard the parity gate above could not be.
   *
   * That gate compares the decoded snapshot against the kernel's own, which is
   * exactly right — and it is only as strong as the fixture. When OCG3 widened
   * `seg_attr` to carry the fold-direction hint, `readSegment` was never taught
   * to read the new slot; the gate stayed green because no battery segment was
   * hinted, so both sides agreed the field was absent. The hint then died on the
   * first refresh after any edit, taking `.osf` saves, undo and paste with it.
   *
   * So this asserts the *shape* rather than the values: every field the kernel
   * serialises for a fully-populated segment must appear on the decoded one.
   * A decoder that ignores a slot fails here even if someone forgets to give the
   * new field a distinctive fixture value.
   *
   * Adding a field to the kernel's `LineSegment` breaks
   * `assert_segment_fields_are_handled` in `share/v1.rs` first — that exhaustive
   * destructure is the build-time trigger that should send you here.
   */
  it('decodes every field the kernel serialises, not just the ones it knew about', () => {
    const handle = loadBatteryDocument();
    const structured = document_snapshot(handle) as OristudioCpDocumentSnapshot;
    const transport = document_geometry(handle) as CpGeometryTransport;
    const decoded = decodeCpGeometryToSnapshot(transport);

    const keysOf = (segments: readonly object[]): string[] =>
      [...new Set(segments.flatMap((segment) => Object.keys(segment)))].sort();

    const kernelKeys = keysOf(structured.crease_pattern.line_segments);
    // The fixture must exercise every optional field, or this degenerates into
    // the blind comparison it exists to replace.
    expect(kernelKeys).toEqual([
      'a',
      'active',
      'b',
      'color',
      'customized',
      'customized_color',
      'fold_direction_hint',
      'fold_magnitude',
      'selected',
    ]);
    expect(keysOf(decoded.crease_pattern.line_segments)).toEqual(kernelKeys);

    free_document(handle);
  });

  it('restore_from_compact reproduces the document exactly (round-trip identity gate)', () => {
    const handle = load_document(batterySnapshot('roundtrip'));
    const before = document_snapshot(handle) as OristudioCpDocumentSnapshot;
    const transport = document_geometry(handle) as CpGeometryTransport;

    restore_from_compact(handle, transport);
    const after = document_snapshot(handle) as OristudioCpDocumentSnapshot;

    expect(after).toEqual(before);
    free_document(handle);
  });

  it('accessor random-access and iteration agree on the battery', () => {
    const segments = batterySegments();
    const handle = load_document(batterySnapshot('accessor'));
    const transport = document_geometry(handle) as CpGeometryTransport;
    const geometry = new CpGeometry(transport);

    expect(geometry.lineSegmentCount).toBe(segments.length);
    // 1-based id addressing matches iteration order.
    const iterated = [...geometry.lineSegments()];
    expect(iterated).toEqual(segments);
    for (let i = 0; i < segments.length; i += 1) {
      expect(geometry.lineSegmentById(i + 1)).toEqual(segments[i]);
    }
    free_document(handle);
  });
});
