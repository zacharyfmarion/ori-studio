import { describe, expect, it } from 'vitest';
import type {
  OristudioCpDiagnosticEntry,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import type { Rgba } from '../renderer/types';
import { MARKER_SHAPE } from '../renderer/types';
import {
  boundsFromPoints,
  buildCpDiagnosticMarkers,
  buildCpDiagnosticStrokes,
  buildCpDiagnosticWedges,
  cpDiagnosticMarkerStyle,
  cpDiagnosticMarkerTone,
  cpHasLblWedges,
  diagnosticEntryBounds,
  diagnosticSegmentEndpoint,
} from './geometry';

function seg(a: Point, b: Point, color = 'Red1'): OristudioCpLineSegment {
  return {
    a,
    b,
    color,
    active: 'ACTIVE_NONE_0',
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
  };
}

function entry(overrides: Partial<OristudioCpDiagnosticEntry>): OristudioCpDiagnosticEntry {
  return {
    id: 'd1',
    kind: 'Check1',
    severity: 'error',
    message: '',
    ...overrides,
  };
}

// A flat set of tone colours so the geometry builders are testable without the DOM.
const tones: Record<ReturnType<typeof cpDiagnosticMarkerTone>, Rgba> = {
  danger: [1, 0, 0, 1],
  warning: [1, 1, 0, 1],
  mountain: [1, 0, 0.3, 1],
  valley: [0, 0.5, 1, 1],
  neutral: [0.5, 0.5, 0.5, 1],
  unknown: [1, 0, 0.5, 1],
};

describe('cpDiagnosticMarkerStyle', () => {
  it('non-foldability entries are the generic cross', () => {
    expect(cpDiagnosticMarkerStyle(entry({ kind: 'Check1', point: { x: 0, y: 0 } }))).toEqual({
      shape: 'generic',
      tone: 'danger',
    });
  });

  it('maps flat-foldability rules to their shapes', () => {
    const base = { kind: 'Check4', point: { x: 0, y: 0 } };
    expect(cpDiagnosticMarkerStyle(entry({ ...base, rule: 'NumberOfFolds' })).shape).toBe('triangle');
    expect(cpDiagnosticMarkerStyle(entry({ ...base, rule: 'Maekawa' })).shape).toBe('square');
    expect(cpDiagnosticMarkerStyle(entry({ ...base, rule: 'LittleBigLittle' })).shape).toBe(
      'little-big-little'
    );
    expect(cpDiagnosticMarkerStyle(entry({ ...base, rule: 'None' })).shape).toBe('none');
  });

  it('Angles is a ring when correct, a disc otherwise', () => {
    const base = { kind: 'Check4', rule: 'Angles', point: { x: 0, y: 0 } };
    expect(cpDiagnosticMarkerStyle(entry({ ...base, violation_color: 'Correct' })).shape).toBe(
      'ring'
    );
    expect(cpDiagnosticMarkerStyle(entry({ ...base, violation_color: 'Unknown' })).shape).toBe(
      'circle'
    );
  });
});

describe('cpDiagnosticMarkerTone', () => {
  it('maps violation colours to tones, falling back to severity', () => {
    expect(cpDiagnosticMarkerTone(entry({ violation_color: 'NotEnoughMountain' }))).toBe('mountain');
    expect(cpDiagnosticMarkerTone(entry({ violation_color: 'NotEnoughValley' }))).toBe('valley');
    expect(cpDiagnosticMarkerTone(entry({ violation_color: 'Correct' }))).toBe('neutral');
    expect(cpDiagnosticMarkerTone(entry({ violation_color: 'Unknown' }))).toBe('unknown');
    expect(cpDiagnosticMarkerTone(entry({ severity: 'warning' }))).toBe('warning');
    expect(cpDiagnosticMarkerTone(entry({ severity: 'error' }))).toBe('danger');
  });
});

describe('buildCpDiagnosticMarkers', () => {
  it('emits one marker per renderable entry with its shape id, skipping point-less ones', () => {
    const geo = buildCpDiagnosticMarkers(
      [entry({ point: { x: 1, y: 2 } }), entry({ id: 'd2', point: null })],
      tones
    );
    expect(geo.count).toBe(1);
    expect(geo.shape[0]).toBe(MARKER_SHAPE.cross);
    expect([geo.center[0], geo.center[1]]).toEqual([1, 2]);
  });

  it('skips an LBL vertex that has wedges (the wedges represent it instead)', () => {
    const lbl = entry({
      kind: 'Check4',
      rule: 'LittleBigLittle',
      point: { x: 0, y: 0 },
      little_big_little: [
        { segment: seg({ x: 0, y: 0 }, { x: 1, y: 0 }), violating: true },
        { segment: seg({ x: 0, y: 0 }, { x: 0, y: 1 }), violating: false },
      ],
    });
    expect(cpHasLblWedges(lbl)).toBe(true);
    expect(buildCpDiagnosticMarkers([lbl], tones).count).toBe(0);
  });
});

describe('buildCpDiagnosticStrokes', () => {
  it('emits one stroke per segment, skipping little-big-little entries', () => {
    const normal = entry({ point: { x: 0, y: 0 }, segments: [seg({ x: 0, y: 0 }, { x: 2, y: 0 })] });
    const lbl = entry({
      id: 'd2',
      kind: 'Check4',
      rule: 'LittleBigLittle',
      point: { x: 0, y: 0 },
      segments: [seg({ x: 0, y: 0 }, { x: 1, y: 1 })],
    });
    const geo = buildCpDiagnosticStrokes([normal, lbl], tones);
    expect(geo.count).toBe(1);
    expect([geo.a[0], geo.a[1], geo.b[0], geo.b[1]]).toEqual([0, 0, 2, 0]);
  });
});

describe('buildCpDiagnosticWedges', () => {
  const lbl = entry({
    kind: 'Check4',
    rule: 'LittleBigLittle',
    point: { x: 0, y: 0 },
    little_big_little: [
      { segment: seg({ x: 0, y: 0 }, { x: 1, y: 0 }), violating: true },
      { segment: seg({ x: 0, y: 0 }, { x: 0, y: 1 }), violating: false },
    ],
  });

  it('fans a wedge per sector with model-space directions to the far endpoint', () => {
    const geo = buildCpDiagnosticWedges([lbl], tones);
    expect(geo.count).toBe(2);
    // First wedge: dir0 toward (1,0), dir1 toward (0,1).
    expect([geo.dir0[0], geo.dir0[1]]).toEqual([1, 0]);
    expect([geo.dir1[0], geo.dir1[1]]).toEqual([0, 1]);
  });

  it('the violating sector fills stronger than the quiet one', () => {
    const geo = buildCpDiagnosticWedges([lbl], tones);
    // sector 0 is violating → higher alpha than sector 1.
    expect(geo.color[3]).toBeGreaterThan(geo.color[7]);
  });

  it('drops the wrap-around wedge when the last ray is the boundary (Black0)', () => {
    const withBoundary = entry({
      kind: 'Check4',
      rule: 'LittleBigLittle',
      point: { x: 0, y: 0 },
      little_big_little: [
        { segment: seg({ x: 0, y: 0 }, { x: 1, y: 0 }), violating: false },
        { segment: seg({ x: 0, y: 0 }, { x: 0, y: 1 }), violating: false },
        { segment: seg({ x: 0, y: 0 }, { x: -1, y: 0 }, 'Black0'), violating: false },
      ],
    });
    // 3 sectors, but the last (Black0) wrap wedge is skipped → 2 wedges.
    expect(buildCpDiagnosticWedges([withBoundary], tones).count).toBe(2);
  });
});

describe('bounds + endpoints', () => {
  it('diagnosticSegmentEndpoint returns the endpoint farther from the vertex', () => {
    const s = seg({ x: 1, y: 0 }, { x: 5, y: 0 });
    expect(diagnosticSegmentEndpoint({ x: 0, y: 0 }, s)).toEqual({ x: 5, y: 0 });
  });

  it('diagnosticEntryBounds covers the point + segment endpoints', () => {
    const bounds = diagnosticEntryBounds(
      entry({ point: { x: 0, y: 0 }, segments: [seg({ x: -1, y: 2 }, { x: 3, y: -4 })] })
    );
    expect(bounds).toEqual({ minX: -1, minY: -4, maxX: 3, maxY: 2, center: { x: 1, y: -1 } });
  });

  it('boundsFromPoints is null for an empty set', () => {
    expect(boundsFromPoints([])).toBeNull();
  });
});
