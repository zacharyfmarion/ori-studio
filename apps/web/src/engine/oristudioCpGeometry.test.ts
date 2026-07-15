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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import init, {
  document_geometry,
  document_snapshot,
  free_document,
  load_cp,
  load_document,
  restore_from_compact,
} from '../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import { CpGeometry, decodeCpGeometryToSnapshot, type CpGeometryTransport } from './oristudioCpGeometry';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpLineColor,
  OristudioCpLineSegment,
} from './oristudioCpTypes';

beforeAll(async () => {
  const wasmPath = resolve(
    process.cwd(),
    'src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm'
  );
  await init({ module_or_path: readFileSync(wasmPath) });
});

const LINE_COLORS: OristudioCpLineColor[] = [
  'Angle',
  'None',
  'Black0',
  'Red1',
  'Blue2',
  'Cyan3',
  'Orange4',
  'Magenta5',
  'Green6',
  'Yellow7',
  'Purple8',
  'Other9',
  'Grey10',
];
const ACTIVE_STATES = ['Inactive0', 'ActiveA1', 'ActiveB2', 'ActiveBoth3'];
// `selected` is a rich i32 (2 = "selected folding line"), not a boolean.
const SELECTED_VALUES = [0, 1, 2];

/**
 * A wide battery of line segments: every color × active state, with rotating
 * `selected` / `customized` and a distinct custom color per row so nothing is
 * masked. Coordinates include extreme and degenerate (zero-length) values.
 */
function batterySegments(): OristudioCpLineSegment[] {
  const segments: OristudioCpLineSegment[] = [];
  let n = 0;
  for (const color of LINE_COLORS) {
    for (const active of ACTIVE_STATES) {
      const selected = SELECTED_VALUES[n % SELECTED_VALUES.length];
      const customized = n % 2;
      segments.push({
        a: { x: n * 1.5, y: -n * 0.25 },
        b: { x: n === 0 ? n * 1.5 : n * 3.0, y: n === 0 ? -n * 0.25 : 1e12 - n },
        color,
        active,
        selected,
        customized,
        customized_color: { red: (n * 7) % 256, green: (n * 13) % 256, blue: (n * 29) % 256 },
      });
      n += 1;
    }
  }
  // Coincident + sub-nanometer coordinates that must survive as exact f64.
  segments.push({
    a: { x: 1e-9, y: 1e-9 },
    b: { x: 1e-9, y: 1e-9 },
    color: 'Black0',
    active: 'Inactive0',
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
  });
  return segments;
}

describe('compact geometry transport', () => {
  it('decodes to a snapshot identical to document_snapshot (parity gate)', () => {
    const emptyHandle = load_cp('', 'seed');
    const empty = document_snapshot(emptyHandle) as OristudioCpDocumentSnapshot;
    free_document(emptyHandle);

    const battery: OristudioCpDocumentSnapshot = {
      title: 'battery 折り紙 🦀',
      crease_pattern: {
        ...empty.crease_pattern,
        line_segments: batterySegments(),
        aux_line_segments: [
          {
            a: { x: -10, y: -10 },
            b: { x: 10, y: 10 },
            color: 'Orange4',
            active: 'ActiveBoth3',
            selected: 1,
            customized: 1,
            customized_color: { red: 200, green: 100, blue: 50 },
          },
        ],
        points: [
          { x: 0, y: 0 },
          { x: 1e12, y: -1e-9 },
        ],
        circles: [
          {
            x: 5,
            y: 6,
            r: 7,
            color: 'Black0',
            customized: 0,
            customized_color: { red: 0, green: 0, blue: 0 },
          },
          {
            x: -1.25,
            y: 2.5,
            r: 0.001,
            color: 'Green6',
            customized: 1,
            customized_color: { red: 12, green: 34, blue: 56 },
          },
        ],
        texts: [
          { x: 1, y: 2, text: 'hello 折り紙 🦀' },
          { x: -3, y: -4, text: '' },
        ],
      },
      operation_frame: empty.operation_frame,
      metadata: { source: 'compact-parity-test', count: 3 },
    };

    const handle = load_document(battery);
    const structured = document_snapshot(handle) as OristudioCpDocumentSnapshot;
    const transport = document_geometry(handle) as CpGeometryTransport;
    const decoded = decodeCpGeometryToSnapshot(transport);

    expect(decoded).toEqual(structured);
    free_document(handle);
  });

  it('restore_from_compact reproduces the document exactly (round-trip identity gate)', () => {
    const emptyHandle = load_cp('', 'seed');
    const empty = document_snapshot(emptyHandle) as OristudioCpDocumentSnapshot;
    free_document(emptyHandle);

    const battery: OristudioCpDocumentSnapshot = {
      title: 'roundtrip',
      crease_pattern: { ...empty.crease_pattern, line_segments: batterySegments() },
      operation_frame: empty.operation_frame,
      metadata: {},
    };

    const handle = load_document(battery);
    const before = document_snapshot(handle) as OristudioCpDocumentSnapshot;
    const transport = document_geometry(handle) as CpGeometryTransport;

    restore_from_compact(handle, transport);
    const after = document_snapshot(handle) as OristudioCpDocumentSnapshot;

    expect(after).toEqual(before);
    free_document(handle);
  });

  it('accessor random-access and iteration agree on the battery', () => {
    const emptyHandle = load_cp('', 'seed');
    const empty = document_snapshot(emptyHandle) as OristudioCpDocumentSnapshot;
    free_document(emptyHandle);

    const segments = batterySegments();
    const battery: OristudioCpDocumentSnapshot = {
      title: 'accessor',
      crease_pattern: { ...empty.crease_pattern, line_segments: segments },
      operation_frame: empty.operation_frame,
      metadata: {},
    };

    const handle = load_document(battery);
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
