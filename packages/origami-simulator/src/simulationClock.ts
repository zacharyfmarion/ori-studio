import type { SolverBackend } from './solverBackend.js';

/**
 * Decides how much simulation to run per tick.
 *
 * This replaces the fixed step counts that made the simulator freeze. A count
 * like `stepsPerFrame: 100` means a 10x bigger model produces a 10x longer
 * frame, so the tab stops responding rather than the fold merely converging
 * more slowly. A time budget inverts that: frames stay bounded and big models
 * simply take more of them.
 *
 * The scheduler is backend-independent on purpose. A GPU backend driven by a
 * fixed 900-step settle batch stalls just as badly as a CPU one; it only takes
 * a larger model to get there.
 */
export interface SimulationClockOptions {
  /**
   * Wall-clock milliseconds of solver work per `runFrame` call. The default
   * leaves room in a 16.6ms frame for everything else; a worker can afford
   * more, since nothing else is competing for that thread.
   */
  budgetMs?: number;
  /**
   * Steps to run between budget checks. Checking the clock every step would
   * cost more than stepping for small models; this is the granularity of
   * overshoot.
   */
  chunkSteps?: number;
  /** Hard ceiling per frame, so a fast backend cannot run away. */
  maxStepsPerFrame?: number;
  /**
   * Max velocity below which the model counts as settled. Once converged the
   * scheduler stops spending budget, which is what makes an idle simulator
   * cost nothing.
   */
  convergenceEpsilon?: number;
  /** Consecutive settled ticks required before reporting convergence. */
  convergenceTicks?: number;
  /**
   * A max velocity that repeats exactly from one tick to the next, below this
   * ceiling, also counts as settled. A node whose velocity is too small to
   * change its float32 position cannot move however long it runs, and reports
   * the same velocity forever: a pinned kabuto sits at 1.26e-5 against an
   * epsilon of 1e-5, its position bit-identical for 60k steps. A model that is
   * still converging reports a different maximum every tick. 0 disables.
   */
  stagnationCeiling?: number;
  /**
   * Edge-strain (stretch ratio) above which the explicit integrator is treated
   * as blown up: the velocities are drained ({@link SolverBackend.arrestDynamics})
   * so the mesh re-settles instead of exploding off-screen. Scale-invariant, so
   * one value fits every model. A healthy fold stays well under 1; set to 0 (or
   * Infinity) to disable the backstop.
   */
  blowupStrain?: number;
  /** Injectable for tests. */
  now?: () => number;
}

export interface SimulationTick {
  /** Steps actually executed this tick. */
  steps: number;
  /** Milliseconds spent stepping. */
  elapsedMs: number;
  /** True once the model has been settled for `convergenceTicks` ticks. */
  converged: boolean;
  /** Max absolute velocity component at the end of the tick. */
  maxVelocity: number;
  /**
   * What the blow-up guard did this tick, if anything: `reset` returned a
   * non-finite model to the flat sheet, `arrest` drained runaway velocity.
   */
  recovered: SimulationRecovery | null;
}

export type SimulationRecovery = 'reset' | 'arrest';

const DEFAULTS = {
  budgetMs: 8,
  chunkSteps: 8,
  maxStepsPerFrame: 4000,
  convergenceEpsilon: 1e-5,
  convergenceTicks: 3,
  stagnationCeiling: 1e-2,
  blowupStrain: 3,
};

export class SimulationClock {
  private readonly options: Required<Omit<SimulationClockOptions, 'now'>>;
  private readonly now: () => number;
  private settledTicks = 0;
  private totalSteps = 0;
  /** The previous tick's max velocity, for the stagnation rule; null after any change. */
  private lastMaxVelocity: number | null = null;

  constructor(options: SimulationClockOptions = {}) {
    this.options = {
      budgetMs: options.budgetMs ?? DEFAULTS.budgetMs,
      chunkSteps: Math.max(1, options.chunkSteps ?? DEFAULTS.chunkSteps),
      maxStepsPerFrame: options.maxStepsPerFrame ?? DEFAULTS.maxStepsPerFrame,
      convergenceEpsilon: options.convergenceEpsilon ?? DEFAULTS.convergenceEpsilon,
      convergenceTicks: Math.max(1, options.convergenceTicks ?? DEFAULTS.convergenceTicks),
      stagnationCeiling: options.stagnationCeiling ?? DEFAULTS.stagnationCeiling,
      blowupStrain: options.blowupStrain ?? DEFAULTS.blowupStrain,
    };
    this.now = options.now ?? (() => performance.now());
  }

  /** Steps executed across all ticks since the last {@link reset}. */
  get stepsRun(): number {
    return this.totalSteps;
  }

  get converged(): boolean {
    return this.settledTicks >= this.options.convergenceTicks;
  }

