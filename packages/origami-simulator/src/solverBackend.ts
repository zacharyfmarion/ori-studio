import type { CursorRay, PullGrip, PullOutcome, PullSummary } from './pull.js';
import type { FoldProfile, SimulatorDiagnostics, SimulatorOptions } from './types.js';

/**
 * The seam every solver implementation sits behind.
 *
 * There are two implementations planned: {@link ReferenceSolver} (CPU,
 * headless, the oracle and the no-WebGL2 fallback) and a WebGL2 backend that
 * keeps all state in GPU textures. They differ enormously in how they hold
 * state, so the interface is deliberately written around *commands and
 * readback* rather than around shared buffers:
 *
 * - `step` never returns data. The GPU backend's whole advantage is that
 *   positions stay on the GPU, and a signature that returned positions would
 *   force a pipeline-stalling readback on every call.
 * - `readPositions` fills a caller-owned buffer instead of allocating, so a
 *   60fps loop does not generate garbage.
 * - `readDiagnostics` is separate from stepping because on GPU it is a
 *   reduction that we only want to run every few frames.
 */
export interface SolverBackend {
  /** Advance the simulation by `count` steps. */
  step(count: number): void;

  setFoldPercent(percent: number): void;
  setFoldProfile(profile: FoldProfile | null): void;
  setMaterial(options: Partial<SimulatorOptions>): void;

  /**
   * Return to the flat rest state and zero all velocities. Ends a pull and
   * releases the pose: flat paper has neither.
   */
  reset(): void;

  /**
   * Grip a point of the paper and draw it toward a ray (`pull.ts`). Fold creases
   * yield from where they are for as long as the pull lasts. A pull already in
   * progress is cancelled first.
   *
   * @throws {InvalidPullGripError} when the grip does not describe this model.
   */
  beginPull(grip: PullGrip): void;

  /** Draw the grip toward a new ray. Nothing to do without a pull. */
  movePull(ray: CursorRay): void;

  /**
   * Let go. `keep` makes the shape as it is the paper's rest shape — crease
   * angles, edge lengths and face angles — so nothing springs back: a pose.
   * `cancel` puts the rest state back as the pull found it.
   */
  endPull(outcome: PullOutcome): PullSummary;

  /** Drop the pose: creases follow the fold target again, edges and faces the sheet. */
  releasePose(): void;

  /** Crease targets come from a pose, not the fold target. True during a pull, too. */
  readonly posed: boolean;

  readonly pulling: boolean;

  /**
   * Hold nodes where they are: a fixed node keeps its current position and has
   * zero velocity, while the nodes around it still feel it. This is upstream
   * Origami Simulator's `Node.setFixed`, the flag its solver keeps in
   * `u_mass.y`. `mask[i] !== 0` fixes node `i`; `null` releases every node.
   *
   * A fix holds the node at its position *now*, not at a stored target, and the
   * mask survives {@link reset} — so after a reset a fixed node holds the flat
   * sheet, like everything else.
   *
   * @throws {InvalidFixedNodeMaskError} when the mask's length is not the
   *   vertex count.
   */
  setFixedNodes(mask: Uint8Array | null): void;

  /**
   * Zero the dynamic velocities while keeping the current (folded) positions.
   * A backstop for the explicit integrator going unstable mid-fold: crease
   * (bending) stiffness is not in the axial-only stable-timestep bound, so a
   * stiff fold can inject energy faster than damping removes it and the mesh
   * explodes off-screen. Draining the runaway velocity lets the stable axial
   * springs pull the mesh back instead. This is upstream Origami Simulator's
   * `shouldZeroDynamicVelocity` hook. No-op semantics for a healthy solve.
   */
  arrestDynamics(): void;

  /**
   * Copy current absolute vertex positions into `into` (length
   * `vertexCount * 3`). Returns the number of floats written.
   */
  readPositions(into: Float32Array): number;

  /**
   * Copy the paper's shape into `into`: what {@link writeShape} puts back, bit
   * for bit. Reads no velocity, pose or pin: a shape is where the paper is.
   *
   * @throws {InvalidSolverShapeError} when `into` is not this model's size.
   */
  readShape(into: SolverShape): void;

  /**
   * Make `shape` the paper's state: every node where the shape has it, with no
   * motion behind it (velocity and Verlet history zeroed), and every crease at
   * the shape's angle. A pull in progress ends and a pose is dropped first.
   * With `keep`, the shape is then kept as a pose, as a pull let go is: nothing
   * springs back. Fixed nodes stay fixed, holding the positions written.
   *
   * @throws {InvalidSolverShapeError} when `shape` is not this model's size.
   */
  writeShape(shape: SolverShape, keep: boolean): void;

