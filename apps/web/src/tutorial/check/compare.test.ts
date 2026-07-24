import { describe, expect, it } from 'vitest';
import { canonicalizeCreasePattern } from './canonicalize';
import { compareCreasePatterns } from './compare';
import type { OristudioCpLineSegment, OristudioCpModel } from '../../engine/oristudioCpTypes';
import type { LessonCheckSpec } from '../types';

const MOUNTAIN = 'Red1';
const VALLEY = 'Blue2';
const EDGE = 'Black0';
const AUX = 'Cyan3';

function segment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  color = MOUNTAIN
): OristudioCpLineSegment {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    active: 'Unselected',
    color,
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
  };
}

/** The paper edge every document carries. */
function paperEdge(): OristudioCpLineSegment[] {
  return [
    segment(-200, -200, 200, -200, EDGE),
    segment(200, -200, 200, 200, EDGE),
    segment(200, 200, -200, 200, EDGE),
    segment(-200, 200, -200, -200, EDGE),
  ];
}

function model(
  creases: OristudioCpLineSegment[],
  aux: OristudioCpLineSegment[] = []
): OristudioCpModel {
  return {
    line_segments: [...paperEdge(), ...creases],
    circles: [],
    points: [],
    aux_line_segments: aux,
    texts: [],
    grid: {} as OristudioCpModel['grid'],
  };
}

const EXACT: LessonCheckSpec = { mode: 'exact' };

describe('canonicalizeCreasePattern', () => {
  it('drops the paper edge, which every pattern has', () => {
    expect(canonicalizeCreasePattern(model([]))).toEqual([]);
  });

  it('treats a split crease and a whole one as the same pattern', () => {
    const whole = canonicalizeCreasePattern(model([segment(-200, -200, 200, 200)]));
    const split = canonicalizeCreasePattern(
      model([segment(-200, -200, 0, 0), segment(0, 0, 200, 200)])
    );
    expect(split).toEqual(whole);
    expect(whole).toHaveLength(1);
  });

  it('merges a run of many collinear pieces into one crease', () => {
    const pieces = [
      segment(-200, 0, -100, 0),
      segment(-100, 0, 0, 0),
      segment(0, 0, 100, 0),
      segment(100, 0, 200, 0),
    ];
    expect(canonicalizeCreasePattern(model(pieces))).toHaveLength(1);
  });

  it('does not merge collinear creases of different fold types', () => {
    const mixed = [
      segment(-200, 0, 0, 0, MOUNTAIN),
      segment(0, 0, 200, 0, VALLEY),
    ];
    expect(canonicalizeCreasePattern(model(mixed))).toHaveLength(2);
  });

  it('does not merge collinear pieces separated by a gap', () => {
    const gapped = [segment(-200, 0, -100, 0), segment(100, 0, 200, 0)];
    expect(canonicalizeCreasePattern(model(gapped))).toHaveLength(2);
  });

  it('is indifferent to the direction a crease was drawn in', () => {
    const forward = canonicalizeCreasePattern(model([segment(-200, -200, 200, 200)]));
    const reverse = canonicalizeCreasePattern(model([segment(200, 200, -200, -200)]));
    expect(reverse).toEqual(forward);
  });

  it('excludes auxiliary lines unless asked for them', () => {
    const withAux = model([segment(-200, -200, 200, 200)], [segment(-200, 200, 200, -200, AUX)]);
    expect(canonicalizeCreasePattern(withAux)).toHaveLength(1);
    expect(canonicalizeCreasePattern(withAux, { includeAuxiliary: true })).toHaveLength(2);
  });
});

describe('compareCreasePatterns', () => {
  const target = model([segment(-200, -200, 200, 200)]);

  it('accepts an exact match', () => {
    const result = compareCreasePatterns(model([segment(-200, -200, 200, 200)]), target, EXACT);
    expect(result.satisfied).toBe(true);
    expect(result.matched).toHaveLength(1);
    expect(result.expected).toBe(1);
  });

  it('accepts a crease drawn as two collinear halves', () => {
    const drawn = model([segment(-200, -200, 0, 0), segment(0, 0, 200, 200)]);
    expect(compareCreasePatterns(drawn, target, EXACT).satisfied).toBe(true);
  });

  it('accepts endpoints that land slightly off, within tolerance', () => {
    const drawn = model([segment(-199, -199.5, 200.5, 199.6)]);
    expect(compareCreasePatterns(drawn, target, EXACT).satisfied).toBe(true);
  });

  it('rejects a crease that is genuinely somewhere else', () => {
    const drawn = model([segment(-200, 0, 200, 0)]);
    const result = compareCreasePatterns(drawn, target, EXACT);
    expect(result.satisfied).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.extra).toHaveLength(1);
  });

  it('reports a right-place wrong-type crease as an assignment mistake, not both missing and extra', () => {
    const drawn = model([segment(-200, -200, 200, 200, VALLEY)]);
    const result = compareCreasePatterns(drawn, target, EXACT);
    expect(result.satisfied).toBe(false);
    expect(result.wrongAssignment).toHaveLength(1);
    expect(result.missing).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });

  it('accepts the other diagonal when the check allows symmetry', () => {
    const drawn = model([segment(-200, 200, 200, -200)]);
    expect(compareCreasePatterns(drawn, target, EXACT).satisfied).toBe(false);
    expect(
      compareCreasePatterns(drawn, target, { mode: 'exact', allowSymmetry: true }).satisfied
    ).toBe(true);
  });

  it('tolerates extra creases in subset mode but never a missing one', () => {
    const withExtra = model([segment(-200, -200, 200, 200), segment(-200, 0, 200, 0)]);
    expect(compareCreasePatterns(withExtra, target, EXACT).satisfied).toBe(false);
    expect(compareCreasePatterns(withExtra, target, { mode: 'subset' }).satisfied).toBe(true);

    const missingIt = model([segment(-200, 0, 200, 0)]);
    expect(compareCreasePatterns(missingIt, target, { mode: 'subset' }).satisfied).toBe(false);
  });

  it('ignores fold type when the check asks it to', () => {
    const drawn = model([segment(-200, -200, 200, 200, VALLEY)]);
    expect(
      compareCreasePatterns(drawn, target, { mode: 'exact', ignoreAssignment: true }).satisfied
    ).toBe(true);
  });

  it('reports an empty canvas as everything missing, with nothing extra', () => {
    const result = compareCreasePatterns(model([]), target, EXACT);
    expect(result.satisfied).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.extra).toHaveLength(0);
    expect(result.matched).toHaveLength(0);
  });

  it('counts progress on a multi-crease target', () => {
    const bird = model([
      segment(-200, -200, 200, 200),
      segment(-200, 200, 200, -200),
      segment(-200, 0, 200, 0),
    ]);
    const halfway = model([segment(-200, -200, 200, 200), segment(-200, 200, 200, -200)]);
    const result = compareCreasePatterns(halfway, bird, EXACT);
    expect(result.matched).toHaveLength(2);
    expect(result.missing).toHaveLength(1);
    expect(result.expected).toBe(3);
  });
});
