import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CREASE_ANGLE_DEGREES,
  creaseAnglePayloadDegrees,
  formatCreaseAngle,
  formatCreaseAngleValue,
  isClassicCreaseAngle,
  isValidCreaseAngle,
  parseCreaseAngle,
} from './activeCreaseAngle';
import {
  cpCommandUsesActiveCreaseAngle,
  cpCommandUsesActiveLineColor,
} from '../../lib/oristudioCpCommands';

describe('isValidCreaseAngle', () => {
  it('accepts the closed range the kernel accepts', () => {
    expect(isValidCreaseAngle(0)).toBe(true);
    expect(isValidCreaseAngle(180)).toBe(true);
    expect(isValidCreaseAngle(90.5)).toBe(true);
  });

  it('rejects out-of-range and non-finite values', () => {
    for (const value of [-1, 181, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isValidCreaseAngle(value)).toBe(false);
    }
  });
});

describe('parseCreaseAngle', () => {
  it('reads a typed number', () => {
    expect(parseCreaseAngle('90')).toBe(90);
    expect(parseCreaseAngle('  45.5 ')).toBe(45.5);
  });

  // Blank is "you told me nothing", not "use the default". Defaulting here
  // would silently discard a pen the user had already set.
  it('reads blank and junk as no answer', () => {
    expect(parseCreaseAngle('')).toBeNull();
    expect(parseCreaseAngle('   ')).toBeNull();
    expect(parseCreaseAngle('abc')).toBeNull();
    expect(parseCreaseAngle('200')).toBeNull();
  });
});

describe('creaseAnglePayloadDegrees', () => {
  // The point of omitting rather than sending 180: an ordinary classic draw
  // produces the payload it produced before the pen existed.
  it('omits a full fold', () => {
    expect(creaseAnglePayloadDegrees(DEFAULT_CREASE_ANGLE_DEGREES)).toBeUndefined();
  });

  it('sends anything else', () => {
    expect(creaseAnglePayloadDegrees(90)).toBe(90);
    expect(creaseAnglePayloadDegrees(0)).toBe(0);
  });

  it('omits a value the kernel would reject', () => {
    expect(creaseAnglePayloadDegrees(200)).toBeUndefined();
    expect(creaseAnglePayloadDegrees(Number.NaN)).toBeUndefined();
  });
});

describe('isClassicCreaseAngle', () => {
  it('is true exactly when nothing would be sent', () => {
    expect(isClassicCreaseAngle(180)).toBe(true);
    expect(isClassicCreaseAngle(90)).toBe(false);
    expect(isClassicCreaseAngle(0)).toBe(false);
  });
});

describe('formatting', () => {
  it('carries the degree sign and trims trailing zeros', () => {
    expect(formatCreaseAngle(90)).toBe('90°');
    expect(formatCreaseAngle(22.5)).toBe('22.5°');
    expect(formatCreaseAngle(70.528779)).toBe('70.53°');
  });

  it('drops the sign for the editable field', () => {
    expect(formatCreaseAngleValue(90)).toBe('90');
    expect(formatCreaseAngleValue(22.5)).toBe('22.5');
  });
});

describe('cpCommandUsesActiveCreaseAngle', () => {
  it('covers the ordinary draw tools', () => {
    for (const operation of [
      'DrawCreaseFree',
      'DrawCreaseRestricted',
      'DrawCreaseAngleRestricted',
      'SymmetricDraw',
      'PerpendicularDraw',
      'ParallelDraw',
      'Axiom5',
      'PolygonSetNoCorners',
      'VoronoiCreate',
      'LengthenCrease',
    ] as const) {
      expect(cpCommandUsesActiveCreaseAngle(operation)).toBe(true);
    }
  });

  // These fold flat by construction, so the pen must not reach them — a bird
  // base drawn at 90 degrees is not a bird base.
  it('excludes the classical bases', () => {
    for (const operation of [
      'DrawBlintz',
      'DrawFishBase',
      'DrawDoveBase',
      'DrawBirdBase',
      'DrawFrogBase',
    ] as const) {
      expect(cpCommandUsesActiveCreaseAngle(operation)).toBe(false);
    }
  });

  // Same principle: the whole output of these is a crease that makes a vertex
  // flat-foldable, which a non-180 crease at that vertex contradicts.
  it('excludes the vertex-completion tools', () => {
    for (const operation of [
      'VertexMakeAngularlyFlatFoldable',
      'FoldableLineDraw',
      'FoldableLineInput',
    ] as const) {
      expect(cpCommandUsesActiveCreaseAngle(operation)).toBe(false);
    }
  });

  // The same-colour variant inherits the crease's colour, so it inherits its
  // angle too; the active-colour variant draws fresh and takes the pen.
  it('splits the two lengthen variants', () => {
    expect(cpCommandUsesActiveCreaseAngle('LengthenCreaseSameColor')).toBe(false);
    expect(cpCommandUsesActiveCreaseAngle('LengthenCrease')).toBe(true);
  });

  it('is a strict subset of the active-line-colour tools', () => {
    for (const operation of [
      'DrawBlintz',
      'VertexMakeAngularlyFlatFoldable',
      'LengthenCreaseSameColor',
    ] as const) {
      // Every exclusion has to be a tool that *would* otherwise qualify —
      // otherwise the entry is dead and the set has drifted from what it
      // subtracts from.
      const qualifies =
        cpCommandUsesActiveLineColor(operation) || operation === 'LengthenCreaseSameColor';
      expect(qualifies).toBe(true);
    }
  });

  it('is false for a command that draws nothing', () => {
    expect(cpCommandUsesActiveCreaseAngle('CreaseSetFoldAngle')).toBe(false);
    expect(cpCommandUsesActiveCreaseAngle(undefined)).toBe(false);
  });
});
