/**
 * The lazily decoded snapshot (`lazyCpDocumentSnapshot`) and every reader that
 * answers from its transport instead of decoding it.
 *
 * Driven by the real kernel's `document_geometry` over the battery document,
 * which populates every optional segment field (custom colours, magnitudes,
 * direction hints, every colour and active state), so "reads the same as the
 * decode" is checked where a reader could plausibly get a field wrong.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
  document_geometry,
  document_snapshot,
  free_document,
} from '../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import { foldAngleCreasesOf } from '../cp-workspace/foldAngle/foldAngleCreases';
import {
  reselectFoldableLineIds,
  reselectSourceLineIds,
} from '../cp-workspace/folded/foldedFigureStaleness';
import { creaseFingerprint, lineContentFingerprint } from '../lib/creaseFingerprint';
import {
  cpDecodedLineSegments,
  cpDocumentLinesKey,
  cpDocumentTransport,
  cpLineEndpoints,
  cpLineSegmentAt,
  cpLineSegmentCount,
  cpSegmentEndpoints,
  cpSelectedLineIds,
  decodeCpGeometryToSnapshot,
  forEachCpLine,
  forEachPackedLine,
  lazyCpDocumentSnapshot,
  packedLineAt,
  packedLinesExcept,
  SEG_ATTR_STRIDE,
  SEG_SELECTED_SLOT,
  vertexPointsFromTransport,
  withCpDocumentTexts,
  type CpGeometryTransport,
} from './oristudioCpGeometry';
import { getCpVertexPoints } from '../lib/creasePatternViewport';
import { initCpWasm, loadBatteryDocument } from './oristudioCpTestSupport';
import type { OristudioCpDocumentSnapshot } from './oristudioCpTypes';

beforeAll(initCpWasm);

/** The battery document's transport, its kernel snapshot, and a fresh decode. */
function battery(): {
  transport: CpGeometryTransport;
  structured: OristudioCpDocumentSnapshot;
  decoded: OristudioCpDocumentSnapshot;
} {
  const handle = loadBatteryDocument();
  const transport = document_geometry(handle) as CpGeometryTransport;
  const structured = document_snapshot(handle) as OristudioCpDocumentSnapshot;
  free_document(handle);
  return { transport, structured, decoded: decodeCpGeometryToSnapshot(transport) };
}

describe('the lazily decoded snapshot', () => {
  it('reads as the kernel snapshot, and serialises byte for byte as the decode', () => {
    const { transport, structured, decoded } = battery();
    const lazy = lazyCpDocumentSnapshot(transport);
    // Before anything reads it: a save is JSON, the worker gets a structured
    // clone, and both must carry exactly what the eager decode held.
    expect(JSON.stringify(lazyCpDocumentSnapshot(transport))).toBe(JSON.stringify(decoded));
    expect(structuredClone(lazyCpDocumentSnapshot(transport))).toEqual(decoded);
    expect(lazy).toEqual(structured);
    expect(Object.keys(lazy.crease_pattern)).toEqual(Object.keys(decoded.crease_pattern));
  });

  it('decodes nothing until the lines are read, and the same array after', () => {
    const { transport } = battery();
    const lazy = lazyCpDocumentSnapshot(transport);
    expect(cpDecodedLineSegments(lazy)).toBeNull();
    const lines = lazy.crease_pattern.line_segments;
    expect(cpDecodedLineSegments(lazy)).toBe(lines);
    expect(lazy.crease_pattern.line_segments).toBe(lines);
    expect(cpDocumentTransport(lazy)).toBe(transport);
  });

  it('decodes the selection a selection wrote into the transport before it', () => {
    // `mirrorSelectedLines` writes only the transport while the lines are not
    // decoded; whatever decodes them later has to find that selection.
    const { transport } = battery();
    const lazy = lazyCpDocumentSnapshot(transport);
    transport.segAttr[0 * SEG_ATTR_STRIDE + SEG_SELECTED_SLOT] = 2;
    transport.segAttr[2 * SEG_ATTR_STRIDE + SEG_SELECTED_SLOT] = 0;
    const fromTransport = cpSelectedLineIds(lazy);
    expect(cpDecodedLineSegments(lazy)).toBeNull();
    const lines = lazy.crease_pattern.line_segments;
    expect(lines[0]!.selected).toBe(2);
    expect(lines[2]!.selected).toBe(0);
    expect(cpSelectedLineIds(lazy)).toEqual(fromTransport);
    expect(fromTransport).toEqual(
      lines.flatMap((line, index) => (line.selected === 0 ? [] : [index + 1]))
    );
  });

  it('keeps its transport through a copy of the snapshot, and drops it when its lines are replaced', () => {
    const { transport } = battery();
    const lazy = lazyCpDocumentSnapshot(transport);
    const retitled = { ...lazy, title: 'retitled' };
    expect(cpDocumentTransport(retitled)).toBe(transport);
    expect(cpDecodedLineSegments(retitled)).toBeNull();

    const replacement = lazy.crease_pattern.line_segments.slice(0, 2);
    lazy.crease_pattern.line_segments = replacement;
    expect(cpDocumentTransport(lazy)).toBeNull();
    expect(cpLineSegmentCount(lazy)).toBe(2);
    expect(cpLineEndpoints(lazy)).toEqual(cpSegmentEndpoints(replacement));
  });

  it('replaces its texts without decoding, as the spread it stands for would', () => {
    const { transport, decoded } = battery();
    const lazy = lazyCpDocumentSnapshot(transport);
    const cleared = withCpDocumentTexts(lazy, []);
    expect(cpDecodedLineSegments(cleared)).toBeNull();
    expect(cpDocumentLinesKey(cleared)).toBe(cpDocumentLinesKey(lazy));
    expect(cleared).toEqual({
      ...decoded,
      crease_pattern: { ...decoded.crease_pattern, texts: [] },
    });
    expect(lazy.crease_pattern.texts).toEqual(decoded.crease_pattern.texts);
  });
});

