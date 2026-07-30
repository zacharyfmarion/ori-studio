import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  clearAllInlineSimulationSources,
  getInlineSimulationFoldPercent,
  publishInlineSimulationFold,
  requestInlineSimulationFold,
  subscribeInlineSimulationFold,
  subscribeInlineSimulationFoldTarget,
} from './inlineSimulationRuntime';
import type { InlineSimulation } from './inlineSimulation';
import { MAX_CONCURRENT_SIMULATIONS } from '../../simulator/simulatorLimits';

function windowAt(id: string): InlineSimulation {
  return {
    id,
    box: { center: { x: 0, y: 0 }, width: 100, height: 100, rotation: 0 },
    z: 1,
    view: { yaw: 0, pitch: 0, zoom: 1 },
    sourceBoundary: null,
    sourceBounds: null,
    sourceFingerprint: null,
    segmentIdHint: null,
  };
}

beforeEach(() => {
  clearAllInlineSimulationSources();
  useWorkspaceStore.setState({
    oristudioCpInlineSimulations: [windowAt('sim-1'), windowAt('sim-2')],
  });
});

/**
 * The invariant, not the instance.
 *
 * `foldPercent` used to live on the store descriptor, so a running fold produced
 * a new `oristudioCpInlineSimulations` array ~15 times a second — and everything
 * keyed on that array recomputed, including a walk over every crease in the
 * document to decide which windows were stale. That cost 901ms of a 7.2s
 * profile with two stalls over 180ms.
 *
 * Asserting on the array identity rather than on one field is deliberate: it
 * fails for *any* per-frame value someone puts back into document-shaped state,
 * which is the mistake worth catching, not this particular field.
 */
describe('a running fold is not a document edit', () => {
  it('does not touch the descriptor array when the solver reports', () => {
    const before = useWorkspaceStore.getState().oristudioCpInlineSimulations;
    for (let i = 0; i <= 100; i += 1) publishInlineSimulationFold('sim-1', i);
    expect(useWorkspaceStore.getState().oristudioCpInlineSimulations).toBe(before);
  });

  it('does not touch the descriptor array when the user scrubs', () => {
    const before = useWorkspaceStore.getState().oristudioCpInlineSimulations;
    for (const percent of [10, 40, 90, 0]) requestInlineSimulationFold('sim-1', percent);
    expect(useWorkspaceStore.getState().oristudioCpInlineSimulations).toBe(before);
  });

  it('keeps the descriptors themselves identical', () => {
    // Array identity could survive a mutation in place; the entries must not
    // change either, or a memo keyed on one window still recomputes.
    const before = useWorkspaceStore.getState().oristudioCpInlineSimulations.map((s) => ({ ...s }));
    publishInlineSimulationFold('sim-1', 42);
    expect(useWorkspaceStore.getState().oristudioCpInlineSimulations).toEqual(before);
  });
});

describe('who hears about a fold change', () => {
  it('tells the readout when the solver reports', () => {
    const readout = vi.fn();
    const stop = subscribeInlineSimulationFold(readout);
    publishInlineSimulationFold('sim-1', 30);
    expect(readout).toHaveBeenCalled();
    stop();
  });

  it('does not tell the window when the solver reports', () => {
    // The window drives the solver. Echoing the solver's own output back at it
    // as an instruction is the loop this split exists to make impossible — it
    // used to be avoided by a "more than 0.5 away from the last value" guess.
    const target = vi.fn();
    const stop = subscribeInlineSimulationFoldTarget(target);
    publishInlineSimulationFold('sim-1', 30);
    expect(target).not.toHaveBeenCalled();
    stop();
  });

  it('tells both when the user asks for a fold', () => {
    const readout = vi.fn();
    const target = vi.fn();
    const stopA = subscribeInlineSimulationFold(readout);
    const stopB = subscribeInlineSimulationFoldTarget(target);
    requestInlineSimulationFold('sim-2', 75);
    expect(readout).toHaveBeenCalled();
    expect(target).toHaveBeenCalledWith('sim-2', 75);
    stopA();
    stopB();
  });

  it('keeps windows apart', () => {
    publishInlineSimulationFold('sim-1', 20);
    publishInlineSimulationFold('sim-2', 80);
    expect(getInlineSimulationFoldPercent('sim-1')).toBe(20);
    expect(getInlineSimulationFoldPercent('sim-2')).toBe(80);
  });
});

describe('surviving a loss of focus', () => {
  it('remembers where the fold was', () => {
    // A blurred window gives up its solver session, so refocusing reloads and
    // reseeds from here. Losing this is the bug where a window snapped back to
    // flat every time it was clicked away from and back.
    publishInlineSimulationFold('sim-1', 63);
    expect(getInlineSimulationFoldPercent('sim-1')).toBe(63);
  });

  it('starts a window it has never seen at flat', () => {
    expect(getInlineSimulationFoldPercent('never-opened')).toBe(0);
  });

  it('forgets a window when the document is replaced', () => {
    publishInlineSimulationFold('sim-1', 63);
    clearAllInlineSimulationSources();
    expect(getInlineSimulationFoldPercent('sim-1')).toBe(0);
  });
});

/**
 * Windows are written to `.osf`, so changing one is an unsaved change.
 *
 * They were built as session state and became persistent later, and nothing
 * revisited the classification: every mutation left `dirty` false, so a
 * workspace of arranged windows could be abandoned at the start screen with no
 * prompt (`dirty` is what gates it — see useWelcomeDiscardGuard).
 */
describe('a window change is an unsaved change', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      dirty: false,
      oristudioCpInlineSimulations: [windowAt('sim-1')],
    });
  });

  it('dirties on move or resize', () => {
    useWorkspaceStore.getState().updateOristudioCpInlineSimulation('sim-1', {
      box: { center: { x: 5, y: 5 }, width: 10, height: 10, rotation: 0 },
    });
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it('dirties on delete', () => {
    useWorkspaceStore.getState().removeOristudioCpInlineSimulation('sim-1');
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });
});

describe('the window cap', () => {
  it('reports at-capacity rather than failing silently', async () => {
    // The symptom this fixes: on the seventh region the button simply did
    // nothing. The store recorded a `projectMessage`, and nothing renders that
    // channel — so the cap existed with no way for anyone to find out.
    useWorkspaceStore.setState({
      oristudioCpDocument: {
        document: { crease_pattern: { line_segments: [], points: [], circles: [] } },
      } as never,
      oristudioCpInlineSimulations: Array.from({ length: MAX_CONCURRENT_SIMULATIONS }, (_, i) =>
        windowAt(`sim-${i}`)
      ),
    });

    const result = await useWorkspaceStore.getState().addOristudioCpInlineSimulation(0);
    expect(result).toBe('at-capacity');
  });

  it('tells a full workspace apart from a region that cannot be simulated', async () => {
    // Different outcomes, and only one of them is worth interrupting for.
    useWorkspaceStore.setState({
      oristudioCpDocument: null,
      oristudioCpInlineSimulations: [],
    });
    expect(await useWorkspaceStore.getState().addOristudioCpInlineSimulation(0)).toBe(
      'unavailable'
    );
  });
});
