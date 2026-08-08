import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';
import {
  FOLDABILITY_COLORS,
  FOLDABILITY_RULES,
  cpDiagnosticEntryMessage,
  foldabilityEntryMessage,
  foldabilityViolationMessage,
  type FoldabilityColor,
  type FoldabilityRule,
} from './foldabilityMessages';

// The real `t`, minus i18next: return the English default and interpolate. Keeps
// these assertions about the *wording* rather than about key plumbing, which the
// i18n:check gate covers separately.
const t = ((key: string, fallback: string, vars?: Record<string, string>) =>
  fallback.replace(
    /\{\{(\w+)\}\}/gu,
    (_, name: string) => vars?.[name] ?? ''
  )) as unknown as TFunction;

function entry(over: Partial<OristudioCpDiagnosticEntry> = {}): OristudioCpDiagnosticEntry {
  return {
    id: 'CheckCamv-1',
    kind: 'CheckCamv',
    severity: 'error',
    message: 'Flat-foldability violation: Maekawa',
    ...over,
  };
}

describe("Oriedita's vocabulary", () => {
  // Transcribed from Oriedita's CAMV tooltip. The colour phrase is only half the
  // sentence — the shape carries the rest — so these pin both halves.
  it.each([
    // Triangle: incorrect (odd) number of folds.
    ['NumberOfFolds', 'NotEnoughMountain', 'Odd number of folds — not enough mountain folds'],
    ['NumberOfFolds', 'NotEnoughValley', 'Odd number of folds — not enough valley folds'],
    ['NumberOfFolds', 'Unknown', 'Too many or not enough edge lines'],
    // Square: incorrect fold types. The shape's fact *is* the colour's, so the
    // phrase stands alone rather than repeating itself.
    ['Maekawa', 'NotEnoughMountain', 'Not enough mountain folds'],
    ['Maekawa', 'NotEnoughValley', 'Not enough valley folds'],
    ['Maekawa', 'Equal', 'Equal amount of mountain and valley folds'],
    ['Maekawa', 'Unknown', 'Invalid configuration of edge lines'],
    // Circle: incorrect angles. Solid is the legend's own "like squares, but
    // with incorrect angles"; hollow is the angles alone.
    ['Angles', 'NotEnoughMountain', 'Incorrect angles — not enough mountain folds'],
    ['Angles', 'NotEnoughValley', 'Incorrect angles — not enough valley folds'],
    ['Angles', 'Equal', 'Incorrect angles — equal amount of mountain and valley folds'],
    ['Angles', 'Correct', 'Incorrect angles'],
    // No legend entry upstream — Oriedita draws this as sectors, not a marker.
    ['LittleBigLittle', 'Correct', 'Angles cannot nest (little-big-little)'],
  ] as const)('%s + %s reads "%s"', (rule, color, expected) => {
    expect(foldabilityViolationMessage(t, rule, color)).toBe(expected);
  });

  it('never says "flat-foldability violation"', () => {
    // The string this change exists to remove. It named the theorem rather than
    // the problem, which is the opposite of what someone fixing a CP needs.
    for (const rule of FOLDABILITY_RULES) {
      for (const color of FOLDABILITY_COLORS) {
        expect(foldabilityViolationMessage(t, rule, color) ?? '').not.toMatch(/violation/iu);
      }
    }
  });
});

describe('the table covers what the kernel can emit', () => {
  // FOLDABILITY_RULES / FOLDABILITY_COLORS mirror `checks::FlatFoldabilityRule`
  // and `FlatFoldabilityColor`. Enumerating the full cross product — not just
  // the pairs `find_flat_foldability_violation` reaches today — is what makes a
  // new kernel variant fail here rather than render blank in the HUD.
  it.each(FOLDABILITY_RULES.filter((rule) => rule !== 'None'))(
    'answers every colour for %s',
    (rule) => {
      for (const color of FOLDABILITY_COLORS) {
        const message = foldabilityViolationMessage(t, rule as FoldabilityRule, color);
        expect(message, `${rule} + ${color}`).toBeTruthy();
      }
    }
  );

  it('declines a violation with no rule, so the kernel message survives', () => {
    for (const color of FOLDABILITY_COLORS) {
      expect(foldabilityViolationMessage(t, 'None', color)).toBeNull();
    }
  });
});

