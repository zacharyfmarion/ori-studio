import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';
import type { CanvasAnnotation } from '../annotations/annotation';
import {
  CP_CHECK_CLASSES,
  createCpSuppressionRegion,
  type CpCheckClass,
} from '../annotations/suppressionRegion';
import { createCpImage } from '../images/cpImage';
import {
  cpCheckClassLabel,
  cpCheckSuppressionRules,
  cpCommandResultWithSuppression,
  cpDiagnosticCheckClasses,
  cpSuppressedClassesAt,
  isCpDiagnosticSuppressed,
  NO_CP_CHECK_SUPPRESSION,
  partitionCpDiagnosticsBySuppression,
} from './checkSuppression';

const ANGLE_CLASSES: readonly CpCheckClass[] = ['kawasaki', 'bigLittleBig'];

function violation(
  rule: string,
  violationColor: string | null = 'Unknown',
  point: { x: number; y: number } = { x: 0, y: 0 }
): OristudioCpDiagnosticEntry {
  return {
    id: `${rule}-${violationColor ?? 'none'}-${point.x},${point.y}`,
    kind: 'VertexFlatFoldability',
    severity: 'error',
    message: `Flat-foldability violation: ${rule}`,
    point,
    rule,
    violation_color: violationColor,
  };
}

function spatial(rule: string, point = { x: 0, y: 0 }): OristudioCpDiagnosticEntry {
  return {
    id: `${rule}-${point.x},${point.y}`,
    kind: 'SpatialClosure',
    severity: 'error',
    message: rule,
    point,
    rule,
  };
}

function documentRules(...suppress: CpCheckClass[]) {
  return cpCheckSuppressionRules(suppress);
}

describe('cpDiagnosticCheckClasses', () => {
  it('maps each rule onto the theorem the user names it by', () => {
    expect(cpDiagnosticCheckClasses(violation('Angles'))).toEqual(['kawasaki']);
    expect(cpDiagnosticCheckClasses(violation('BigLittleBig'))).toEqual(['bigLittleBig']);
    expect(cpDiagnosticCheckClasses(violation('Maekawa', 'NotEnoughValley'))).toEqual(['maekawa']);
  });

  it('maps every spatial closure rule onto vertexClosure', () => {
    for (const rule of ['Closure', 'ClosureUnreachable', 'Rigid', 'SelfIntersection']) {
      expect(cpDiagnosticCheckClasses(spatial(rule))).toEqual(['vertexClosure']);
    }
  });

  it('reads a Maekawa colour as a second class the rule overwrote', () => {
    // `find_flat_foldability_violation` emits ONE violation per vertex with the
    // rule replaced by priority (checks.rs:334-346), so a vertex failing both
    // Kawasaki and parity arrives labelled `Angles`. `maekawa_color()` is called
    // from the `|M - V| != 2` arm alone, which makes the colour the only
    // surviving evidence.
    for (const color of ['NotEnoughMountain', 'NotEnoughValley', 'Equal']) {
      expect(cpDiagnosticCheckClasses(violation('Angles', color))).toEqual([
        'kawasaki',
        'maekawa',
      ]);
      expect(cpDiagnosticCheckClasses(violation('BigLittleBig', color))).toEqual([
        'bigLittleBig',
        'maekawa',
      ]);
    }
  });

  it('does not read the colours parity never writes as parity', () => {
    for (const color of ['Correct', 'Unknown', null]) {
      expect(cpDiagnosticCheckClasses(violation('Angles', color))).toEqual(['kawasaki']);
    }
  });

  it('claims no class for anything a rule cannot silence', () => {
    // An odd fan is what a missing crease makes of its endpoint: combinatorial,
    // 74% of the repair worklist, and never suppressible.
    expect(cpDiagnosticCheckClasses(violation('NumberOfFolds'))).toEqual([]);
    expect(cpDiagnosticCheckClasses(violation('None'))).toEqual([]);
    // The spatial checker's informational rules are not findings at all.
    expect(cpDiagnosticCheckClasses(spatial('Undecided'))).toEqual([]);
    expect(cpDiagnosticCheckClasses(spatial('UnsplitJunction'))).toEqual([]);
    expect(cpDiagnosticCheckClasses(spatial('InteriorBorder'))).toEqual([]);
    // Line-pair findings from the on-demand checks.
    expect(cpDiagnosticCheckClasses(violation('Check1'))).toEqual([]);
    expect(cpDiagnosticCheckClasses({ id: 'x', kind: 'x', severity: 'error', message: 'x' })).toEqual(
      []
    );
  });
});

