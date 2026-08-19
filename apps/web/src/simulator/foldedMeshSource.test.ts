import { describe, expect, it } from 'vitest';
import { cameraUniforms, type CameraUniforms } from '@treemaker/origami-simulator';
import { folded3dDrawPasses } from './foldedMeshSource';
import type { Folded3dSkin } from '../cp-workspace/folded/folded3dMesh';

const OPAQUE = { showFaces: true, showEdges: true, faceAlpha: 1 };

/** Looking straight down `+y` in the mesh basis, which is `up` for plane 0. */
function cameraAt(pitch: number): CameraUniforms {
  return cameraUniforms({ yaw: 0, pitch, zoom: 1 }, [0, 0, 0], 1, 256, 256);
}

/** `up` toward the eye at pitch 0, away at pitch π. */
const FROM_ABOVE = cameraAt(0);
const FROM_BELOW = cameraAt(Math.PI);

function skin(plane: number, side: 1 | -1, at: number, depth = 0): Folded3dSkin {
  return {
    plane,
    // `+y` in the mesh basis: `toViewSpace` puts it on the depth axis at pitch 0.
    up: [0, 1, 0],
    // On the depth axis at pitch 0, so `depth` orders the passes directly.
    centroid: [0, depth, 0],
    side,
    faceIndexStart: at * 3,
    faceIndexCount: 3,
    edgeStart: at,
    edgeCount: 1,
    hingeGroups: [],
  };
}

/**
 * Two planes, each with a front and a back skin, laid out in the order the mesh
 * builder emits them: `[p0 front][p0 back][p1 front][p1 back]`.
 */
const MESH = {
  skins: [skin(0, 1, 0), skin(0, -1, 1), skin(1, 1, 2), skin(1, -1, 3)],
  translucent: { faceIndexStart: 12, faceIndexCount: 24, edgeStart: 4, edgeCount: 8 },
  undetermined: { faceIndexStart: 36, faceIndexCount: 9, edgeStart: 12, edgeCount: 3 },
  undeterminedFaceAlpha: 0.45,
};

/** The same figure with every cell resolved — the ordinary case. */
const DETERMINED = {
  ...MESH,
  undetermined: { faceIndexStart: 36, faceIndexCount: 0, edgeStart: 12, edgeCount: 0 },
};

