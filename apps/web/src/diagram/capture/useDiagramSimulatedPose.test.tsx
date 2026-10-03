import { act, useEffect, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiagram, type DiagramCpScope, type DiagramSimulatedView } from '../document/diagramDocument';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { SimulatorFrameView } from '../../simulator/useSimulatorRuntime';
import { simulatedRestNow } from './openLinkedPose';
import type { SimulatedRest } from './poseController';
import { useDiagramSimulatedPose, type DiagramSimulatedPose } from './useDiagramSimulatedPose';

/**
 * Pose's live simulator against a stand-in runtime: the order the worker is
 * asked things in as Pose closes, when a rest's scene is taken, which stored
 * poses the view follows, and the first rest of a model that never settles.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sim = vi.hoisted(() => ({
  log: [] as string[],
  onFrame: null as ((frame: unknown) => void) | null,
  stillScene: (() => Promise.resolve(null)) as (...args: unknown[]) => Promise<unknown>,
}));

vi.mock('../../simulator/useSimulatorRuntime', () => ({
  useSimulatorRuntime: (options: { onFrame?: (frame: unknown) => void }) => {
    sim.onFrame = options.onFrame ?? null;
    // Its own effect, after the hook's: what the real runtime's release is.
    useEffect(() => () => void sim.log.push('runtime released'), []);
    return runtime;
  },
}));
const runtime = {
  status: 'ready',
  error: null,
  gpuActive: true,
  setFoldPercent: () => {},
  setCamera: () => {},
  setRenderSettings: () => {},
  reset: () => {},
  stillScene: (...args: unknown[]) => sim.stillScene(...args),
};
vi.mock('../../simulator/workerGpuSupport', () => ({ useWorkerGpuSupport: () => true }));
vi.mock('../../simulator/useSimulatorShortcuts', () => ({ useSimulatorShortcuts: () => {} }));
vi.mock('./useLinkStatus', () => ({ useCpSegmentationState: () => ({ status: 'ready', artifacts: ARTIFACTS }) }));
const ARTIFACTS = {};
const SEGMENT = { id: 0 };
vi.mock('../../cp-workspace/regions/regionReference', () => ({ resolveRegion: () => SEGMENT }));
vi.mock('../../lib/creasePatternSegmentation', () => ({ resolveCpSegments: () => [] }));
vi.mock('../../store/workspaceStore/diagramCapture', () => ({
  SIMULATED_FRAME_PX: 512,
  storeSimulationFold: async () => ({ faces_vertices: [[0, 1, 2]] }),
}));
vi.mock('../../store/workspaceStore/simulatorRuntime', () => ({
  retainSimulatorClient: () => void sim.log.push('worker held'),
  releaseSimulatorClient: () => void sim.log.push('worker let go'),
}));

const SCOPE = { kind: 'segment', region: { boundary: [], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, segmentIdHint: 0 } } as unknown as DiagramCpScope;
const VIEW: DiagramSimulatedView = { yaw: 0.8, pitch: -0.9, zoom: 1.4 };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const seen: { pose: DiagramSimulatedPose | null } = { pose: null };
const viewport = { setView: vi.fn(), showFrame: vi.fn(), resetView: vi.fn(), zoomBy: vi.fn() };

function Probe(props: Parameters<typeof useDiagramSimulatedPose>[0]) {
  const pose = useDiagramSimulatedPose(props);
  const { viewportRef } = pose;
  useLayoutEffect(() => {
    seen.pose = pose;
    // The viewport the view would attach.
    Object.assign(viewportRef, { current: viewport });
  });
  return null;
}

function mount(props: Partial<Parameters<typeof useDiagramSimulatedPose>[0]> = {}) {
  const all = {
    stepId: 'step-s',
    scope: SCOPE,
    render: { foldPercent: 40, view: VIEW },
    onRest: vi.fn(async (_rest: SimulatedRest) => {}),
    wantsRest: vi.fn((_pose: Pick<SimulatedRest, 'foldPercent' | 'view'>) => true),
    ...props,
  };
  host ??= document.body.appendChild(document.createElement('div'));
  root ??= createRoot(host);
  act(() => root!.render(<Probe {...all} />));
  return all;
}

const frame = (converged: boolean) =>
  act(() => sim.onFrame?.({ converged, foldPercent: 40 } as unknown as SimulatorFrameView));
/** The camera as the viewport pushes it: first where it opens, then where it is turned to. */
const push = (view: DiagramSimulatedView) => act(() => seen.pose!.pushCamera(view, 800, 600));