describe('isCpDiagnosticSuppressed', () => {
  it('hides the angle classes under detection’s preset', () => {
    const rules = cpCheckSuppressionRules(ANGLE_CLASSES);
    expect(isCpDiagnosticSuppressed(violation('Angles'), rules)).toBe(true);
    expect(isCpDiagnosticSuppressed(violation('BigLittleBig'), rules)).toBe(true);
  });

  it('KEEPS a masked parity fault visible', () => {
    // The load-bearing case. A `rule !== "Angles"` filter would hide this, and
    // 17% of the measured repair worklist rides on Maekawa.
    const rules = cpCheckSuppressionRules(ANGLE_CLASSES);
    expect(isCpDiagnosticSuppressed(violation('Angles', 'NotEnoughMountain'), rules)).toBe(false);
    expect(isCpDiagnosticSuppressed(violation('Angles', 'NotEnoughValley'), rules)).toBe(false);
    expect(isCpDiagnosticSuppressed(violation('Angles', 'Equal'), rules)).toBe(false);
    expect(isCpDiagnosticSuppressed(violation('BigLittleBig', 'Equal'), rules)).toBe(false);
  });

  it('hides a masked parity fault only when both its classes are suppressed', () => {
    const rules = cpCheckSuppressionRules(['kawasaki', 'maekawa']);
    expect(isCpDiagnosticSuppressed(violation('Angles', 'NotEnoughMountain'), rules)).toBe(true);
    // ...and the plain big-little-big beside it is untouched by that rule.
    expect(isCpDiagnosticSuppressed(violation('BigLittleBig'), rules)).toBe(false);
  });

  it('never hides an odd fan, whatever is suppressed', () => {
    const rules = cpCheckSuppressionRules([...CP_CHECK_CLASSES]);
    expect(isCpDiagnosticSuppressed(violation('NumberOfFolds'), rules)).toBe(false);
    expect(isCpDiagnosticSuppressed(spatial('Undecided'), rules)).toBe(false);
  });

  it('hides nothing with no rules', () => {
    expect(isCpDiagnosticSuppressed(violation('Angles'), NO_CP_CHECK_SUPPRESSION)).toBe(false);
    expect(isCpDiagnosticSuppressed(violation('Angles'), documentRules())).toBe(false);
  });

  it('suppresses each class exactly, one at a time', () => {
    const cases: Array<[CpCheckClass, OristudioCpDiagnosticEntry]> = [
      ['kawasaki', violation('Angles')],
      ['bigLittleBig', violation('BigLittleBig')],
      ['maekawa', violation('Maekawa', 'NotEnoughValley')],
      ['vertexClosure', spatial('Closure')],
    ];
    for (const [owner, entry] of cases) {
      for (const candidate of CP_CHECK_CLASSES) {
        expect(isCpDiagnosticSuppressed(entry, documentRules(candidate))).toBe(candidate === owner);
      }
    }
  });
});

describe('cpCheckSuppressionRules', () => {
  const region = (
    center: { x: number; y: number },
    suppress: readonly CpCheckClass[],
    extra: { z?: number; rotation?: number; width?: number; height?: number } = {}
  ) =>
    createCpSuppressionRegion({
      center,
      width: extra.width ?? 100,
      height: extra.height ?? 100,
      suppress,
      ...(extra.z === undefined ? {} : { z: extra.z }),
      ...(extra.rotation === undefined ? {} : { rotation: extra.rotation }),
    });

  it('returns the shared empty list when nothing is suppressed anywhere', () => {
    expect(cpCheckSuppressionRules(undefined)).toBe(NO_CP_CHECK_SUPPRESSION);
    expect(cpCheckSuppressionRules([])).toBe(NO_CP_CHECK_SUPPRESSION);
    expect(cpCheckSuppressionRules([], [])).toBe(NO_CP_CHECK_SUPPRESSION);
  });

  it('ignores annotations that are not regions', () => {
    const image = createCpImage({
      src: 'data:image/png;base64,',
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      naturalWidth: 10,
      naturalHeight: 10,
    }) as CanvasAnnotation;
    expect(cpCheckSuppressionRules(undefined, [image])).toBe(NO_CP_CHECK_SUPPRESSION);
  });

  it('applies a region only inside its box', () => {
    const rules = cpCheckSuppressionRules(undefined, [region({ x: 0, y: 0 }, ANGLE_CLASSES)]);
    expect(isCpDiagnosticSuppressed(violation('Angles', 'Unknown', { x: 10, y: 10 }), rules)).toBe(
      true
    );
    // 100x100 centred on the origin, so ±50 is the edge.
    expect(isCpDiagnosticSuppressed(violation('Angles', 'Unknown', { x: 80, y: 0 }), rules)).toBe(
      false
    );
  });

  it('honours a region’s rotation', () => {
    const rules = cpCheckSuppressionRules(undefined, [
      region({ x: 0, y: 0 }, ANGLE_CLASSES, { width: 200, height: 20, rotation: Math.PI / 2 }),
    ]);
    // Rotated a quarter turn, the long axis is y.
    expect(isCpDiagnosticSuppressed(violation('Angles', 'Unknown', { x: 0, y: 80 }), rules)).toBe(
      true
    );
    expect(isCpDiagnosticSuppressed(violation('Angles', 'Unknown', { x: 80, y: 0 }), rules)).toBe(
      false
    );
  });

  it('lets a region override the document default in both directions', () => {
    // The document hides parity everywhere; the region says check it here.
    const rules = cpCheckSuppressionRules(['maekawa'], [region({ x: 0, y: 0 }, [])]);
    const inside = violation('Maekawa', 'NotEnoughValley', { x: 0, y: 0 });
    const outside = violation('Maekawa', 'NotEnoughValley', { x: 500, y: 500 });
    expect(isCpDiagnosticSuppressed(inside, rules)).toBe(false);
    expect(isCpDiagnosticSuppressed(outside, rules)).toBe(true);
  });

  it('replaces the document set rather than unioning with it', () => {
    // A region suppressing only the angle classes un-suppresses parity inside
    // itself, even though the document suppresses parity.
    const rules = cpCheckSuppressionRules(['maekawa'], [region({ x: 0, y: 0 }, ANGLE_CLASSES)]);
    expect(isCpDiagnosticSuppressed(violation('Angles', 'Unknown', { x: 0, y: 0 }), rules)).toBe(
      true
    );
    expect(
      isCpDiagnosticSuppressed(violation('Maekawa', 'NotEnoughValley', { x: 0, y: 0 }), rules)
    ).toBe(false);
    expect(
      isCpDiagnosticSuppressed(violation('Maekawa', 'NotEnoughValley', { x: 500, y: 0 }), rules)
    ).toBe(true);
  });

  it('resolves overlapping regions by paint order, not array order', () => {
    // Same box; the one on top decides, which is the answer a click there gives.
    const under = region({ x: 0, y: 0 }, ANGLE_CLASSES, { z: 5 });
    const over = region({ x: 0, y: 0 }, [], { z: 9 });
    const rules = cpCheckSuppressionRules(undefined, [over, under]);
    expect(cpSuppressedClassesAt(rules, { x: 0, y: 0 })).toEqual([]);
    const flipped = cpCheckSuppressionRules(undefined, [
      region({ x: 0, y: 0 }, [], { z: 1 }),
      region({ x: 0, y: 0 }, ANGLE_CLASSES, { z: 4 }),
    ]);
    expect(cpSuppressedClassesAt(flipped, { x: 0, y: 0 })).toEqual(ANGLE_CLASSES);
  });

  it('reaches a point-less finding with the document rule only', () => {
    const rules = cpCheckSuppressionRules(ANGLE_CLASSES, [region({ x: 0, y: 0 }, [])]);
    const pointless: OristudioCpDiagnosticEntry = {
      id: 'angles-no-point',
      kind: 'VertexFlatFoldability',
      severity: 'error',
      message: 'x',
      rule: 'Angles',
      violation_color: 'Unknown',
    };
    // The region cannot claim it — there is no position to test — so the
    // document rule stands.
    expect(isCpDiagnosticSuppressed(pointless, rules)).toBe(true);
  });
});

