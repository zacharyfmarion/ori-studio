import { describe, expect, it, vi } from 'vitest';
import { surfacePressClaim, type SurfacePressInput } from './surfacePressClaim';

/** A primary press on empty space — the one input that leaves the object alone. */
const objectPress: SurfacePressInput = {
  button: 0,
  metaKey: false,
  panToolActive: false,
  hit: () => null,
};

describe('surfacePressClaim', () => {
  it('leaves a plain press on empty space to the object', () => {
    // The case that keeps a reference image movable at all: inside its box, away
    // from any crease, a press still selects and drags the image.
    expect(surfacePressClaim(objectPress)).toBeNull();
  });

  it('claims a press on a crease', () => {
    // The reported bug: a crease drawn over a reference image was unselectable.
    expect(surfacePressClaim({ ...objectPress, hit: () => ({ kind: 'line', id: 6 }) })).toBe(
      'crease'
    );
  });

  it('claims a press on a point or a circle too', () => {
    // Every primitive `hitTest` can return is real geometry, and all three are
    // drawn above the image. Singling out lines would leave points and circles
    // pickable everywhere except over an image.
    expect(surfacePressClaim({ ...objectPress, hit: () => ({ kind: 'point', id: 2 }) })).toBe(
      'crease'
    );
    expect(surfacePressClaim({ ...objectPress, hit: () => ({ kind: 'circle', id: 1 }) })).toBe(
      'crease'
    );
  });

  it('claims a secondary press on a crease, so erase reaches creases over an image', () => {
    expect(
      surfacePressClaim({ ...objectPress, button: 2, hit: () => ({ kind: 'line', id: 6 }) })
    ).toBe('crease');
  });

  it('leaves a secondary press on empty space, so the image keeps its context menu', () => {
    // The secondary button asks the same question as the primary rather than
    // claiming outright. Claiming it unconditionally would be the upstream-parity
    // answer for erase — but it would take the image's own context menu away with
    // nothing put in its place, and the floating inspector only appears once the
    // image is already selected.
    expect(surfacePressClaim({ ...objectPress, button: 2 })).toBeNull();
  });

  it('calls the middle button, Meta and the hand tool a pan, so pan never dies', () => {
    expect(surfacePressClaim({ ...objectPress, button: 1 })).toBe('pan');
    expect(surfacePressClaim({ ...objectPress, metaKey: true })).toBe('pan');
    expect(surfacePressClaim({ ...objectPress, panToolActive: true })).toBe('pan');
  });

  it('says pan even over a crease, which is what makes the verdict two-valued', () => {
    // The distinction the callers need. A body you can see the pattern through
    // yields to either answer; a resize handle, an opaque folded figure and a
    // region's chip bar yield only to 'pan' — so answering one boolean for both
    // questions is what let a Cmd+drag on those move the object instead.
    const onACrease = { hit: () => ({ kind: 'line', id: 6 }) as const };
    expect(surfacePressClaim({ ...objectPress, ...onACrease, metaKey: true })).toBe('pan');
    expect(surfacePressClaim({ ...objectPress, ...onACrease, button: 1 })).toBe('pan');
    expect(surfacePressClaim({ ...objectPress, ...onACrease, panToolActive: true })).toBe('pan');
  });

  it('does not hit-test a pan, which is every press while the modifier is held', () => {
    // The reason `hit` is a thunk. With Meta down, every press and every
    // coalesced hover probe takes the pan branch, and paying for a query whose
    // answer cannot be read would put a 50k-crease pattern's worst case (~500 µs)
    // into a per-frame path for nothing.
    const hit = vi.fn(() => null);
    surfacePressClaim({ ...objectPress, metaKey: true, hit });
    expect(hit).not.toHaveBeenCalled();

    surfacePressClaim({ ...objectPress, hit });
    expect(hit).toHaveBeenCalledTimes(1);
  });
});
