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