describe('readers that answer from the transport', () => {
  it('agree with the decoded lines and leave them undecoded', () => {
    const { transport, decoded } = battery();
    const lazy = lazyCpDocumentSnapshot(transport);
    const lines = decoded.crease_pattern.line_segments;

    expect(cpLineSegmentCount(lazy)).toBe(lines.length);
    for (let id = 0; id <= lines.length + 1; id += 1) {
      expect(cpLineSegmentAt(lazy, id)).toEqual(lines[id - 1]);
    }
    expect(cpLineSegmentAt(lazy, 1.5)).toBeUndefined();
    expect(cpLineEndpoints(lazy)).toEqual(cpSegmentEndpoints(lines));
    expect(cpSelectedLineIds(lazy)).toEqual(cpSelectedLineIds(decoded));

    const visited: [number, number, number, number, string, number][] = [];
    forEachCpLine(lazy, ({ a, b }, color, id) => visited.push([a.x, a.y, b.x, b.y, color, id]));
    expect(visited).toEqual(lines.map((l, i) => [l.a.x, l.a.y, l.b.x, l.b.y, l.color, i + 1]));

    expect(cpDecodedLineSegments(lazy)).toBeNull();
  });

  it('fingerprint the lines exactly as the decoded objects do', () => {
    const { transport, decoded } = battery();
    const lazy = lazyCpDocumentSnapshot(transport);
    expect(creaseFingerprint(lazy)).toBe(creaseFingerprint(decoded));
    expect(lineContentFingerprint(lazy)).toBe(lineContentFingerprint(decoded));
    expect(cpDecodedLineSegments(lazy)).toBeNull();
  });

  it('find the same fold-angle creases and staleness lines as the decoded objects', () => {
    const { transport, decoded } = battery();
    const lazy = lazyCpDocumentSnapshot(transport);
    expect(foldAngleCreasesOf(lazy)).toEqual(foldAngleCreasesOf(decoded));
    expect(foldAngleCreasesOf(lazy).length).toBeGreaterThan(0);
    const bounds = { minX: -50, minY: -50, maxX: 50, maxY: 50 };
    expect(reselectFoldableLineIds(lazy, bounds)).toEqual(reselectFoldableLineIds(decoded, bounds));
    expect(reselectSourceLineIds(lazy, bounds)).toEqual(reselectSourceLineIds(decoded, bounds));
    expect(cpDecodedLineSegments(lazy)).toBeNull();
  });
});

describe('packed endpoints', () => {
  const endpoints = Float64Array.from([0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1]);

  it('look a line up by its 1-based id', () => {
    expect(packedLineAt(endpoints, 2)).toEqual({ a: { x: 1, y: 0 }, b: { x: 1, y: 1 } });
    expect(packedLineAt(endpoints, 0)).toBeUndefined();
    expect(packedLineAt(endpoints, 4)).toBeUndefined();
  });

  it('leave out the lines a move-drag moves, keeping the rest in order', () => {
    expect([...packedLinesExcept(endpoints, [2])]).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    expect(packedLinesExcept(endpoints, [])).toEqual(endpoints);
  });

  it('dedupe into vertex dots as the map of sets did, first seen first', () => {
    // Shared endpoints, near-coincident ones either side of the 1e-9
    // quantization, signed zeros, NaN and coordinates past 2^32 once quantized.
    let seed = 11;
    const next = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const coordinate = () => {
      const r = next();
      if (r < 0.05) return Number.NaN;
      if (r < 0.1) return -0;
      if (r < 0.15) return 0;
      if (r < 0.3) return 5000 + Math.floor(next() * 4) + (next() < 0.5 ? 4e-10 : 6e-10);
      return Math.floor(next() * 20) * 0.5;
    };
    const lines = Array.from({ length: 3000 }, () => ({
      a: { x: coordinate(), y: coordinate() },
      b: { x: coordinate(), y: coordinate() },
    }));
    const document = {
      crease_pattern: { line_segments: lines },
    } as unknown as OristudioCpDocumentSnapshot;
    const transport = { segEndpoints: cpSegmentEndpoints(lines) } as CpGeometryTransport;
    expect(vertexPointsFromTransport(transport)).toEqual(getCpVertexPoints(document));
  });

  it('visit every line in id order', () => {
    const seen: string[] = [];
    forEachPackedLine(endpoints, (a, b, id) => seen.push(`${id}:${a.x},${a.y}-${b.x},${b.y}`));
    expect(seen).toEqual(['1:0,0-1,0', '2:1,0-1,1', '3:1,1-0,1']);
  });
});