  /** Per-vertex RGB strain colours, same contract as {@link readPositions}. */
  readColors(into: Float32Array): number;

  /**
   * Per-vertex mean axial strain as a fraction, one float each. Defined
   * identically on both backends — the sum of `|current/rest - 1|` over the
   * node's beams divided by their count, which is `velocityCalc`'s `nodeError`
   * on the GPU. Returns the number of floats written.
   *
   * Separate from {@link readColors} because the colour ramp needs a clip
   * threshold that belongs to the renderer, not the solver: the mesh renderer's
   * `strainClip` is a render setting the user can change, so a backend that
   * baked one in could not answer for the current view.
   */
  readStrain(into: Float32Array): number;

  readDiagnostics(): SimulatorDiagnostics;

  /**
   * Largest absolute vertex velocity component. The scheduler uses this for
   * convergence detection; it is separate from `readDiagnostics` because it is
   * needed every tick and must stay cheap.
   */
  maxVelocity(): number;

  /** Steps executed since construction or the last `reset`. */
  readonly stepCount: number;

  dispose(): void;
}

/** A fixed-node mask that does not describe this model's nodes. */
export class InvalidFixedNodeMaskError extends Error {
  constructor(
    readonly expected: number,
    readonly received: number
  ) {
    super(`Fixed-node mask has ${received} entries; the model has ${expected} nodes`);
    this.name = 'InvalidFixedNodeMaskError';
  }
}

/**
 * The mask a backend keeps: a private copy, so a caller reusing its buffer
 * cannot change what is fixed between calls. `null` when nothing is fixed.
 */
export function copyFixedNodeMask(mask: Uint8Array | null, nodeCount: number): Uint8Array | null {
  if (mask === null) return null;
  if (mask.length !== nodeCount) throw new InvalidFixedNodeMaskError(nodeCount, mask.length);
  return mask.some((value) => value !== 0) ? mask.slice() : null;
}

/**
 * The paper's shape as both backends hold it, in the model's own node and
 * crease order.
 *
 * Not absolute positions. Both solvers integrate each node's displacement from
 * the flat sheet, and a float32 position less the flat one does not give that
 * displacement back exactly, so a shape kept as positions would restore close
 * to the paper rather than to it.
 */
export interface SolverShape {
  /** Each node's displacement from where it lies on the flat sheet, xyz. */
  readonly offsets: Float32Array;
  /**
   * Each crease's dihedral angle in radians, as the solver has tracked it.
   * Unwrapped against the last value (a jump of more than 5 rad turns the other
   * way), so a crease folded past ±π reads 3.2 rather than -3.08. Recomputed
   * from positions it would land on the other side, and the fold target or a
   * Spring back would then drive it the long way round.
   */
  readonly theta: Float32Array;
}

/** A shape sized for a model: `nodeCount * 3` offsets and `creaseCount` angles. */
export function createSolverShape(nodeCount: number, creaseCount: number): SolverShape {
  return { offsets: new Float32Array(nodeCount * 3), theta: new Float32Array(creaseCount) };
}

/** A shape that does not describe this model's nodes and creases. */
export class InvalidSolverShapeError extends Error {
  constructor(
    readonly expected: { offsets: number; theta: number },
    readonly received: { offsets: number; theta: number }
  ) {
    super(
      `Shape has ${received.offsets} offsets and ${received.theta} crease angles; ` +
        `the model needs ${expected.offsets} and ${expected.theta}`
    );
    this.name = 'InvalidSolverShapeError';
  }
}

/** Throw unless `shape` is sized for `nodeCount` nodes and `creaseCount` creases. */
export function assertSolverShape(shape: SolverShape, nodeCount: number, creaseCount: number): void {
  const expected = { offsets: nodeCount * 3, theta: creaseCount };
  const received = { offsets: shape.offsets.length, theta: shape.theta.length };
  if (received.offsets !== expected.offsets || received.theta !== expected.theta) {
    throw new InvalidSolverShapeError(expected, received);
  }
}

/** What a backend needs to describe itself to the scheduler and the UI. */
export interface SolverBackendInfo {
  /** Stable identifier surfaced in diagnostics, e.g. 'reference' | 'webgl2'. */
  readonly id: string;
  readonly vertexCount: number;
  readonly faceCount: number;
}
