import { act, useEffect, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDiagram,
  type DiagramCpScope,
  type DiagramSavedShape,
  type DiagramSimulatedView,
} from '../document/diagramDocument';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { SimulatorFrameView } from '../../simulator/useSimulatorRuntime';
import { encodeSimulatorShapeState, type SimulatorShape } from '../../simulator/simulatorShape';
import { simulatedSaveNow } from './openLinkedPose';
import type { SimulatedSave } from './poseController';
import {
  useDiagramSimulatedPose,
  type DiagramSimulatedPose,
  type DiagramSimulatedPoseRender,
} from './useDiagramSimulatedPose';

/**
 * Pose's live simulator against a stand-in runtime: what it saves as Pose
 * closes, and in what order it asks the worker; what it opens on, held or
 * not; which stored poses the view follows; and Refresh while it is open.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sim = vi.hoisted(() => ({
  log: [] as string[],
  onFrame: null as ((frame: unknown) => void) | null,
  /** What the load was given to open on. */
  initialShape: undefined as unknown,
  /** The model the runtime holds: its `restored` says what the load's shape did. */
  model: null as unknown,
  /** Whether the worker says its solver had settled when a capture is asked. */
  settled: true,
  tracked: [] as string[],
}));

vi.mock('../../simulator/useSimulatorRuntime', () => ({
  useSimulatorRuntime: (options: { onFrame?: (frame: unknown) => void; initialShape?: unknown }) => {
    sim.onFrame = options.onFrame ?? null;
    sim.initialShape = options.initialShape;
    // Its own effect, after the hook's: what the real runtime's release is.
    useEffect(() => () => void sim.log.push('runtime released'), []);
    return runtime;
  },
}));
vi.mock('../../analytics', () => ({
  trackDiagramSimulationResumed: () => void sim.tracked.push('diagram simulation resumed'),
}));

/** The positions a capture reads: one node off the sheet, one crease turned. */
const STATE = new Float32Array([0.5, 0, -0.25, 1.5]);
const SCENE = { bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, items: [] };

const stillCapture = vi.fn(async (_options: unknown) => {
  sim.log.push('capture asked');
  const shape: SimulatorShape = { sheet: 'sk1:sheet', pins: [], posed: false, state: STATE.slice() };
  return { scene: SCENE, shape, settled: sim.settled };
});
const restoreShape = vi.fn(async (_foldPercent: number, _shape: SimulatorShape | null) => ({ pins: [], posed: false }) as const);
const setFoldPercent = vi.fn();
const runtime = {
  status: 'ready',
  error: null,
  gpuActive: true,
  setFoldPercent,
  setCamera: () => {},
  setRenderSettings: () => {},
  reset: () => {},
  restoreShape,
  stillCapture,
  get model() {
    return sim.model;
  },
};
vi.mock('../../simulator/workerGpuSupport', () => ({ useWorkerGpuSupport: () => true }));
vi.mock('../../simulator/useSimulatorShortcuts', () => ({ useSimulatorShortcuts: () => {} }));
vi.mock('../../cp-workspace/sheets/useCpSheetIndexState', () => ({
  useCpSheetIndexState: () => ({ status: 'ready', index: INDEX }),
}));
const INDEX = {};
const SHEET = { id: 0 };
vi.mock('./linkStatus', () => ({ stepSheet: () => SHEET }));
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
/** A step's stored positions, as the file keeps them. */
const stored = (settled: boolean, state = STATE): DiagramSavedShape => ({
  sheet: 'sk1:sheet',
  state: encodeSimulatorShapeState(state)!,
  settled,
});
/** The load put the step's positions back. */
const PUT_BACK = { restored: { pins: [], posed: false } };

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
    known: { fingerprint: 'rc1:0000000000000000', drawn: false },
    render: { foldPercent: 40, view: VIEW } as DiagramSimulatedPoseRender,
    onSave: vi.fn(async (_save: SimulatedSave) => {}),
    wantsSave: vi.fn((_untouched: boolean) => true),
    ...props,
  };
  host ??= document.body.appendChild(document.createElement('div'));
  root ??= createRoot(host);
  act(() => root!.render(<Probe {...all} />));
  return all;
}

function unmount() {
  act(() => root!.unmount());
  root = null;
}

/** The camera as the viewport pushes it: first where it opens, then where it is turned to. */
const push = (view: DiagramSimulatedView) => act(() => seen.pose!.pushCamera(view, 800, 600));
const frame = (converged: boolean) =>
  act(() => sim.onFrame?.({ converged, foldPercent: 40 } as unknown as SimulatorFrameView));

/** What a save hands the controller, its capture landed. */
async function landed(onSave: ReturnType<typeof mount>['onSave'], call = -1) {
  const save = vi.mocked(onSave).mock.calls.at(call)![0];
  return { ...save, captured: await save.capture };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
  sim.log = [];
  sim.tracked = [];
  sim.model = { restored: null };
  sim.settled = true;
  stillCapture.mockClear();
  restoreShape.mockClear();
  setFoldPercent.mockClear();
  viewport.setView.mockClear();
  useWorkspaceStore.setState({ diagram: createDiagram({ newId: () => 'diagram-1' }) });
});