  /**
   * Anything that changes the target state -- fold percent, material, a new
   * model -- must call this, or a converged clock will refuse to spend budget
   * on reaching the new target.
   */
  invalidate(): void {
    this.settledTicks = 0;
    this.lastMaxVelocity = null;
  }

  reset(): void {
    this.settledTicks = 0;
    this.totalSteps = 0;
    this.lastMaxVelocity = null;
  }

  /**
   * Run one frame's worth of simulation. Returns without stepping if the model
   * is already converged, so a settled simulator costs nothing.
   */
  runFrame(backend: SolverBackend): SimulationTick {
    if (this.converged) {
      return { steps: 0, elapsedMs: 0, converged: true, maxVelocity: backend.maxVelocity(), recovered: null };
    }

    const started = this.now();
    const deadline = started + this.options.budgetMs;
    let steps = 0;

    do {
      backend.step(this.options.chunkSteps);
      steps += this.options.chunkSteps;
    } while (this.now() < deadline && steps < this.options.maxStepsPerFrame);

    const elapsedMs = this.now() - started;
    this.totalSteps += steps;

    const maxVelocity = backend.maxVelocity();
    this.recordSettling(maxVelocity);
    const recovered = this.guardBlowup(backend, maxVelocity);

    return { steps, elapsedMs, converged: this.converged, maxVelocity, recovered };
  }

  /**
   * Count a tick as settled when the model is still, or when it can no longer
   * move: the same maximum velocity as last tick, which a model that is still
   * converging never reports. See {@link SimulationClockOptions.stagnationCeiling}.
   */
  private recordSettling(maxVelocity: number): void {
    const ceiling = this.options.stagnationCeiling;
    const stagnant = ceiling > 0 && maxVelocity === this.lastMaxVelocity && maxVelocity < ceiling;
    if (maxVelocity < this.options.convergenceEpsilon || stagnant) this.settledTicks += 1;
    else this.settledTicks = 0;
    this.lastMaxVelocity = maxVelocity;
  }

  /**
   * If the explicit integrator has destabilized -- velocity/strain non-finite,
   * or edge strain past the configured limit -- drain the runaway velocity so
   * the stable axial springs re-settle the mesh instead of it exploding
   * off-screen. Strain is scale-invariant; a healthy fold never reaches the
   * limit, so this is inert in the common case. NaN/Inf is always arrested even
   * when the strain limit is disabled.
   */
  private guardBlowup(backend: SolverBackend, maxVelocity: number): SimulationRecovery | null {
    const limit = this.options.blowupStrain;
    const diagnostics = backend.readDiagnostics();
    // Nodal strain is the measure both backends report identically; maxEdgeStrain
    // is CPU-only, so falling back to it would silently disable the guard on the
    // GPU (and did, when the GPU reported the nodal value under that name).
    const strain = diagnostics.maxNodalStrain ?? diagnostics.maxEdgeStrain ?? 0;

    // Already NaN/Infinite: the positions themselves are unrecoverable, and
    // draining velocity cannot repair them -- every later step keeps propagating
    // the NaN, so the mesh would stay invisible forever (and, because a NaN
    // velocity compares as "no movement", the clock would call it converged and
    // stop). Restore the flat rest state; the fold target is untouched, so the
    // model re-folds toward it instead of vanishing.
    if (!Number.isFinite(maxVelocity) || !Number.isFinite(strain)) {
      backend.reset();
      this.settledTicks = 0;
      this.lastMaxVelocity = null;
      return 'reset';
    }

    // Still finite but diverging: drain the runaway velocity early, which keeps
    // the fold state and usually avoids reaching NaN at all.
    if (limit > 0 && Number.isFinite(limit) && strain > limit) {
      backend.arrestDynamics();
      this.settledTicks = 0;
      this.lastMaxVelocity = null;
      return 'arrest';
    }
    return null;
  }

  /**
   * Run until converged or `maxSteps` is reached, ignoring the frame budget.
   * For headless callers (tests, CLI, export) where there is no frame to keep
   * responsive. Never call this on a thread with a UI on it.
   */
  runToConvergence(backend: SolverBackend, maxSteps = 20_000): SimulationTick {
    const started = this.now();
    let steps = 0;
    let maxVelocity = backend.maxVelocity();
    let recovered: SimulationRecovery | null = null;

    while (steps < maxSteps && !this.converged) {
      backend.step(this.options.chunkSteps);
      steps += this.options.chunkSteps;
      maxVelocity = backend.maxVelocity();
      this.recordSettling(maxVelocity);
      recovered = this.guardBlowup(backend, maxVelocity) ?? recovered;
    }

    this.totalSteps += steps;
    return { steps, elapsedMs: this.now() - started, converged: this.converged, maxVelocity, recovered };
  }
}
