/**
 * What the Simulate tab commands while the fold plays.
 *
 * Separate from `SimulatorPanel.test.tsx` because it needs two things that file
 * deliberately does not have: a hand-driven animation clock, and a client whose
 * tick replies land a chosen number of frames late. Both are module-scoped, and
 * both are the point — the defect this covers only exists because a reply is in
 * flight while the playback loop keeps stepping.
 *
 * The panel used to fail this. Its fold position was a plain ref written by the
 * playback loop *and* by every solver frame, and a frame carries the target as
 * it was when the worker ticked. So each landed frame dragged the position back
 * by a round-trip's worth, the loop re-advanced from there, and the target the
 * solver was chasing sawtoothed: the paper visibly unfolded and refolded, and
 * the readout ran backwards. See `FoldPlayhead`, which is the rule that settles
 * it, and the inline windows, which have used it since.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldDocument } from '../../engine/types';
import { createSampleProject } from '../../lib/sampleProject';
import { singleTreemakerDesignTab } from '../../store/workspaceStore/designTabs';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createSimulatorSession } from '../../simulator/simulatorSession';
import { TooltipProvider } from '../ui/Tooltip';
import { SimulatorPanel } from './SimulatorPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Frames a tick reply takes to get back to the main thread. Set per test. */
let tickLatencyFrames = 0;
let frameNumber = 0;
let heldReplies: Array<{ releaseAt: number; release: () => void }> = [];
/** Every fold target the panel commanded, in order. */
let commanded: number[] = [];

/**
 * The real session, behind the two properties of a worker that matter here: its
 * methods are async, and a reply is separated in time from the message that
 * produced it. The call itself still applies immediately — a worker runs the
 * message when it receives it — so a reply carries the state as of *its* tick,
 * which is exactly the staleness under test.
 */
function asWorkerLikeClient<T extends object>(session: T): T {
  return new Proxy(session, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        if (prop === 'setFoldPercent') commanded.push(args[0] as number);
        if (prop !== 'tick' || tickLatencyFrames === 0) return Promise.resolve(result);
        return new Promise((resolve) => {
          heldReplies.push({
            releaseAt: frameNumber + tickLatencyFrames,
            release: () => resolve(result),
          });
        });
      };
    },
  });
}

vi.mock('../../store/workspaceStore/simulatorRuntime', () => ({
  retainSimulatorClient: () => asWorkerLikeClient(createSimulatorSession()),
  releaseSimulatorClient: () => {},
  simulatorClientRefCount: () => 1,
}));

const FRAME_MS = 16.7;
const FRAMES = 24;

const rafCallbacks = new Map<number, FrameRequestCallback>();
let nextRafId = 1;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

describe('SimulatorPanel playback', () => {
  it('never walks the fold target backwards while a reply is in flight', async () => {
    tickLatencyFrames = 2;
    const targets = await playFor(FRAMES);

    expect(targets.length).toBeGreaterThan(FRAMES / 2);
    // A tolerance rather than a plain `>=`, so this fails on a fold that visibly
    // goes backwards and not on the last bit of a float.
    const backwards = targets.filter((value, i) => i > 0 && value < targets[i - 1]! - 1e-6);
    expect(backwards).toEqual([]);
  });

  it('advances at the configured rate regardless of how late replies land', async () => {
    const rate = useWorkspaceStore.getState().simulatorSettings.foldPlayPercentPerSecond;
    // The first frame establishes the clock, so it contributes no elapsed time.
    const expected = ((FRAMES - 1) * FRAME_MS * rate) / 1000;

    tickLatencyFrames = 0;
    const immediate = await playFor(FRAMES);
    teardown();

    tickLatencyFrames = 3;
    const late = await playFor(FRAMES);

    expect(immediate.at(-1)).toBeCloseTo(expected, 2);
    expect(late.at(-1)).toBeCloseTo(expected, 2);
  });
});

/** Press play, run `frames` animation frames, and return what was commanded. */
async function playFor(frames: number): Promise<number[]> {
  const rendered = renderPanel();
  await flush(14);

  const play = rendered.querySelector<HTMLButtonElement>('[aria-label="Play"]');
  expect(play).not.toBeNull();
  // Only what playback commands, not the load's own settling.
  commanded = [];
  act(() => play?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

  for (let i = 0; i < frames; i += 1) await runFrame();
  const targets = [...commanded];
  await flush(8);
  return targets;
}

/** One animation frame: land whatever replies are due, then run the callbacks. */
async function runFrame(): Promise<void> {
  frameNumber += 1;
  const due = heldReplies.filter((reply) => reply.releaseAt <= frameNumber);
  heldReplies = heldReplies.filter((reply) => reply.releaseAt > frameNumber);
  for (const reply of due) reply.release();
  await flush(2);

  const callbacks = [...rafCallbacks.values()];
  rafCallbacks.clear();
  await act(async () => {
    for (const callback of callbacks) callback(frameNumber * FRAME_MS);
  });
  await flush(2);
}

async function flush(times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function renderPanel(): HTMLDivElement {
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      ...singleTreemakerDesignTab({ project: createSampleProject() }),
      status: 'crease_pattern_ready',
      engineReady: true,
      foldArtifacts: { fold: simpleFold() },
    },
    true
  );

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider>
        <SimulatorPanel />
      </TooltipProvider>
    );
  });
  return container;
}

function simpleFold(): FoldDocument {
  return {
    file_spec: 1.2,
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 2],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'V'],
    edges_foldAngle: [null, null, null, null, 180],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  };
}

beforeEach(() => {
  frameNumber = 0;
  commanded = [];
  heldReplies = [];
  rafCallbacks.clear();
  nextRafId = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextRafId++;
    rafCallbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafCallbacks.delete(id);
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stubCanvasContext());
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 420,
    height: 320,
    x: 0,
    y: 0,
    top: 0,
    right: 420,
    bottom: 320,
    left: 0,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  teardown();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

function teardown(): void {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
}

function stubCanvasContext(): CanvasRenderingContext2D {
  const imageData = {
    data: new Uint8ClampedArray(420 * 360 * 4),
    width: 420,
    height: 360,
    colorSpace: 'srgb',
  } as ImageData;
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    getImageData: vi.fn(() => imageData),
    putImageData: vi.fn(),
    setLineDash: vi.fn(),
    getLineDash: vi.fn(() => []),
    globalAlpha: 1,
    fillStyle: '',
    shadowBlur: 0,
    shadowColor: '',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}
