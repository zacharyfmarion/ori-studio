import { describe, expect, it } from 'vitest';
import { AsyncMotionSampleError, SimulationClock } from '../src/simulationClock.js';
import type { MotionSample, SolverBackend } from '../src/solverBackend.js';
import type { SimulatorDiagnostics } from '../src/types.js';

/**
 * A backend that costs a fixed, controllable amount of simulated time per step,
 * so budget behaviour can be asserted without depending on how fast the machine
 * running the tests happens to be.
 */
/** A sample the fake has been asked for and not yet landed. */
interface PendingSample {
  resolve: (sample: MotionSample) => void;
  reject: (error: unknown) => void;
  sample: MotionSample;
}

function fakeBackend(options: {
  msPerStep: number;
  velocity?: (step: number) => number;
  strain?: (step: number) => number;
  /**
   * Answer `sampleMotion` with a promise that lands only when the test calls
   * `land()`, as a WebGPU backend's `mapAsync` does in its own time. Each
   * sample describes the step it was asked for at.
   */
  async?: boolean;
}) {
  let step = 0;
  let clock = 0;
  let arrests = 0;
  let resets = 0;
  let requests = 0;
  const waiting: PendingSample[] = [];
  const sampleAt = (at: number): MotionSample => ({
    maxVelocity: options.velocity ? options.velocity(at) : 1,
    maxStrain: options.strain ? options.strain(at) : 0,
  });
  const backend: SolverBackend & {
    elapsed(): number;
    arrests(): number;
    resets(): number;
    requests(): number;
    /** Land every sample asked for so far, then let the clock's handlers run. */
    land(): Promise<void>;
    /** Fail every sample asked for so far. */
    fail(error: unknown): Promise<void>;
  } = {
    step(count) {
      step += count;
      clock += count * options.msPerStep;
    },
    setFoldPercent() {},
    setFoldProfile() {},
    setMaterial() {},
    setFixedNodes() {},
    reset() {
      step = 0;
      resets += 1;
    },
    arrestDynamics() {
      arrests += 1;
    },
    readPositions() {
      return 0;
    },
    readColors() {
      return 0;
    },
    readDiagnostics(): SimulatorDiagnostics {
      return { warnings: [], errors: [], maxNodalStrain: options.strain ? options.strain(step) : 0 };
    },
    sampleMotion() {
      requests += 1;
      const sample = sampleAt(step);
      if (!options.async) return sample;
      return new Promise<MotionSample>((resolve, reject) => waiting.push({ resolve, reject, sample }));
    },
    get stepCount() {
      return step;
    },
    dispose() {},
    elapsed: () => clock,
    arrests: () => arrests,
    resets: () => resets,
    requests: () => requests,
    async land() {
      for (const request of waiting.splice(0)) request.resolve(request.sample);
      await Promise.resolve();
    },
    async fail(error) {
      for (const request of waiting.splice(0)) request.reject(error);
      await Promise.resolve();
    },
  };
  return { backend, now: () => clock };
}

describe('SimulationClock budget', () => {
  it('runs many steps on a cheap model and few on an expensive one', () => {
    const cheap = fakeBackend({ msPerStep: 0.01 });
    const expensive = fakeBackend({ msPerStep: 5 });

    const cheapTick = new SimulationClock({ budgetMs: 8, chunkSteps: 1, now: cheap.now }).runFrame(
      cheap.backend
    );
    const expensiveTick = new SimulationClock({
      budgetMs: 8,
      chunkSteps: 1,
      now: expensive.now,
    }).runFrame(expensive.backend);

    // This is the whole point of the change: the budget absorbs model cost, so
    // frame time stays bounded instead of the step count staying constant.
    expect(cheapTick.steps).toBeGreaterThan(expensiveTick.steps * 10);
    expect(expensiveTick.steps).toBeLessThanOrEqual(3);
  });

  it('keeps frame time near the budget regardless of model cost', () => {
    for (const msPerStep of [0.01, 0.5, 4]) {
      const { backend, now } = fakeBackend({ msPerStep });
      const clock = new SimulationClock({ budgetMs: 8, chunkSteps: 1, now });
      const tick = clock.runFrame(backend);
      // One chunk of overshoot is expected -- the budget is checked between
      // chunks, so the last chunk can cross the deadline.
      expect(tick.elapsedMs).toBeLessThanOrEqual(8 + msPerStep);
    }
  });

  it('respects maxStepsPerFrame so a fast backend cannot run away', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0 });
    const clock = new SimulationClock({ budgetMs: 8, chunkSteps: 10, maxStepsPerFrame: 100, now });
    expect(clock.runFrame(backend).steps).toBeLessThanOrEqual(100 + 10);
  });
});