describe('self-intersection', () => {
  // Not one of Oriedita's rules. The vertex closes — the fold angles agree —
  // but the paper cannot reach that state without passing through itself, which
  // nothing else in the app reports.
  it('reads as the paper crossing itself, not as an angle disagreement', () => {
    const message = cpDiagnosticEntryMessage(
      t,
      entry({ kind: 'SpatialSelfIntersection', rule: 'SelfIntersection' })
    );
    expect(message).toBe('Paper passes through itself here');
    expect(message).not.toMatch(/close|angle/iu);
  });

  it('does not need a violation colour, unlike the Oriedita rules', () => {
    // The flat rules carry a colour saying *how* they failed; this one has a
    // single failure mode, so the entry arrives without one and must still
    // resolve rather than falling through to the kernel string.
    const message = cpDiagnosticEntryMessage(t, entry({ rule: 'SelfIntersection' }));
    expect(message).not.toBe('Flat-foldability violation: Maekawa');
  });
});

describe('borders inside the paper', () => {
  // Also not one of Oriedita's rules, and deliberately not phrased as a defect:
  // a cut is a legitimate thing to draw. What the entry reports is that the
  // foldability check declines every vertex touching a border, so its silence
  // along this edge is not a verdict.
  it('says the check does not run there, not that something is wrong', () => {
    const message = cpDiagnosticEntryMessage(
      t,
      entry({
        kind: 'SpatialInteriorBorder',
        rule: 'InteriorBorder',
        severity: 'warning',
        message: 'Border with paper on both sides: the vertices on it are not checked',
      })
    );

    expect(message).toBe('Edge with paper on both sides — foldability is not checked along it');
    expect(message).not.toMatch(/violation|error|invalid/iu);
  });
});

describe('entries this table does not speak for', () => {
  it('falls back to the kernel message for spatial closure', () => {
    // This branch's own check, not Oriedita's. Its message is already prose and
    // carries a measured residual no lookup table could reproduce.
    const closure = entry({
      kind: 'SpatialClosure',
      rule: 'Closure',
      message: 'Creases do not close: 53.0000 degrees off',
    });
    expect(foldabilityEntryMessage(t, closure)).toBeNull();
    expect(cpDiagnosticEntryMessage(t, closure)).toBe('Creases do not close: 53.0000 degrees off');
  });

  it('falls back for overlap and T-junction checks', () => {
    const overlap = entry({
      kind: 'Check1',
      rule: 'Check1',
      message: 'Overlapping or contained non-auxiliary creases',
    });
    expect(cpDiagnosticEntryMessage(t, overlap)).toBe(
      'Overlapping or contained non-auxiliary creases'
    );
  });

  it('falls back on an unrecognised rule rather than rendering blank', () => {
    const future = entry({ rule: 'SomeRuleAddedLater', violation_color: 'NotEnoughMountain' });
    expect(cpDiagnosticEntryMessage(t, future)).toBe('Flat-foldability violation: Maekawa');
  });

  it('falls back when the rule is known but the colour is missing', () => {
    expect(cpDiagnosticEntryMessage(t, entry({ rule: 'Maekawa' }))).toBe(
      'Flat-foldability violation: Maekawa'
    );
  });
});

describe('a real entry', () => {
  it('replaces the kernel message when the pair is recognised', () => {
    const violation = entry({ rule: 'Maekawa', violation_color: 'NotEnoughMountain' });
    expect(cpDiagnosticEntryMessage(t, violation)).toBe('Not enough mountain folds');
  });

  it('reads the same for a triangle and a square except for the shape clause', () => {
    // Deliberate: this is Oriedita's vocabulary, where the marker shape is the
    // disambiguator. It is why the glyph ships with the wording rather than
    // after it.
    const square = cpDiagnosticEntryMessage(
      t,
      entry({ rule: 'Maekawa', violation_color: 'NotEnoughMountain' })
    );
    const triangle = cpDiagnosticEntryMessage(
      t,
      entry({ rule: 'NumberOfFolds', violation_color: 'NotEnoughMountain' })
    );
    expect(triangle).toContain(square.toLowerCase());
    expect(triangle).not.toBe(square);
  });
});

// Cheap guard on the mirrored enums: if a variant is added to `checks.rs`
// without being added here, the exhaustiveness test above cannot see it. The
// counts are the tripwire.
describe('mirrored kernel enums', () => {
  it('has the variant counts checks.rs declares', () => {
    expect(FOLDABILITY_RULES).toHaveLength(5);
    expect(FOLDABILITY_COLORS).toHaveLength(5);
  });

  it('types are the union of the listed variants', () => {
    const rule: FoldabilityRule = 'Maekawa';
    const color: FoldabilityColor = 'Equal';
    expect(FOLDABILITY_RULES).toContain(rule);
    expect(FOLDABILITY_COLORS).toContain(color);
  });
});