afterEach(() => {
  if (root) unmount();
  host?.remove();
  host = null;
  seen.pose = null;
  vi.useRealTimers();
});

describe('useDiagramSimulatedPose', () => {
  it('saves what it shows as Pose closes, asked before the runtime lets the model go, the worker held', async () => {
    const { onSave } = mount();
    await act(async () => {});
    push(VIEW);
    push({ ...VIEW, yaw: 1.2 });
    sim.log = [];
    unmount();
    expect(sim.log.slice(0, 3)).toEqual(['worker held', 'capture asked', 'runtime released']);
    expect(stillCapture).toHaveBeenCalledWith(expect.objectContaining({ view: { ...VIEW, yaw: 1.2 }, size: 512 }));
    // Nothing settled first: the capture is the worker's as it is.
    expect(stillCapture.mock.calls[0]![0]).not.toHaveProperty('settleSteps');
    const save = await landed(onSave);
    expect(save).toMatchObject({ foldPercent: 40, view: { ...VIEW, yaw: 1.2 } });
    expect(save.captured).toEqual({ scene: SCENE, shape: stored(true) });
    await act(async () => {});
    expect(sim.log.filter((entry) => entry === 'worker let go')).toHaveLength(1);
  });

  it('saves Done mid-play: the positions as they were, unsettled, whatever the fold was doing', async () => {
    const { onSave, wantsSave } = mount();
    await act(async () => {});
    push(VIEW);
    act(() => seen.pose!.togglePlay());
    expect(seen.pose!.playing).toBe(true);
    sim.settled = false;
    unmount();
    expect(wantsSave).toHaveBeenLastCalledWith(false);
    const save = await landed(onSave);
    expect(save.foldPercent).toBe(40);
    expect(save.captured).toEqual({ scene: SCENE, shape: stored(false) });
  });

  it('saves 45 → 100 → 45, though it ends at the fold % and camera the step stores', async () => {
    sim.model = PUT_BACK;
    const { onSave, wantsSave } = mount({ render: { foldPercent: 45, view: VIEW, shape: stored(true) } });
    await act(async () => {});
    push(VIEW);
    act(() => seen.pose!.scrub(100));
    act(() => seen.pose!.scrub(45));
    unmount();
    // The solve is path-dependent: back at 45% is another shape.
    expect(wantsSave).toHaveBeenLastCalledWith(false);
    expect(onSave).toHaveBeenCalledOnce();
    expect((await landed(onSave)).foldPercent).toBe(45);
  });

  it('opens on the step’s own positions and, untouched, asks whether a save would commit anything', async () => {
    sim.model = PUT_BACK;
    const shape = stored(true);
    const { onSave, wantsSave } = mount({ render: { foldPercent: 45, view: VIEW, shape }, wantsSave: vi.fn(() => false) });
    expect(sim.initialShape).toEqual({ sheet: 'sk1:sheet', pins: [], posed: false, state: STATE });
    await act(async () => {});
    push(VIEW);
    expect(seen.pose!.held).toBe(false);
    unmount();
    expect(wantsSave).toHaveBeenLastCalledWith(true);
    expect(stillCapture).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('opens held on positions saved unsettled, and Play goes on from them at their fold %', async () => {
    sim.model = PUT_BACK;
    const { onSave, wantsSave } = mount({ render: { foldPercent: 45, view: VIEW, shape: stored(false) } });
    await act(async () => {});
    push(VIEW);
    expect(seen.pose!.held).toBe(true);
    // Turned, still held: the camera moves nothing.
    push({ ...VIEW, yaw: 1 });
    expect(seen.pose!.held).toBe(true);
    act(() => seen.pose!.resume());
    expect(seen.pose!.held).toBe(false);
    expect(setFoldPercent).toHaveBeenLastCalledWith(45);
    expect(sim.tracked).toEqual(['diagram simulation resumed']);
    unmount();
    expect(wantsSave).toHaveBeenLastCalledWith(false);
    expect((await landed(onSave)).captured?.shape?.settled).toBe(true);
  });

  it('keeps held positions unsettled when it saves them, whatever the still solver says', async () => {
    sim.model = PUT_BACK;
    // Out of date (another light): saved though untouched.
    const { onSave, wantsSave } = mount({ render: { foldPercent: 45, view: VIEW, shape: stored(false) } });
    await act(async () => {});
    push(VIEW);
    sim.settled = true;
    unmount();
    expect(wantsSave).toHaveBeenLastCalledWith(true);
    expect((await landed(onSave)).captured).toEqual({ scene: SCENE, shape: stored(false) });
  });

  it('folds from flat when its positions are another sheet’s, and its first save stores the new ones', async () => {
    sim.model = { restored: 'mismatch' };
    const { onSave, wantsSave } = mount({ render: { foldPercent: 45, view: VIEW, shape: stored(false) } });
    await act(async () => {});
    push(VIEW);
    expect(seen.pose!.held).toBe(false);
    unmount();
    expect(wantsSave).toHaveBeenLastCalledWith(false);
    expect((await landed(onSave)).captured?.shape).toEqual(stored(true));
  });

  it('opens a step saved without positions as before — at its fold % and camera — and saves them on leaving', async () => {
    const { onSave, wantsSave } = mount();
    expect(sim.initialShape).toBeNull();
    await act(async () => {});
    push(VIEW);
    unmount();
    expect(wantsSave).toHaveBeenLastCalledWith(false);
    expect((await landed(onSave)).captured?.shape).toEqual(stored(true));
  });

  it('has nothing to store for an untouched step at 0%: the flat sheet is its own', async () => {
    const { wantsSave } = mount({ render: { foldPercent: 0, view: VIEW }, wantsSave: vi.fn(() => false) });
    await act(async () => {});
    push(VIEW);
    unmount();
    expect(wantsSave).toHaveBeenLastCalledWith(true);
  });

  it('leaves a step whose positions are another build’s as it is, untouched', async () => {
    const theirs = { id: 'shape-1', sheet: 'sk1:sheet', pins: [[0.25, 0.5]], posed: true, state: 'v1:AAAA' };
    const { wantsSave } = mount({ render: { foldPercent: 45, view: VIEW, shape: theirs }, wantsSave: vi.fn(() => false) });
    expect(sim.initialShape).toBeNull();
    await act(async () => {});
    push(VIEW);
    unmount();
    expect(wantsSave).toHaveBeenLastCalledWith(true);
  });

  it('has nothing to store after Reset Pose, the flat sheet at 0%', async () => {
    const props = mount({ wantsSave: vi.fn(() => false) });
    await act(async () => {});
    push(VIEW);
    act(() => seen.pose!.scrub(70));
    // Reset Pose lands: the default camera at 0%, no positions.
    const reset = { yaw: Math.PI / 4, pitch: -0.955, zoom: 1.4 };
    mount({ ...props, render: { foldPercent: 0, view: reset } });
    await act(async () => {});
    expect(restoreShape).toHaveBeenLastCalledWith(0, null);
    push(reset);
    unmount();
    expect(props.wantsSave).toHaveBeenLastCalledWith(true);
  });

  it('saves the stored camera while the view is still at it, so float noise is no change', async () => {
    const { onSave } = mount();
    await act(async () => {});
    push({ ...VIEW, yaw: VIEW.yaw + 1e-9 });
    unmount();
    expect((await landed(onSave)).view).toBe(VIEW);
  });

  it('does not follow a save it sent, follows an undo to stored positions, and folds an older pose from flat', async () => {
    const props = mount();
    await act(async () => {});
    push(VIEW);
    const turned = { ...VIEW, yaw: 1.5 };
    push(turned);
    act(() => void simulatedSaveNow('step-s'));
    await act(async () => {});
    viewport.setView.mockClear();
    // Its save lands: the view is there already.
    mount({ ...props, render: { foldPercent: 40, view: turned, shape: stored(true) } });
    expect(viewport.setView).not.toHaveBeenCalled();
    expect(restoreShape).not.toHaveBeenCalled();
    // An undo to positions it never sent: put back, held where they were saved.
    const earlier = new Float32Array([0, 0, 0, 0.5]);
    mount({ ...props, render: { foldPercent: 30, view: VIEW, shape: stored(false, earlier) } });
    expect(viewport.setView).toHaveBeenCalledWith(VIEW);
    expect(restoreShape).toHaveBeenLastCalledWith(30, { sheet: 'sk1:sheet', pins: [], posed: false, state: earlier });
    expect(seen.pose!.held).toBe(true);
    expect(seen.pose!.foldPercent).toBe(30);
    await act(async () => {});
    // Back to a pose saved before positions were: folded from flat to its fold %.
    mount({ ...props, render: { foldPercent: 20, view: VIEW } });
    await act(async () => {});
    expect(restoreShape).toHaveBeenLastCalledWith(20, null);
    expect(seen.pose!.held).toBe(false);
  });

  it('saves now for Refresh beside the open step, and for no other step', async () => {
    const { onSave } = mount();
    await act(async () => {});
    push(VIEW);
    expect(simulatedSaveNow('another-step')).toBe(false);
    act(() => void simulatedSaveNow('step-s'));
    expect(onSave).toHaveBeenCalledOnce();
    unmount();
    // Pose closed: nothing open to save.
    expect(simulatedSaveNow('step-s')).toBe(false);
  });

  it('captures nothing as the model moves or rests', async () => {
    const { onSave } = mount();
    await act(async () => {});
    push(VIEW);
    frame(false);
    push({ ...VIEW, yaw: 1.2 });
    act(() => seen.pose!.scrub(70));
    frame(true);
    act(() => vi.advanceTimersByTime(10_000));
    expect(stillCapture).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
