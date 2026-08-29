import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CREASE_ANGLE_DEGREES,
  creaseAnglePayloadDegrees,
  creaseAnglePreviewMagnitude,
  formatCreaseAngle,
  formatCreaseAngleValue,
  isClassicCreaseAngle,
  isValidCreaseAngle,
  parseCreaseAngle,
} from './activeCreaseAngle';
import { degreesToFoldMagnitude } from '../../lib/foldAngle';
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
  it('reads a typed number as a magnitude with no direction', () => {
    expect(parseCreaseAngle('90')).toEqual({ degrees: 90, direction: null });
    expect(parseCreaseAngle('  45.5 ')).toEqual({ degrees: 45.5, direction: null });
  });

  /**
   * The app's convention, and the FOLD spec's: negative mountain, positive
   * valley. The same reading `foldAngleFromParts` gives a crease, which is why
   * a mountain badges as `-45°` — so what you type is what you get labelled.
   */
  it('reads a sign as the fold direction', () => {
    expect(parseCreaseAngle('-45')).toEqual({ degrees: 45, direction: 'Mountain' });
    expect(parseCreaseAngle('+45')).toEqual({ degrees: 45, direction: 'Valley' });
    expect(parseCreaseAngle(' -180 ')).toEqual({ degrees: 180, direction: 'Mountain' });
  });

  /**
   * Only an *explicit* sign decides. Reading a bare `45` as positive would mean
   * every angle change also flipped you to valley, leaving no way to restyle a
   * mountain's angle — the common case.
   */
  it('does not invent a direction for an unsigned entry', () => {
    expect(parseCreaseAngle('45')?.direction).toBeNull();
    expect(parseCreaseAngle('0')?.direction).toBeNull();
  });

  // Zero folds neither way, so a sign on it names nothing.
  it('gives zero no direction, signed or not', () => {
    expect(parseCreaseAngle('-0')).toEqual({ degrees: 0, direction: null });
    expect(parseCreaseAngle('+0')).toEqual({ degrees: 0, direction: null });
  });

  // Blank is "you told me nothing", not "use the default". Defaulting here
  // would silently discard a pen the user had already set.
  it('reads blank and junk as no answer', () => {
    expect(parseCreaseAngle('')).toBeNull();
    expect(parseCreaseAngle('   ')).toBeNull();
    expect(parseCreaseAngle('abc')).toBeNull();
    expect(parseCreaseAngle('200')).toBeNull();
    expect(parseCreaseAngle('-200')).toBeNull();
  });
});

/**
 * The readout is a magnitude even though the input accepts a sign, and that
 * asymmetry is deliberate: the pen is a magnitude, its direction is the active
 * line type, and the rail already shows a whole row of that. A sign typed here
 * is a shortcut for two settings at once, not a value the field goes on to hold.
 */
describe('the readout stays unsigned', () => {
  it('shows a magnitude whatever direction was typed to reach it', () => {
    expect(parseCreaseAngle('-45')).toEqual({ degrees: 45, direction: 'Mountain' });
    expect(formatCreaseAngle(45)).toBe('45°');
    expect(formatCreaseAngleValue(45)).toBe('45');
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

describe('creaseAnglePreviewMagnitude', () => {
  it('converts to the kernel storage units the ink ramp reads', () => {
    expect(creaseAnglePreviewMagnitude(90)).toBe(degreesToFoldMagnitude(90));
    expect(creaseAnglePreviewMagnitude(0)).toBe(0);
  });

  it('is undefined for a full fold, which every display mode passes through', () => {
    expect(creaseAnglePreviewMagnitude(180)).toBeUndefined();
  });

  /**
   * The property the preview fix is actually about, and the reason this is
   * derived from `creaseAnglePayloadDegrees` rather than written beside it: the
   * stroke shades a fold exactly when the command sends one. Two independent
   * answers to "is the pen doing anything" is how a preview and its commit
   * drift apart — which is the bug that shipped, where a 90° drag drew flat and
   * then committed a 90° crease.
   */
  it('shades exactly when the payload sends an angle', () => {
    for (const degrees of [0, 22.5, 45, 90, 135, 179.9, 180, 200, Number.NaN]) {
      const sends = creaseAnglePayloadDegrees(degrees) !== undefined;
      const shades = creaseAnglePreviewMagnitude(degrees) !== undefined;
      expect(shades, `pen at ${degrees}`).toBe(sends);
    }
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
