/**
 * A simulation frames the model as it is.
 *
 * The camera used to fit once, to the first frame — the flat sheet — and hold,
 * so a model folded to a fraction of its sheet sat small in the middle of its
 * window while a folded figure of the same design filled its own. The crease
 * pens are a fixed width on screen, so a small model also reads as heavier
 * lines. Fitting every frame instead was tried and dropped: the fit tracks the
 * solver's own settling, and the model visibly breathed.
 *
 * So the camera follows the shape, eased. The shape is measured a few times a
 * second while it moves (a GPU readback on the worker path, so not every
 * frame), and once more when it settles; a new measure moves the target only
 * past a dead band, which is what keeps a settling model still; and the camera
 * eases toward the target on a time constant rather than per frame, so the
 * motion is the same at any frame rate. Both renderers draw through this, the
 * worker's GPU path and the canvas-2D fallback, so they frame alike.
 */
import { boundingRadius, centroid, type Vec3 } from '@treemaker/origami-simulator';

export interface Framing {
  center: Vec3;
  /** Bounding radius about `center`, in world units. */
  radius: number;
}

/**
 * Nodes the camera keeps still on screen: the pinned ones.
 *
 * The centre is their centroid plus `offset`, which is fixed when the anchor is
 * set ({@link anchorFraming}) so that setting it moves nothing. The pinned
 * nodes do not move in the world, so the centre does not either, and the
 * pinned region stays where it was on screen while the rest folds: only the
 * radius follows the shape.
 */
export interface FramingAnchor {
  nodes: ArrayLike<number>;
  offset: Vec3;
}

export interface FramingFollow {
  /** What the camera frames now; null until the first measure. */
  current: Framing | null;
  /** What it is easing toward. */
  target: Framing | null;
  measuredAt: number;
  easedAt: number;
  /** Whether the shape has been measured since it last settled. */
  measuredSettled: boolean;
  /** What the centre is held to while anything is pinned; null otherwise. */
  anchor: FramingAnchor | null;
  /**
   * Frozen where it is: while the paper is being pulled, a camera that followed
   * the shape would rescale under the cursor and slide the grabbed point away
   * from it. Held on through the pose a pull leaves, so letting go moves nothing
   * on screen either; the follow resumes, eased, when the pose ends.
   */
  held: boolean;
}

/** How often, at most, a moving shape is measured. */
export const FRAMING_MEASURE_MS = 150;
/** The ease's time constant: about two thirds of the way in this long, all but 5% in three. */
export const FRAMING_EASE_MS = 200;
/**
 * How far a measure has to move from the target to become the new one, as a
 * fraction of the radius — so a model settling by a hair does not breathe.
 */
export const FRAMING_DEAD_BAND = 0.02;
/** Close enough to stop easing and land, as a fraction of the radius. */
const FRAMING_ARRIVED = 0.002;

/**
 * The shape as it is: its centroid, and its bounding radius about that. The
 * centroid rather than the bounding box's middle, so an asymmetric fold orbits
 * about where it looks centred instead of swinging round an empty point.
 *
 * With an anchor the centre is held to the pinned nodes instead, and only the
 * radius follows the shape; see {@link FramingAnchor}.
 */
export function framingOf(positions: Float32Array, anchor?: FramingAnchor | null): Framing {
  const center =
    anchor && anchor.nodes.length > 0
      ? add(centroidOfNodes(positions, anchor.nodes), anchor.offset)
      : centroid(positions);
  // A floor, so a degenerate model cannot divide the camera's scale by zero.
  return { center, radius: Math.max(0.001, boundingRadius(positions, center)) };
}

/**
 * Hold the camera's centre to `nodes` from here on, or let it follow the whole
 * shape again when there are none.
 *
 * The offset is taken from where the camera is framing now, so pinning moves
 * nothing on screen: the region stays where it was when it was pinned, which is
 * the whole point. Before the first frame there is no "now", and the shape's
 * own centre stands in, which is where that frame would have been.
 */
export function anchorFraming(
  follow: FramingFollow,
  nodes: ArrayLike<number> | null,
  positions: Float32Array
): void {
  if (!nodes || nodes.length === 0) {
    follow.anchor = null;
    return;
  }
  const pinned = centroidOfNodes(positions, nodes);
  const center = follow.current?.center ?? centroid(positions);
  follow.anchor = {
    nodes,
    offset: [center[0] - pinned[0], center[1] - pinned[1], center[2] - pinned[2]],
  };
}