describe('breaking a folded figure into draws', () => {
  it('draws the skin that faces the eye, and only that one', () => {
    // A plane's visible surface is the top face of each of its cells from one
    // side and the bottom face from the other. Drawing both would put a buried
    // layer's paper and linework on screen, which is the whole bug this replaced.
    // Both planes chose their `+1` skin. Those sit at 0 and 6 with each plane's
    // back skin between them, so they cannot merge — one pass each, and neither
    // touches the back skins at 3 and 9.
    const above = folded3dDrawPasses(DETERMINED, OPAQUE, FROM_ABOVE);
    expect(above.map((pass) => pass.faceRange)).toEqual([
      { start: 0, count: 3 },
      { start: 6, count: 3 },
    ]);

    const below = folded3dDrawPasses(DETERMINED, OPAQUE, FROM_BELOW);
    expect(below.map((pass) => pass.faceRange)).toEqual([
      { start: 3, count: 3 },
      { start: 9, count: 3 },
    ]);
  });

  it('draws the planes far-to-near', () => {
    // The whole reason the order matters: a fold line lies in *both* planes it
    // joins, so along it they are at exactly the same depth and no epsilon can
    // separate them at every camera. Drawing the farther plane first lets the
    // nearer one's paper land on top of the farther one's linework and cover it,
    // which settles the tie discretely.
    //
    // Plane 1 is nearer (view depth grows toward the eye), so it must be drawn
    // second even though it comes second in the buffer.
    const ordered = {
      ...DETERMINED,
      skins: [skin(0, 1, 0, 5), skin(0, -1, 1, 5), skin(1, 1, 2, -5), skin(1, -1, 3, -5)],
    };
    const passes = folded3dDrawPasses(ordered, OPAQUE, FROM_ABOVE);
    expect(passes.map((pass) => pass.faceRange)).toEqual([
      { start: 6, count: 3 },
      { start: 0, count: 3 },
    ]);

    // And reversing the depths reverses the draws — the order is read off the
    // camera, not off the buffer.
    const flipped = {
      ...DETERMINED,
      skins: [skin(0, 1, 0, -5), skin(0, -1, 1, -5), skin(1, 1, 2, 5), skin(1, -1, 3, 5)],
    };
    expect(folded3dDrawPasses(flipped, OPAQUE, FROM_ABOVE).map((pass) => pass.faceRange)).toEqual([
      { start: 0, count: 3 },
      { start: 6, count: 3 },
    ]);
  });

  it('covers every plane', () => {
    // One pass per run of planes that agreed, and between them every plane is
    // drawn exactly once. A plane left out is a sheet of paper that vanishes.
    for (const camera of [FROM_ABOVE, FROM_BELOW]) {
      const passes = folded3dDrawPasses(DETERMINED, OPAQUE, camera);
      const drawn = passes.flatMap((pass) =>
        pass.faceRange ? [[pass.faceRange.start, pass.faceRange.count] as const] : [],
      );
      const total = drawn.reduce((sum, [, count]) => sum + count, 0);
      expect(total).toBe((MESH.skins.length / 2) * 3);
    }
  });

  it('merges consecutive planes that chose the same side', () => {
    // `[p0 front][p0 back][p1 front][p1 back]` — at a camera where p0 takes its
    // back skin and p1 its front, the two are adjacent and become one draw.
    // Plane 0 turned over: both its skins carry the flipped `up`, so it selects
    // its back skin at 3 while plane 1 still selects its front at 6.
    const flipped: [number, number, number] = [0, -1, 0];
    const mixed = {
      ...DETERMINED,
      skins: [
        { ...skin(0, 1, 0), up: flipped },
        { ...skin(0, -1, 1), up: flipped },
        skin(1, 1, 2),
        skin(1, -1, 3),
      ],
    };
    const passes = folded3dDrawPasses(mixed, OPAQUE, FROM_ABOVE);
    expect(passes).toHaveLength(1);
    expect(passes[0]!.faceRange).toEqual({ start: 3, count: 6 });
    expect(passes[0]!.edgeRange).toEqual({ start: 1, count: 2 });
  });

  it('draws the unordered cells translucent, after the rest', () => {
    // The signal itself: "these layers could be either way round" is said by
    // seeing through them, not by picking one order and drawing it confidently.
    // They have no top and no bottom, so no skin can contain them.
    const passes = folded3dDrawPasses(MESH, OPAQUE, FROM_ABOVE);
    expect(passes.map((pass) => pass.faceAlpha)).toEqual([1, 1, 0.45]);
    const last = passes[passes.length - 1]!;
    expect(last.faceRange).toEqual({ start: 36, count: 9 });
    expect(last.edgeRange).toEqual({ start: 12, count: 3 });
  });

  it('clears once, on the first pass only', () => {
    // A clear on a later pass erases the earlier ones, which is the whole reason
    // `MeshDrawOptions.clear` exists.
    const passes = folded3dDrawPasses(MESH, OPAQUE, FROM_ABOVE);
    expect(passes.length).toBeGreaterThan(1);
    expect(passes.map((pass) => pass.clear)).toEqual([true, ...passes.slice(1).map(() => false)]);
  });

  it('draws every layer once for a translucent style', () => {
    // The skins hide most of the stack, which is the opposite of what an X-ray
    // style is for. Coplanar layers are harmless here: translucent faces do not
    // write depth, so they blend in draw order rather than competing for it.
    const passes = folded3dDrawPasses(MESH, { ...OPAQUE, faceAlpha: 0.06 }, FROM_ABOVE);
    expect(passes[0]!.faceRange).toEqual({ start: 12, count: 24 });
    expect(passes[0]!.edgeRange).toEqual({ start: 4, count: 8 });
    expect(passes.every((pass) => pass.faceAlpha === 0.06)).toBe(true);
  });

  it('draws skins for a wireframe style, which draws no faces at all', () => {
    // No paper means no occlusion to arrange — but a wireframe still wants one
    // line per crease rather than one per layer, and that is what a skin is.
    const passes = folded3dDrawPasses(DETERMINED, { ...OPAQUE, showFaces: false }, FROM_ABOVE);
    expect(passes[0]!.edgeRange).toEqual({ start: 0, count: 1 });
  });

  it('keeps the caller’s edge setting', () => {
    // `None0` draws neither, and a pass must not quietly turn creases back on.
    const passes = folded3dDrawPasses(DETERMINED, { ...OPAQUE, showEdges: false }, FROM_ABOVE);
    expect(passes.every((pass) => pass.showEdges === false)).toBe(true);
  });

  it('always clears, even with nothing to draw', () => {
    // Otherwise the previous frame shows through a figure that has become empty.
    const empty = {
      skins: [],
      translucent: { faceIndexStart: 0, faceIndexCount: 0, edgeStart: 0, edgeCount: 0 },
      undetermined: { faceIndexStart: 0, faceIndexCount: 0, edgeStart: 0, edgeCount: 0 },
      undeterminedFaceAlpha: 0.45,
    };
    const passes = folded3dDrawPasses(empty, OPAQUE, FROM_ABOVE);
    expect(passes).toHaveLength(1);
    expect(passes[0]!.clear).toBe(true);
  });

  it('draws the creases that belong to no layer, once', () => {
    // The ink fallback sits at the head of the crease buffer, before the first
    // skin, and no skin carries it — so it needs a pass of its own.
    const withFallback = {
      ...DETERMINED,
      skins: DETERMINED.skins.map((s) => ({ ...s, edgeStart: s.edgeStart + 2 })),
    };
    const passes = folded3dDrawPasses(withFallback, OPAQUE, FROM_ABOVE);
    const fallback = passes.filter(
      (pass) => pass.edgeRange?.start === 0 && pass.faceRange?.count === 0,
    );
    expect(fallback).toHaveLength(1);
    expect(fallback[0]!.edgeRange).toEqual({ start: 0, count: 2 });
  });
});
