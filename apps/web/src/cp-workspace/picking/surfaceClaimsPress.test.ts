import { describe, expect, it } from 'vitest';
import { surfaceClaimsPress, type SurfacePressInput } from './surfaceClaimsPress';

/** A primary press on empty space — the one input that leaves the object alone. */
const objectPress: SurfacePressInput = {
  button: 0,
  metaKey: false,
  panToolActive: false,
  hit: null,
};

describe('surfaceClaimsPress', () => {
  it('leaves a plain press on empty space to the object', () => {
    // The case that keeps a reference image movable at all: inside its box, away
    // from any crease, a press still selects and drags the image.
    expect(surfaceClaimsPress(objectPress)).toBe(false);
  });

  it('claims a press on a crease', () => {
    // The reported bug: a crease drawn over a reference image was unselectable.
    expect(surfaceClaimsPress({ ...objectPress, hit: { kind: 'line', id: 6 } })).toBe(true);
  });

  it('claims a press on a point or a circle too', () => {
    // Every primitive `hitTest` can return is real geometry, and all three are
    // drawn above the image. Singling out lines would leave points and circles
    // pickable everywhere except over an image.
    expect(surfaceClaimsPress({ ...objectPress, hit: { kind: 'point', id: 2 } })).toBe(true);
    expect(surfaceClaimsPress({ ...objectPress, hit: { kind: 'circle', id: 1 } })).toBe(true);
  });

  it('claims a secondary press on a crease, so erase reaches creases over an image', () => {
    expect(surfaceClaimsPress({ ...objectPress, button: 2, hit: { kind: 'line', id: 6 } })).toBe(
      true
    );
  });

  it('leaves a secondary press on empty space, so the image keeps its context menu', () => {
    // The secondary button asks the same question as the primary rather than
    // claiming outright. Claiming it unconditionally would be the upstream-parity
    // answer for erase — but it would take the image's own context menu away with
    // nothing put in its place, and the floating inspector only appears once the
    // image is already selected.
    expect(surfaceClaimsPress({ ...objectPress, button: 2 })).toBe(false);
  });

  it('claims the middle button, Meta and the hand tool, so pan never dies over an image', () => {
    expect(surfaceClaimsPress({ ...objectPress, button: 1 })).toBe(true);
    expect(surfaceClaimsPress({ ...objectPress, metaKey: true })).toBe(true);
    expect(surfaceClaimsPress({ ...objectPress, panToolActive: true })).toBe(true);
  });

  it('claims pan even on empty space, where the object would otherwise take it', () => {
    // Pan is unclaimable by design upstream — no tool may decline it — and it is
    // no more claimable by a reference image. Nothing is lost either way: the
    // overlay's own middle-button and Meta behaviour was only to select.
    expect(surfaceClaimsPress({ ...objectPress, button: 1, hit: null })).toBe(true);
    expect(surfaceClaimsPress({ ...objectPress, panToolActive: true, hit: null })).toBe(true);
  });
});
