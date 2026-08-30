import { describe, expect, it } from 'vitest';
import {
  VIEW_CUBE_FACES,
  viewCubeRotation,
  viewCubeTransform,
  visibleViewCubeFaces,
} from './viewCubeGeometry';
import {
  setUprightView,
  simulatorViewLookingFrom,
  type SimulatorOrbitView,
} from '../../lib/simulatorOrbit';
import type { Mat3 } from '@treemaker/origami-simulator';

/**
 * The cube's transform.
 *
 * One property carries the whole design and it is not visible by looking at the
 * cube: the renderer's view transform is a *reflection*, so a cube fed through
 * it unaccompanied paints mirror-reversed labels at every angle. `CUBE_BASIS`
 * cancels that, and "it cancelled" is exactly `det = +1`.
 */

const VIEWS: SimulatorOrbitView[] = [
  { yaw: Math.PI / 4, pitch: -0.955, zoom: 1.4 },
  { yaw: 0, pitch: 0, zoom: 1 },
  { yaw: 0, pitch: -Math.PI / 2, zoom: 1 },
  { yaw: 0, pitch: -Math.PI, zoom: 1 },
  { yaw: -2.1, pitch: 0.6, zoom: 0.8 },
  setUprightView({ yaw: 1.2, pitch: 0.3, zoom: 2.5 }),
];

function determinant(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** How far `mᵀ · m` is from the identity. Zero exactly when m is orthonormal. */
function orthonormalError(m: Mat3): number {
  let worst = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const dot = m[row]! * m[col]! + m[3 + row]! * m[3 + col]! + m[6 + row]! * m[6 + col]!;
      worst = Math.max(worst, Math.abs(dot - (row === col ? 1 : 0)));
    }
  }
  return worst;
}

describe('the view cube transform', () => {
  it('is a rotation, not a reflection', () => {
    // The one thing that can be wrong and still look like a cube. A negative
    // determinant here means every label is painted back to front.
    for (const view of VIEWS) {
      expect(determinant(viewCubeRotation(view))).toBeCloseTo(1, 12);
    }
  });

  it('is orthonormal, so the cube is never sheared or scaled', () => {
    for (const view of VIEWS) {
      expect(orthonormalError(viewCubeRotation(view))).toBeLessThan(1e-12);
    }
  });

  it('shows front, right and top at the simulator’s opening view', () => {
    // The eye is on the (1, 1, −1) diagonal, so exactly those three faces are
    // turned toward it — and which three is what the labels are read off.
    const visible = VIEW_CUBE_FACES.filter(
      (_, index) => (visibleViewCubeFaces(VIEWS[0]!) & (1 << index)) !== 0
    ).map((face) => face.id);
    expect(visible.sort()).toEqual(['front', 'right', 'top']);
  });

  it('shows exactly the face that was snapped to, and its two neighbours', () => {
    for (const face of VIEW_CUBE_FACES) {
      const snapped = simulatorViewLookingFrom(VIEWS[0]!, face.direction);
      const mask = visibleViewCubeFaces(snapped);
      const index = VIEW_CUBE_FACES.indexOf(face);
      const opposite = VIEW_CUBE_FACES.findIndex((other) =>
        other.direction.every((axis, i) => axis === -face.direction[i]!)
      );
      expect((mask & (1 << index)) !== 0, `${face.id} faces the eye`).toBe(true);
      expect((mask & (1 << opposite)) !== 0, `${face.id}'s opposite is hidden`).toBe(false);
    }
  });

  it('emits a column-major matrix3d', () => {
    // Row-major in, column-major out. A transposed upload is a plausible-looking
    // cube that turns the wrong way, so the transpose is pinned rather than
    // trusted: entry [0][2] must land in the third column's first slot.
    const m = viewCubeRotation(VIEWS[0]!);
    const parts = viewCubeTransform(VIEWS[0]!)
      .replace(/^matrix3d\(|\)$/g, '')
      .split(',')
      .map(Number);
    expect(parts).toHaveLength(16);
    expect(parts[0]).toBeCloseTo(m[0]!, 5);
    expect(parts[1]).toBeCloseTo(m[3]!, 5);
    expect(parts[8]).toBeCloseTo(m[2]!, 5);
    expect(parts.slice(12)).toEqual([0, 0, 0, 1]);
  });

  it('sets each face’s own axes consistently', () => {
    // `right × down = direction` on every face. The spots are built from these
    // by arithmetic, so a transposed or negated axis here would quietly aim four
    // of a face's eight neighbours at the wrong viewpoints.
    for (const face of VIEW_CUBE_FACES) {
      const [rx, ry, rz] = face.right;
      const [dx, dy, dz] = face.down;
      // `+ 0` normalizes the signed zeros the products throw off; −0 and 0 are
      // the same axis and `toEqual` is the only thing that disagrees.
      const cross = [ry * dz - rz * dy, rz * dx - rx * dz, rx * dy - ry * dx].map((v) => v + 0);
      expect(cross, face.id).toEqual([...face.direction]);
    }
  });

  it('offers the 26 viewpoints, nine at a time', () => {
    const seen = new Map<string, string>();
    for (const face of VIEW_CUBE_FACES) {
      expect(face.spots, face.id).toHaveLength(9);
      for (const spot of face.spots) {
        expect(Math.hypot(...spot.direction), face.id).toBeCloseTo(1, 12);
        seen.set(
          spot.direction.map((axis) => axis.toFixed(6)).join(','),
          spot.kind
        );
      }
    }
    // 6 faces + 12 edges + 8 corners, each named by however many faces touch it.
    const kinds = [...seen.values()];
    expect(kinds.filter((kind) => kind === 'face')).toHaveLength(6);
    expect(kinds.filter((kind) => kind === 'edge')).toHaveLength(12);
    expect(kinds.filter((kind) => kind === 'corner')).toHaveLength(8);
  });

  it('reaches the opening view from a corner spot', () => {
    // The simulator opens on the (1, 1, −1) diagonal, so one of the corners has
    // to *be* that viewpoint — otherwise the view the app starts at is the one
    // the cube cannot return to.
    const root = 1 / Math.sqrt(3);
    const opening = VIEW_CUBE_FACES.flatMap((face) => face.spots).find(
      (spot) =>
        Math.abs(spot.direction[0] - root) < 1e-9 &&
        Math.abs(spot.direction[1] - root) < 1e-9 &&
        Math.abs(spot.direction[2] + root) < 1e-9
    );
    expect(opening?.kind).toBe('corner');
  });

  it('names each face once, with unit directions', () => {
    expect(VIEW_CUBE_FACES).toHaveLength(6);
    expect(new Set(VIEW_CUBE_FACES.map((face) => face.id)).size).toBe(6);
    for (const face of VIEW_CUBE_FACES) {
      const length = Math.hypot(...face.direction);
      expect(length, face.id).toBeCloseTo(1, 12);
    }
  });
});