const stillScene = vi.fn(async (..._args: unknown[]) => {
  sim.log.push('scene asked');
  return { bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, items: [] };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  sim.log = [];
  stillScene.mockClear();
  sim.stillScene = stillScene;
  viewport.setView.mockClear();
  useWorkspaceStore.setState({ diagram: createDiagram({ newId: () => 'diagram-1' }) });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  seen.pose = null;
  vi.useRealTimers();
});

describe('useDiagramSimulatedPose', () => {
  it('asks for a move’s scene as Pose closes, settled, before the runtime lets the model go, the worker held', async () => {
    const { onRest } = mount();
    await act(async () => {});
    push(VIEW);
    push({ ...VIEW, yaw: 1.2 });
    sim.log = [];
    act(() => root!.unmount());
    root = null;
    expect(sim.log.slice(0, 3)).toEqual(['worker held', 'scene asked', 'runtime released']);
    expect(stillScene).toHaveBeenCalledWith(expect.objectContaining({ settleSteps: 20_000, view: { ...VIEW, yaw: 1.2 } }));
    expect(onRest).toHaveBeenCalledWith(expect.objectContaining({ foldPercent: 40, view: { ...VIEW, yaw: 1.2 } }));
    await act(async () => {});
    expect(sim.log.filter((entry) => entry === 'worker let go')).toHaveLength(1);
  });

  it('takes a rest’s scene as it rests, of that pose, and hands that scene over', async () => {
    const onRest = vi.fn(async (_rest: SimulatedRest) => {});
    mount({ onRest });
    await act(async () => {});
    push(VIEW);
    frame(true);
    push({ ...VIEW, yaw: 1.2 });
    act(() => vi.advanceTimersByTime(500));
    expect(stillScene).toHaveBeenCalledWith(expect.objectContaining({ view: { ...VIEW, yaw: 1.2 } }));
    const rest = onRest.mock.calls.at(-1)![0];
    // The controller's own call reads the scene already asked for, whatever comes after.
    stillScene.mockClear();
    await expect(rest.still(VIEW, {} as never)).resolves.toMatchObject({ items: [] });
    expect(stillScene).not.toHaveBeenCalled();
  });

  it('asks nothing of the worker for a rest that would not be captured', async () => {
    const { onRest } = mount({ wantsRest: vi.fn(() => false) });
    await act(async () => {});
    push(VIEW);
    frame(true);
    push({ ...VIEW, yaw: 1.2 });
    act(() => vi.advanceTimersByTime(500));
    expect(stillScene).not.toHaveBeenCalled();
    expect(onRest).not.toHaveBeenCalled();
  });

  it('does not follow a capture of a rest it sent, even an earlier one landing after a later rest', async () => {
    const props = mount();
    await act(async () => {});
    push(VIEW);
    frame(true);
    const a = { ...VIEW, yaw: 1 };
    const b = { ...VIEW, yaw: 1.5 };
    push(a);
    act(() => vi.advanceTimersByTime(500));
    push(b);
    act(() => vi.advanceTimersByTime(500));
    viewport.setView.mockClear();
    // A's capture lands, then B's: neither is a change to follow.
    mount({ ...props, render: { foldPercent: 40, view: a } });
    mount({ ...props, render: { foldPercent: 40, view: b } });
    expect(viewport.setView).not.toHaveBeenCalled();
    // An undo to a pose it never sent is followed.
    mount({ ...props, render: { foldPercent: 40, view: VIEW } });
    expect(viewport.setView).toHaveBeenCalledWith(VIEW);
  });

  it('rests at once for Pose Again from beside the open step, and for no other step', async () => {
    const wantsRest = vi.fn((_pose: Pick<SimulatedRest, 'foldPercent' | 'view'>) => true);
    mount({ wantsRest });
    await act(async () => {});
    push(VIEW);
    frame(true);
    wantsRest.mockClear();
    expect(simulatedRestNow('another-step')).toBe(false);
    act(() => void simulatedRestNow('step-s'));
    expect(wantsRest).toHaveBeenCalledWith({ foldPercent: 40, view: VIEW });
    act(() => root!.unmount());
    root = null;
    // Pose closed: nothing open to rest.
    expect(simulatedRestNow('step-s')).toBe(false);
  });

  it('offers a first rest for a model that never settles, once it has had long enough', async () => {
    const { onRest, wantsRest } = mount();
    await act(async () => {});
    push(VIEW);
    frame(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(onRest).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(4000));
    // Pose again: offered, and the controller judges it.
    expect(wantsRest).toHaveBeenCalledWith({ foldPercent: 40, view: VIEW });
    expect(onRest).toHaveBeenCalledOnce();
  });
});
