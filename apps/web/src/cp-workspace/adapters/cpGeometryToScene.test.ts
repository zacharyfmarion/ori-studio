/**
 * Phase 2 parity gate: the transport-driven stroke builder and vertex dedup
 * produce output byte-identical to the structured-snapshot path they replace.
 * Both are exercised on the real-wasm battery so the compact hot path is proven
 * equivalent before Phase 3 removes the structured fetch.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  document_geometry,
  document_snapshot,
  free_document,
} from '../../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import {
  vertexPointsFromTransport,
  type CpGeometryTransport,
} from '../../engine/oristudioCpGeometry';
import { initCpWasm, loadBatteryDocument } from '../../engine/oristudioCpTestSupport';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { getCpVertexPoints } from '../../lib/creasePatternViewport';
import type { Rgba } from '../renderer/types';
import {
  cpSnapshotToScene,
  translationMatrix,
  type CpSelectionStyle,
  type CpTransformPreview,
} from './cpSnapshotToScene';
import { cpGeometryStrokesToScene } from './cpGeometryToScene';

beforeAll(initCpWasm);

// Deterministic, distinct colour per line-color name (no DOM/theme needed).
function colorFor(name: string): Rgba {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return [(h & 0xff) / 255, ((h >> 8) & 0xff) / 255, ((h >> 16) & 0xff) / 255, 1];
}

function expectStrokesEqual(
  a: ReturnType<typeof cpSnapshotToScene>['strokes'],
  b: ReturnType<typeof cpGeometryStrokesToScene>['strokes']
): void {
  expect(b.count).toBe(a.count);
  expect(Array.from(b.a)).toEqual(Array.from(a.a));
  expect(Array.from(b.b)).toEqual(Array.from(a.b));
  expect(Array.from(b.color)).toEqual(Array.from(a.color));
  expect(Array.from(b.widthMul)).toEqual(Array.from(a.widthMul));
}

describe('cpGeometryStrokesToScene parity with cpSnapshotToScene', () => {
  let handle: number;
  let structured: OristudioCpDocumentSnapshot;
  let transport: CpGeometryTransport;

  beforeAll(() => {
    handle = loadBatteryDocument();
    structured = document_snapshot(handle) as OristudioCpDocumentSnapshot;
    transport = document_geometry(handle) as CpGeometryTransport;
  });

  afterAll(() => {
    free_document(handle);
  });

  const segmentsInput = () =>
    structured.crease_pattern.line_segments.map((s) => ({ a: s.a, b: s.b, color: s.color }));

  it('plain (no selection, no move)', () => {
    expectStrokesEqual(
      cpSnapshotToScene(segmentsInput(), colorFor).strokes,
      cpGeometryStrokesToScene(transport, colorFor).strokes
    );
  });

  it('with a selection highlight', () => {
    const selection: CpSelectionStyle = {
      selected: new Set([1, 3, 7, structured.crease_pattern.line_segments.length]),
      color: [0.9, 0.1, 0.2, 1],
      widthMul: 2.5,
    };
    expectStrokesEqual(
      cpSnapshotToScene(segmentsInput(), colorFor, selection).strokes,
      cpGeometryStrokesToScene(transport, colorFor, selection).strokes
    );
  });

  it('with an in-progress move-drag delta', () => {
    const selection: CpSelectionStyle = {
      selected: new Set([2, 4]),
      color: [0.1, 0.8, 0.3, 1],
      widthMul: 2,
    };
    const move: CpTransformPreview = {
      ids: new Set([2, 4]),
      matrix: translationMatrix({ x: 12.5, y: -3.25 }),
    };
    expectStrokesEqual(
      cpSnapshotToScene(segmentsInput(), colorFor, selection, move).strokes,
      cpGeometryStrokesToScene(transport, colorFor, selection, move).strokes
    );
  });

  it('with an in-progress four-point transform (rotate + scale)', () => {
    const selection: CpSelectionStyle = {
      selected: new Set([2, 4]),
      color: [0.1, 0.8, 0.3, 1],
      widthMul: 2,
    };
    // Non-trivial similarity: 30° rotation scaled by 1.75, plus a translation.
    const c = Math.cos(Math.PI / 6) * 1.75;
    const s = Math.sin(Math.PI / 6) * 1.75;
    const move: CpTransformPreview = {
      ids: new Set([2, 4]),
      matrix: [c, -s, s, c, 3.5, -1.25],
    };
    expectStrokesEqual(
      cpSnapshotToScene(segmentsInput(), colorFor, selection, move).strokes,
      cpGeometryStrokesToScene(transport, colorFor, selection, move).strokes
    );
  });

  it('vertexPointsFromTransport matches getCpVertexPoints', () => {
    expect(vertexPointsFromTransport(transport)).toEqual(getCpVertexPoints(structured));
  });
});
