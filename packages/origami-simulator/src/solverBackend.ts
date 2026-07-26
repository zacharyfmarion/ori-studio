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

  /** Return to the flat rest state and zero all velocities. */
  reset(): void;

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

  /** Per-vertex RGB strain colours, same contract as {@link readPositions}. */
  readColors(into: Float32Array): number;

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

/** What a backend needs to describe itself to the scheduler and the UI. */
export interface SolverBackendInfo {
  /** Stable identifier surfaced in diagnostics, e.g. 'reference' | 'webgl2'. */
  readonly id: string;
  readonly vertexCount: number;
  readonly faceCount: number;
}