describe('SimulationClock convergence', () => {
  it('reports convergence once velocity stays below epsilon', () => {
    // Settles after 50 steps.
    const { backend, now } = fakeBackend({
      msPerStep: 0.01,
      velocity: (step) => (step < 50 ? 1 : 1e-9),
    });
    const clock = new SimulationClock({
      budgetMs: 1,
      chunkSteps: 10,
      convergenceEpsilon: 1e-5,
      convergenceTicks: 3,
      now,
    });

    let ticks = 0;
    while (!clock.converged && ticks < 100) {
      clock.runFrame(backend);
      ticks += 1;
    }
    expect(clock.converged).toBe(true);
  });

  it('spends no budget once converged', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, velocity: () => 0 });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 1, convergenceTicks: 1, now });

    clock.runFrame(backend);
    expect(clock.converged).toBe(true);

    // An idle simulator must cost nothing; this is what stops a settled model
    // burning a core forever.
    const idle = clock.runFrame(backend);
    expect(idle.steps).toBe(0);
    expect(idle.elapsedMs).toBe(0);
  });

  it('resumes after invalidate, so a new fold target is actually pursued', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, velocity: () => 0 });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 1, convergenceTicks: 1, now });

    clock.runFrame(backend);
    expect(clock.runFrame(backend).steps).toBe(0);

    // Without this, changing foldPercent on a settled model would silently do
    // nothing -- the clock would keep short-circuiting.
    clock.invalidate();
    expect(clock.converged).toBe(false);
    expect(clock.runFrame(backend).steps).toBeGreaterThan(0);
  });

  it('steps nothing once told the model is settled, until invalidated', () => {
    // A restored shape: put back as it was kept, at rest, whatever its velocity reads.
    const { backend, now } = fakeBackend({ msPerStep: 0.01, velocity: () => 1 });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 1, convergenceTicks: 3, now });

    clock.markSettled();
    expect(clock.converged).toBe(true);
    expect(clock.runFrame(backend).steps).toBe(0);
    expect(clock.runToConvergence(backend).steps).toBe(0);

    clock.invalidate();
    expect(clock.runFrame(backend).steps).toBeGreaterThan(0);
  });
});

describe('SimulationClock blow-up guard', () => {
  it('arrests the solve when edge strain exceeds the limit', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, strain: () => 9 });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 5, blowupStrain: 3, now });
    clock.runFrame(backend);
    expect((backend as unknown as { arrests(): number }).arrests()).toBeGreaterThan(0);
  });

  it('resets on a non-finite velocity, since draining velocity cannot repair NaN positions', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, velocity: () => Number.NaN });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 5, blowupStrain: 0, now });
    clock.runFrame(backend);
    const probe = backend as unknown as { arrests(): number; resets(): number };
    expect(probe.resets()).toBeGreaterThan(0);
    expect(probe.arrests()).toBe(0);
  });

  it('never reports a NaN model as converged', () => {
    // A NaN velocity fails `< epsilon`, so it must not be mistaken for stillness.
    // Otherwise the clock stops spending budget and the mesh stays invisible.
    const { backend, now } = fakeBackend({ msPerStep: 0.01, velocity: () => Number.NaN });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 5, convergenceTicks: 1, now });
    clock.runFrame(backend);
    expect(clock.converged).toBe(false);
  });

  it('leaves a healthy solve alone', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, strain: () => 0.2, velocity: () => 0.1 });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 5, blowupStrain: 3, now });
    clock.runFrame(backend);
    expect((backend as unknown as { arrests(): number }).arrests()).toBe(0);
  });
});