/**
 * How a session frames paper the tools have shaped.
 *
 * - `'anchor'`, Simulate's and the default: pins hold the camera's centre
 *   ({@link anchorFraming}), and a pull let go and kept holds the framing until
 *   its pose ends, so nothing moves on screen when the hand does.
 * - `'shape'`: the camera frames the shape as it is, pinned or posed, as a
 *   capture of it would. Pins anchor nothing, and a pull holds the framing only
 *   while it is in the hand; letting go eases back to fit. For a host whose
 *   view is the picture it keeps.
 */
export type SimulatorFraming = 'anchor' | 'shape';

/**
 * Pins as a framing takes them: under `'anchor'`, held to the camera's centre
 * from here on; under `'shape'`, nothing, and an anchor already set goes.
 * `positions` is read only when an anchor is set.
 */
export function framePins(
  follow: FramingFollow,
  framing: SimulatorFraming,
  nodes: ArrayLike<number> | null,
  positions: () => Float32Array
): void {
  if (framing === 'shape' || !nodes || nodes.length === 0) {
    follow.anchor = null;
    return;
  }
  anchorFraming(follow, nodes, positions());
}

/** Whether the framing stays held once a pull is let go: a kept pose, under `'anchor'`. */
export function framingHeldAfterPull(framing: SimulatorFraming, poseKept: boolean): boolean {
  return framing === 'anchor' && poseKept;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function centroidOfNodes(positions: Float32Array, nodes: ArrayLike<number>): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    x += positions[node * 3] ?? 0;
    y += positions[node * 3 + 1] ?? 0;
    z += positions[node * 3 + 2] ?? 0;
  }
  return [x / nodes.length, y / nodes.length, z / nodes.length];
}

export function createFramingFollow(): FramingFollow {
  return {
    current: null,
    target: null,
    measuredAt: 0,
    easedAt: 0,
    measuredSettled: false,
    anchor: null,
    held: false,
  };
}

/**
 * The framing for a frame drawn at `now`, and whether the camera has arrived —
 * a caller that stops drawing when the model settles has to keep drawing until
 * it has. `measure` reads the shape as it is; it is called only when a measure
 * is due. `settled` says the model has stopped moving, which earns one final
 * measure whenever the last one was taken.
 */
export function followFraming(
  follow: FramingFollow,
  now: number,
  measure: () => Framing,
  settled: boolean
): { framing: Framing; arrived: boolean } {
  if (follow.held && follow.current) {
    // Kept current, so the ease resumes from now rather than leaping.
    follow.easedAt = now;
    return { framing: follow.current, arrived: true };
  }
  if (!follow.current || !follow.target) {
    const first = measure();
    follow.current = first;
    follow.target = first;
    follow.measuredAt = now;
    follow.easedAt = now;
    follow.measuredSettled = settled;
    return { framing: first, arrived: true };
  }
  const settling = settled && !follow.measuredSettled;
  if (settling || now - follow.measuredAt >= FRAMING_MEASURE_MS) {
    const measured = measure();
    follow.measuredAt = now;
    if (apart(follow.target, measured, FRAMING_DEAD_BAND)) follow.target = measured;
  }
  follow.measuredSettled = settled;

  const target = follow.target;
  const k = 1 - Math.exp(-Math.max(0, now - follow.easedAt) / FRAMING_EASE_MS);
  follow.easedAt = now;
  const eased = between(follow.current, target, k);
  if (!apart(eased, target, FRAMING_ARRIVED)) {
    follow.current = target;
    return { framing: target, arrived: true };
  }
  follow.current = eased;
  return { framing: eased, arrived: false };
}

/** Whether two framings differ by more than `tolerance` of the larger radius. */
function apart(a: Framing, b: Framing, tolerance: number): boolean {
  if (Math.abs(Math.log(b.radius / a.radius)) > tolerance) return true;
  const offset = Math.hypot(
    b.center[0] - a.center[0],
    b.center[1] - a.center[1],
    b.center[2] - a.center[2]
  );
  return offset > tolerance * Math.max(a.radius, b.radius);
}

/**
 * `k` of the way from `a` to `b`: the centre straight, the radius by ratio, so
 * a zoom eases at the same pace in and out.
 */
function between(a: Framing, b: Framing, k: number): Framing {
  return {
    center: [
      a.center[0] + (b.center[0] - a.center[0]) * k,
      a.center[1] + (b.center[1] - a.center[1]) * k,
      a.center[2] + (b.center[2] - a.center[2]) * k,
    ],
    radius: a.radius * Math.pow(b.radius / a.radius, k),
  };
}