describe('partitionCpDiagnosticsBySuppression', () => {
  const entries = [
    violation('Angles'),
    violation('Angles', 'NotEnoughMountain'),
    violation('NumberOfFolds'),
    violation('BigLittleBig'),
  ];

  it('keeps the input array identity when nothing is hidden', () => {
    expect(partitionCpDiagnosticsBySuppression(entries, NO_CP_CHECK_SUPPRESSION).visible).toBe(
      entries
    );
    expect(partitionCpDiagnosticsBySuppression(entries, documentRules('vertexClosure')).visible).toBe(
      entries
    );
  });

  it('splits the two angle classes out and leaves the rest', () => {
    const { visible, hidden } = partitionCpDiagnosticsBySuppression(
      entries,
      cpCheckSuppressionRules(ANGLE_CLASSES)
    );
    expect(visible.map((entry) => entry.rule)).toEqual(['Angles', 'NumberOfFolds']);
    expect(visible[0]?.violation_color).toBe('NotEnoughMountain');
    expect(hidden).toHaveLength(2);
  });
});

describe('cpCommandResultWithSuppression', () => {
  const result = {
    operation: 'CheckCamv',
    status: 'OracleTested',
    diagnostics: [{}],
    diagnostic_entries: [violation('Angles'), violation('NumberOfFolds')],
  } as unknown as Parameters<typeof cpCommandResultWithSuppression>[0];

  it('passes a result through untouched when nothing is hidden', () => {
    expect(cpCommandResultWithSuppression(result, NO_CP_CHECK_SUPPRESSION)).toBe(result);
    expect(cpCommandResultWithSuppression(null, documentRules('kawasaki'))).toBeNull();
  });

  it('returns a copy carrying only the surviving findings', () => {
    const filtered = cpCommandResultWithSuppression(result, documentRules('kawasaki'));
    expect(filtered?.diagnostic_entries?.map((entry) => entry.rule)).toEqual(['NumberOfFolds']);
    // The original is untouched — the HUD still counts from the union.
    expect(result?.diagnostic_entries).toHaveLength(2);
  });
});

describe('cpCheckClassLabel', () => {
  const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

  it('names the theorem for every class', () => {
    expect(CP_CHECK_CLASSES.map((checkClass) => cpCheckClassLabel(t, checkClass))).toEqual([
      'Kawasaki (angles)',
      'Big-little-big',
      'Maekawa (parity)',
      'Vertex closure',
    ]);
  });
});
