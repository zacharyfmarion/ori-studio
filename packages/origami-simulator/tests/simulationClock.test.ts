import { describe, expect, it } from 'vitest';
import { SimulationClock } from '../src/simulationClock.js';
import type { SolverBackend } from '../src/solverBackend.js';
import type { SimulatorDiagnostics } from '../src/types.js';

/**
 * A backend that costs a fixed, controllable amount of simulated time per step,
 * so budget behaviour can be asserted without depending on how fast the machine
 * running the tests happens to be.
 */
function fakeBackend(options: {
  msPerStep: number;
  velocity?: (step: number) => number;
  strain?: (step: number) => number;
}) {
  let step = 0;
  let clock = 0;
  let arrests = 0;
  const backend: SolverBackend & { elapsed(): number; arrests(): number } = {
    step(count) {
      step += count;
      clock += count * options.msPerStep;
    },
    setFoldPercent() {},
    setFoldProfile() {},
    setMaterial() {},
    reset() {
      step = 0;
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
      return { warnings: [], errors: [], maxEdgeStrain: options.strain ? options.strain(step) : 0 };
    },
    maxVelocity() {
      return options.velocity ? options.velocity(step) : 1;
    },
    get stepCount() {
      return step;
    },
    dispose() {},
    elapsed: () => clock,
    arrests: () => arrests,
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
});

describe('SimulationClock blow-up guard', () => {
  it('arrests the solve when edge strain exceeds the limit', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, strain: () => 9 });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 5, blowupStrain: 3, now });
    clock.runFrame(backend);
    expect((backend as unknown as { arrests(): number }).arrests()).toBeGreaterThan(0);
  });

  it('always arrests on a non-finite velocity, even with the strain limit disabled', () => {
    const { backend, now } = fakeBackend({ msPerStep: 0.01, velocity: () => Number.NaN });
    const clock = new SimulationClock({ budgetMs: 1, chunkSteps: 5, blowupStrain: 0, now });
    clock.runFrame(backend);
    expect((backend as unknown as { arrests(): number }).arrests()).toBeGreaterThan(0);
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
