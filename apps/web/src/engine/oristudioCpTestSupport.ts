/**
 * Shared test support for the compact geometry transport: initialize the real
 * wasm kernel (synchronously, from the built `.wasm`) and build a wide battery
 * document. Imported only by `*.test.ts`; not part of the app bundle.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FOLD_MAGNITUDE_UNITS_PER_DEGREE } from '../lib/foldAngle';

import init, {
  document_snapshot,
  free_document,
  load_cp,
  load_document,
} from '../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpLineColor,
  OristudioCpLineSegment,
} from './oristudioCpTypes';

let initialized: Promise<void> | null = null;

/** Initialize the wasm kernel once per test process. */
export async function initCpWasm(): Promise<void> {
  initialized ??= init({
    module_or_path: readFileSync(
      resolve(process.cwd(), 'src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm')
    ),
  }).then(() => undefined);
  await initialized;
}

export const LINE_COLORS: OristudioCpLineColor[] = [
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
export const ACTIVE_STATES = ['Inactive0', 'ActiveA1', 'ActiveB2', 'ActiveBoth3'];
// `selected` is a rich i32 (2 = "selected folding line"), not a boolean.
export const SELECTED_VALUES = [0, 1, 2];

/**
 * A wide battery of line segments: every color × active state, with rotating
 * `selected` / `customized` and a distinct custom color per row so nothing is
 * masked. Coordinates include extreme and degenerate (zero-length) values, plus
 * a deliberately shared endpoint so vertex dedup is exercised.
 */
export function batterySegments(): OristudioCpLineSegment[] {
  const segments: OristudioCpLineSegment[] = [];
  let n = 0;
  for (const color of LINE_COLORS) {
    for (const active of ACTIVE_STATES) {
      const selected = SELECTED_VALUES[n % SELECTED_VALUES.length];
      const customized = n % 2;
      // Only an unassigned crease may carry a direction hint -- the kernel
      // clears it in `with_line_color` on the way out of `LineColor::None` --
      // so hints rotate across the `None` row rather than the whole battery.
      // Leaving one `None` segment unhinted keeps both states covered.
      const directionHint =
        color !== 'None' ? undefined
        : n % 4 === 1 ? ('Mountain' as const)
        : n % 4 === 2 ? ('Valley' as const)
        : undefined;
      // Give some creases a non-180 fold angle so the battery exercises the
      // magnitude path -- transport round-trip, the render ramp, and export
      // gating all key off it. Only Red1/Blue2 can carry one; the kernel drops
      // it elsewhere, which is itself worth round-tripping.
      const foldMagnitude =
        n % 3 === 1 ? 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE
        : n % 3 === 2 ? 45 * FOLD_MAGNITUDE_UNITS_PER_DEGREE
        : undefined;
      segments.push({
        a: { x: n * 1.5, y: -n * 0.25 },
        b: { x: n === 0 ? n * 1.5 : n * 3.0, y: n === 0 ? -n * 0.25 : 1e12 - n },
        color,
        active,
        selected,
        customized,
        customized_color: { red: (n * 7) % 256, green: (n * 13) % 256, blue: (n * 29) % 256 },
        ...(foldMagnitude === undefined ? {} : { fold_magnitude: foldMagnitude }),
        ...(directionHint === undefined ? {} : { fold_direction_hint: directionHint }),
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
  // Share an endpoint with segment 0's `a` (0,0) to force a vertex-dedup hit.
  segments.push({
    a: { x: 0, y: 0 },
    b: { x: 42, y: 42 },
    color: 'Red1',
    active: 'ActiveA1',
    selected: 1,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
  });
  return segments;
}

/**
 * Build a full battery document snapshot (segments + aux + points + circles +
 * texts), seeding real grid / operation-frame defaults from an empty document.
 */
export function batterySnapshot(title = 'battery 折り紙 🦀'): OristudioCpDocumentSnapshot {
  const emptyHandle = load_cp('', 'seed');
  const empty = document_snapshot(emptyHandle) as OristudioCpDocumentSnapshot;
  free_document(emptyHandle);

  return {
    title,
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
        // Aux segments are encoded by the same `encode_segments` and read by the
        // same `readSegment`, so they carry hints too -- but they get no
        // magnitude array, which is the one place the two paths differ. Cover it.
        {
          a: { x: -20, y: 5 },
          b: { x: 20, y: -5 },
          color: 'None',
          active: 'Inactive0',
          selected: 0,
          customized: 0,
          customized_color: { red: 0, green: 0, blue: 0 },
          fold_direction_hint: 'Valley',
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
}

/** Load the battery document and return its handle. */
export function loadBatteryDocument(title?: string): number {
  return load_document(batterySnapshot(title));
}