describe('SimulationClock runToConvergence', () => {
  it('stops at convergence rather than burning the full step allowance', () => {
    const { backend, now } = fakeBackend({
      msPerStep: 0.001,
      velocity: (step) => (step < 200 ? 1 : 0),
    });
    const clock = new SimulationClock({ chunkSteps: 10, convergenceTicks: 2, now });
    const tick = clock.runToConvergence(backend, 100_000);

    expect(tick.converged).toBe(true);
    expect(tick.steps).toBeLessThan(400);
  });

  it('gives up at maxSteps when a model never settles', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.001, velocity: () => 1 });
    const clock = new SimulationClock({ chunkSteps: 10, now });
    const tick = clock.runToConvergence(backend, 500);

    expect(tick.converged).toBe(false);
    expect(tick.steps).toBeLessThanOrEqual(510);
  });
});

describe('SimulationClock stagnation', () => {
  function runTicks(clock: SimulationClock, backend: SolverBackend, limit: number): number {
    let ticks = 0;
    while (!clock.converged && ticks < limit) {
      clock.runFrame(backend);
      ticks += 1;
    }
    return ticks;
  }

  it('settles a model whose velocity is stuck above epsilon', () => {
    // A pinned kabuto plateaus at 1.26e-5: its slowest node's velocity is too
    // small to change a float32 position, so neither moves again.
    const { backend, now } = fakeBackend({
      msPerStep: 0.01,
      velocity: (step) => (step < 50 ? 1 / (step + 1) : 1.26e-5),
    });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 10, convergenceEpsilon: 1e-5, convergenceTicks: 3, now });
    runTicks(clock, backend, 100);
    expect(clock.converged).toBe(true);
  });

  it('keeps running while the velocity is still falling, however slowly', () => {
    const { backend, now } = fakeBackend({
      msPerStep: 0.01,
      velocity: (step) => 1e-3 * Math.exp(-step / 1e6),
    });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 10, convergenceEpsilon: 1e-5, now });
    runTicks(clock, backend, 50);
    expect(clock.converged).toBe(false);
  });

  it('does not mistake a model moving at a steady speed for a stuck one', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, velocity: () => 0.5 });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 10, now });
    runTicks(clock, backend, 50);
    expect(clock.converged).toBe(false);
  });

  it('forgets the plateau on invalidate, so a new target is pursued', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, velocity: () => 1.26e-5 });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 10, convergenceTicks: 1, now });
    runTicks(clock, backend, 10);
    expect(clock.converged).toBe(true);

    clock.invalidate();
    clock.runFrame(backend);
    expect(clock.converged).toBe(false);
  });

  it('can be switched off', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, velocity: () => 1.26e-5 });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 10, stagnationCeiling: 0, now });
    runTicks(clock, backend, 50);
    expect(clock.converged).toBe(false);
  });
});

describe('SimulationClock recovery report', () => {
  it('says it reset a non-finite model', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, velocity: () => Number.NaN });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 5, now });
    expect(clock.runFrame(backend).recovered).toBe('reset');
  });

  it('says it arrested a runaway strain', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, strain: () => 9, velocity: () => 0.1 });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 5, blowupStrain: 3, now });
    expect(clock.runFrame(backend).recovered).toBe('arrest');
  });

  it('says nothing about a healthy tick', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, strain: () => 0.2, velocity: () => 0.1 });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 5, now });
    expect(clock.runFrame(backend).recovered).toBeNull();
  });
});

