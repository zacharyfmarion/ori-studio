import { multiplyMat3, viewDepthAxis, viewRotation, type Mat3 } from '@treemaker/origami-simulator';
import type { SimulatorOrbitView, SimulatorViewDirection } from '../../lib/simulatorOrbit';

/**
 * The view cube's geometry: where its faces are, and how the whole cube is
 * turned to match the camera.
 *
 * Pure — no React, no DOM. The component below it only reads strings out of
 * here, which is what lets the one thing that can be silently wrong (see
 * "handedness" below) be settled by a unit test rather than by looking at it.
 */

export type ViewCubeFaceId = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export type ViewCubeSpotKind = 'face' | 'edge' | 'corner';

/**
 * One of a face's nine hit regions, in reading order from its top-left.
 *
 * The middle one is the face; the four beside it are the cube's edges and the
 * four in the corners its corners — the same 26 viewpoints drei's `GizmoViewcube`
 * offers, reached the way a CSS cube can offer them. drei floats little boxes
 * outside the cube for these, which is natural in a 3D scene and would be six
 * more faces each here.
 *
 * It also fixes something faces alone cannot. From an exact face-on view the
 * other five faces are edge-on or behind, so with faces alone the cube is a dead
 * end: press Front once and nothing but Front is clickable until you drag. The
 * face you *are* looking at always offers its own eight neighbours.
 */
export interface ViewCubeSpot {
  kind: ViewCubeSpotKind;
  /** The eye direction to snap to. Unit length. */
  direction: SimulatorViewDirection;
  /**
   * Which of the 26 viewpoints this is, as a name shared by every cell that
   * reaches it.
   *
   * A corner belongs to three faces and an edge to two, so the same viewpoint is
   * offered from more than one place on the cube — three cells around a visible
   * corner all snap to the identical view. Hovering one lights all of them, and
   * this is what says which. Exact integers, not rounded coordinates: the axes
   * summed here are unit and mutually perpendicular, so every component is
   * already −1, 0 or 1.
   */
  viewpoint: string;
}

export interface ViewCubeFace {
  id: ViewCubeFaceId;
  /**
   * The eye direction this face snaps to, in the renderer's world — where Y is
   * the flat paper's normal and the axis yaw spins about.
   */
  direction: SimulatorViewDirection;
  /**
   * Places the face on the cube, before the cube itself is turned. Ordinary CSS
   * 3D cube transforms; `--view-cube-half` is half the cube's edge, so the size
   * lives in one place in the stylesheet rather than being baked in here.
   */
  transform: string;
  /**
   * Where the face's own right and down lie in the renderer's world — what the
   * {@link transform} above does to the face's local axes, stated rather than
   * re-derived, so {@link ViewCubeFace.spots} is arithmetic instead of matrix
   * work. `right × down = direction` on every face, which is what the test
   * checks and what makes a transcription error fail rather than skew.
   */
  right: SimulatorViewDirection;
  down: SimulatorViewDirection;
  /** The nine hit regions, in reading order from the face's top-left. */
  spots: readonly ViewCubeSpot[];
}

const HALF = 'translateZ(var(--view-cube-half))';

/** The nine cells' offsets from the face centre, in reading order. */
const CELLS: ReadonlyArray<readonly [down: number, right: number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 0],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

/**
 * A face's nine spots: its own direction, tilted toward each neighbour.
 *
 * The direction for a cell is the face normal plus one step along each axis the
 * cell is offset on, normalized — so the middle cell is the face itself, an edge
 * cell is the 45° between two faces, and a corner cell the (1,1,1) diagonal
 * between three. Exactly the 26 directions drei's hotspots name.
 */
function facesSpots(
  direction: SimulatorViewDirection,
  right: SimulatorViewDirection,
  down: SimulatorViewDirection
): ViewCubeSpot[] {
  return CELLS.map(([dy, dx]) => {
    const raw: [number, number, number] = [
      direction[0] + dx * right[0] + dy * down[0],
      direction[1] + dx * right[1] + dy * down[1],
      direction[2] + dx * right[2] + dy * down[2],
    ];
    const length = Math.hypot(...raw);
    const steps = Math.abs(dx) + Math.abs(dy);
    return {
      kind: steps === 0 ? 'face' : steps === 1 ? 'edge' : 'corner',
      direction: [raw[0] / length, raw[1] / length, raw[2] / length] as SimulatorViewDirection,
      // Named before the normalize, while the components are still integers —
      // two cells on different faces must produce the same string, and floats
      // divided by different roots would not reliably.
      viewpoint: raw.join(','),
    };
  });
}

function viewCubeFace(
  id: ViewCubeFaceId,
  transform: string,
  direction: SimulatorViewDirection,
  right: SimulatorViewDirection,
  down: SimulatorViewDirection
): ViewCubeFace {
  return { id, direction, transform, right, down, spots: facesSpots(direction, right, down) };
}

/**
 * The six faces, in the order they are painted.
 *
 * The labels are derived rather than chosen. At `(yaw 0, pitch 0)` the view
 * transform reduces to `screen_x = FOLD x`, `screen_y = −FOLD y`, so **Top
 * shows the fold oriented exactly as the crease-pattern canvas draws it** —
 * which fixes `+Y` as Top and every other face with it. `−Z` is FOLD `+y`, the
 * pattern's bottom edge, and it is the edge nearest the eye at the simulator's
 * opening view; hence Front.
 *
 * Note this is *not* OpenSCAD Studio's mapping, which relabels three.js's
 * `[+X, −X, +Y, −Y, +Z, −Z]` as Front/Back/Top/Bottom/Left/Right for OpenSCAD's
 * coordinate convention. Ours is the paper's.
 */