describe('SimulationClock with a backend that samples asynchronously', () => {
  it('acts on a sample when it lands, a tick later', async () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, velocity: () => 0, async: true });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 1, convergenceTicks: 1, now });

    const first = clock.runFrame(backend);
    // Nothing has landed: the tick cannot know the model is still.
    expect(first.converged).toBe(false);
    expect(first.maxVelocity).toBe(Number.POSITIVE_INFINITY);

    await backend.land();
    const second = clock.runFrame(backend);
    expect(second.converged).toBe(true);
    expect(second.maxVelocity).toBe(0);
  });

  it('keeps one sample in flight, however many ticks run', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, async: true });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 1, now });
    for (let tick = 0; tick < 5; tick += 1) clock.runFrame(backend);
    expect(backend.requests()).toBe(1);
  });

  it('acts on each sample once, so a late one never reads as a model that has stopped', async () => {
    // Above epsilon and below the stagnation ceiling: two equal samples in a
    // row would count as stuck. Only one ever lands.
    const { backend, now } = fakeBackend({ msPerStep: 0.01, velocity: () => 1.26e-5, async: true });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 1, convergenceTicks: 1, now });
    clock.runFrame(backend);
    await backend.land();
    for (let tick = 0; tick < 10; tick += 1) clock.runFrame(backend);
    expect(clock.converged).toBe(false);
  });

  it('drops a sample asked for before invalidate', async () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, velocity: () => Number.NaN, async: true });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 1, now });
    clock.runFrame(backend);
    clock.invalidate();
    await backend.land();
    // The NaN described the state before the change; the clock must not reset over it.
    expect(clock.runFrame(backend).recovered).toBeNull();
    expect(backend.resets()).toBe(0);
  });

  it('resets on a non-finite sample, late or not', async () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, velocity: () => Number.NaN, async: true });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 1, convergenceTicks: 1, now });
    expect(clock.runFrame(backend).recovered).toBeNull();
    await backend.land();
    expect(clock.runFrame(backend).recovered).toBe('reset');
    expect(clock.converged).toBe(false);
  });

  it('arrests on a strained sample when it lands', async () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, strain: () => 9, velocity: () => 0.1, async: true });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 1, blowupStrain: 3, now });
    clock.runFrame(backend);
    await backend.land();
    expect(clock.runFrame(backend).recovered).toBe('arrest');
  });

  it('throws a failed sample on the next tick, once', async () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, async: true });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 1, now });
    clock.runFrame(backend);
    await backend.fail(new Error('device lost'));
    expect(() => clock.runFrame(backend)).toThrow('device lost');
    expect(() => clock.runFrame(backend)).not.toThrow();
  });

  it('will not run a headless loop it cannot wait in', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, async: true });
    const clock = new SimulationClock({ chunkSteps: 10, now });
    expect(() => clock.runToConvergence(backend, 100)).toThrow(AsyncMotionSampleError);
  });

  it('settles an asynchronous backend, deciding on each chunk as runToConvergence would', async () => {
    const velocity = (step: number) => (step < 200 ? 1 : 0);
    const asyncSide = fakeBackend({ msPerStep: 0.001, velocity, async: true });
    const syncSide = fakeBackend({ msPerStep: 0.001, velocity });
    const settling = new SimulationClock({ chunkSteps: 10, convergenceTicks: 2, now: asyncSide.now }).settle(
      asyncSide.backend,
      100_000
    );
    // Land each sample as it is asked for, as a device would.
    for (let i = 0; i < 100; i += 1) await asyncSide.backend.land();
    const tick = await settling;
    const reference = new SimulationClock({ chunkSteps: 10, convergenceTicks: 2, now: syncSide.now }).runToConvergence(
      syncSide.backend,
      100_000
    );
    expect(tick.converged).toBe(true);
    expect(tick.steps).toBe(reference.steps);
  });
});