export const VIEW_CUBE_FACES: readonly ViewCubeFace[] = [
  viewCubeFace('front', HALF, [0, 0, -1], [1, 0, 0], [0, -1, 0]),
  viewCubeFace('back', `rotateY(180deg) ${HALF}`, [0, 0, 1], [-1, 0, 0], [0, -1, 0]),
  viewCubeFace('right', `rotateY(90deg) ${HALF}`, [1, 0, 0], [0, 0, 1], [0, -1, 0]),
  viewCubeFace('left', `rotateY(-90deg) ${HALF}`, [-1, 0, 0], [0, 0, -1], [0, -1, 0]),
  viewCubeFace('top', `rotateX(90deg) ${HALF}`, [0, 1, 0], [1, 0, 0], [0, 0, -1]),
  viewCubeFace('bottom', `rotateX(-90deg) ${HALF}`, [0, -1, 0], [1, 0, 0], [0, 0, 1]),
];

/**
 * The cube's own space, as columns in the renderer's world: right is `+X`, up is
 * `+Y`, out of the front face is `−Z`.
 *
 * ## Why this matrix exists at all
 *
 * `viewRotation` has determinant **−1** at every angle — the renderer draws a
 * mirror of the true view, and the FOLD lift cancels it for the model
 * (`normalizePoint` sends `(x, y)` to `(x, 0, −y)`). Feeding a cube through that
 * transform unaccompanied would paint every label mirror-reversed.
 *
 * So the cube is built in a *left-handed* frame — `right × up = −out`, hence the
 * determinant of −1 here — and the two cancel: `viewRotation · CUBE_BASIS` has
 * determinant +1. The cube is then an ordinary CSS 3D cube, and the browser's
 * own backface culling, hit testing and text rendering are all correct with
 * nothing hand-rolled. {@link viewCubeRotation} is pinned to that.
 */
const CUBE_BASIS: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, -1];

/**
 * Below this much of itself turned toward the eye, a face is edge-on. Far under
 * one device pixel of width on a cube this size, and far over the ~1e-16 a
 * reconstructed axis view leaves behind.
 */
const EDGE_ON_EPSILON = 1e-9;

/** CSS puts +y down; maths puts it up. Applied on both sides of the rotation. */
const CSS_Y_FLIP: Mat3 = [1, 0, 0, 0, -1, 0, 0, 0, 1];

/**
 * The cube's rotation, in CSS's coordinate space (x right, y **down**, z toward
 * the viewer).
 *
 * A proper rotation at every angle and under any `orient` — that is the
 * invariant the tests assert, and the reason the cube can be plain CSS.
 */
export function viewCubeRotation(view: SimulatorOrbitView): Mat3 {
  const camera = viewRotation(view.yaw, view.pitch, view.orient);
  return multiplyMat3(CSS_Y_FLIP, multiplyMat3(multiplyMat3(camera, CUBE_BASIS), CSS_Y_FLIP));
}

/** Decimal places kept in the CSS string: 4e-5 px of error on a 76px cube. */
const MATRIX_PRECISION = 6;

/**
 * The cube's `transform`, ready to assign.
 *
 * `matrix3d` is column-major, so a row-major 3×3 uploads transposed. Built as a
 * string on every orbit frame, which is the whole per-frame cost of the cube —
 * one style write, no layout read.
 */
export function viewCubeTransform(view: SimulatorOrbitView): string {
  const m = viewCubeRotation(view);
  const at = (index: number) => m[index]!.toFixed(MATRIX_PRECISION);
  return (
    `matrix3d(${at(0)},${at(3)},${at(6)},0,` +
    `${at(1)},${at(4)},${at(7)},0,` +
    `${at(2)},${at(5)},${at(8)},0,0,0,0,1)`
  );
}

/**
 * Which faces are turned toward the eye, as one bit per {@link VIEW_CUBE_FACES}
 * entry.
 *
 * `backface-visibility: hidden` already stops a turned-away face being painted,
 * and browsers do not hit-test what they do not paint — but "the click went to
 * the face behind" would snap the camera to the *opposite* view, which is bad
 * enough to be worth stating outright rather than inheriting. It also gives the
 * component something to assert in jsdom, which has no layout and so no
 * backfaces at all.
 *
 * Edge-on counts as hidden, and the tolerance is not decoration. Snap to a face
 * and the other four stand exactly side-on, where the dot product is zero up to
 * a rounding error whose *sign* is arbitrary — so a strict `> 0` reported four
 * faces of zero width as pressable, differently each time, and the mask stopped
 * meaning anything a reader could check.
 */
export function visibleViewCubeFaces(view: SimulatorOrbitView): number {
  const eye = viewDepthAxis(viewRotation(view.yaw, view.pitch, view.orient));
  let mask = 0;
  VIEW_CUBE_FACES.forEach((face, index) => {
    const facing =
      face.direction[0] * eye[0] + face.direction[1] * eye[1] + face.direction[2] * eye[2];
    if (facing > EDGE_ON_EPSILON) mask |= 1 << index;
  });
  return mask;
}
