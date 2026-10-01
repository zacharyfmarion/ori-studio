import { singleTreemakerDesignTab } from '../../store/workspaceStore/designTabs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldDocument } from '../../engine/types';
import { createSampleProject } from '../../lib/sampleProject';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useSettingsStore } from '../../store/settingsStore';
import { TooltipProvider } from '../ui/Tooltip';
import { SimulatorPanel } from './SimulatorPanel';
import { createSimulatorSession } from '../../simulator/simulatorSession';
import {
  handleShortcutRuntimeKeyDown,
  runSimulatorCommand,
} from '../../keyboard/shortcutRuntime';
import { announceUprightSet } from '../../lib/uprightFeedback';
import { setUprightView } from '../../lib/simulatorOrbit';
import { PHONE_MEDIA_QUERY } from '../../platform/phoneLayout';
import { useLayoutStore } from '../../store/layoutStore';
import { usePaperExportUiStore } from '../../store/paperExportUiStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The solver runs in a Worker, which jsdom does not provide. Rather than stub
// out the simulator (which would stop these tests exercising triangulation and
// the render path at all), run the real session in-process -- simulatorWorker
// is only a comlink wrapper around it, so this is the same code the app runs.
// comlink makes every session method async in production; the runtime relies on
// that (client.tick(...).then, mutate(client).catch). Wrap the in-process
// session so its methods return promises too, otherwise unsettling the model
// (e.g. scrubbing the fold) would call .then/.catch on a sync return value.
function asPromiseClient<T extends object>(session: T): T {
  return new Proxy(session, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => Promise.resolve(value.apply(target, args));
    },
  });
}

// The toast and the analytics event are the verb's outward sign — the picture
// does not move on the press — and the orbit it takes is what it changes.
vi.mock('../../lib/uprightFeedback', () => ({ announceUprightSet: vi.fn() }));
vi.mock('../../lib/simulatorOrbit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/simulatorOrbit')>();
  return { ...actual, setUprightView: vi.fn(actual.setUprightView) };
});

vi.mock('../../store/workspaceStore/simulatorRuntime', () => ({
  retainSimulatorClient: () => asPromiseClient(createSimulatorSession()),
  releaseSimulatorClient: () => {},
  simulatorClientRefCount: () => 1,
}));

/**
 * Let the runtime's load -> settle -> first frame chain resolve. The worker API
 * is async, so a rendered panel has no geometry until these microtasks flush.
 */
async function flushSimulator(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let canvasContext: CanvasRenderingContext2D;
let putImageDataMock: ReturnType<typeof vi.fn>;
let fillMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  canvasContext = mockCanvasContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext);
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
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  usePaperExportUiStore.getState().close();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
});

describe('SimulatorPanel', () => {
  it('renders whole-mode labels by default', async () => {
    const rendered = renderPanel({ foldArtifacts: { fold: simpleFold() } });
    await flushSimulator();

    expect(rendered.querySelector('[aria-label="Fold percent"]')).not.toBeNull();
    expect(rendered.querySelector('.simulator-canvas')?.getAttribute('data-lighting')).toBe(
      'true'
    );
    expect(putImageDataMock).toHaveBeenCalled();
    // Re-pinned: one `fill` per frame was the lit frame's drop shadow, which
    // neither the GPU renderer nor the export drew. The paper itself goes
    // through the depth rasterizer, so a lit frame fills no path at all now.
    expect(fillMock).not.toHaveBeenCalled();

    // The render toggles now live in the options pane (a sibling panel), so the
    // canvas follows the shared store setting rather than a local button.
    act(() => {
      const { paperStyle, setPaperStyleField } = useSettingsStore.getState();
      setPaperStyleField('display', 'light', { ...paperStyle.display.light, enabled: false });
    });

    expect(rendered.querySelector('.simulator-canvas')?.getAttribute('data-lighting')).toBeNull();
  });

  it('leaves Export and Set upright to the options rail', async () => {
    const rendered = renderPanel({ foldArtifacts: { fold: simpleFold() } });
    await flushSimulator();

    const toolbar = rendered.querySelector('.simulator-panel .panel-toolbar');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.querySelector('button[aria-label="Export view…"]')).toBeNull();
    expect(toolbar?.querySelector('button[aria-label="Set upright"]')).toBeNull();
    // The touch layer's Settings pill keeps its seat.
    expect(toolbar?.querySelector('.panel-toolbar__pills')).not.toBeNull();
  });

  it('opens the export dialog on the frame the worker froze', async () => {
    renderPanel({ foldArtifacts: { fold: simpleFold() } });
    await flushSimulator();
    act(() => useWorkspaceStore.setState({ workspaceTitle: 'Crane base' }));
    expect(usePaperExportUiStore.getState().request).toBeNull();

    // The rail's button, which reaches the view through its executor.
    let ran = false;
    act(() => {
      ran = runSimulatorCommand('simulator.exportView');
    });
    expect(ran).toBe(true);
    await flushSimulator();

    const request = usePaperExportUiStore.getState().request;
    if (!request) throw new Error('the export dialog did not open');
    expect(request.format).toBeNull();
    expect(request.scope).toBe('this');
    const { target } = request;
    expect(target.surface).toBe('simulator');
    expect(target.title).toBe('Export view');
    expect(target.fileStem).toBe('Crane base');
    expect(target.pages).toBeNull();
    expect(target.pins).toBeNull();
    expect(target.buriesFaces).toBe(true);

    // The target reaches the in-process session: a scene of the loaded model.
    const input = {
      page: 0,
      style: target.exportStyle,
      markHidden: false,
      background: null,
      sheet: { mm: 60 },
    };
    const scene = await target.buildScene(input);
    expect(scene?.items.length).toBeGreaterThan(0);

    // Closing the dialog lets the worker drop the frame, so a late rebuild
    // finds nothing to draw.
    act(() => usePaperExportUiStore.getState().close());
    await flushSimulator();
    await expect(target.buildScene(input)).resolves.toBeNull();
  });

  it('offers a view cube, turned to the camera before its first paint', async () => {
    const rendered = renderPanel({ foldArtifacts: { fold: simpleFold() } });
    await flushSimulator();

    const cube = rendered.querySelector('.simulator-view-cube');
    expect(cube).not.toBeNull();
    // The cube has no opening view of its own — the viewport points it at the
    // live camera as the handle attaches — so an unset transform here would mean
    // the cube renders square-on until the user drags.
    const scene = cube?.querySelector<HTMLElement>('.simulator-view-cube__scene');
    expect(scene?.style.transform).toMatch(/^matrix3d\(/);
    expect(cube?.getAttribute('data-interactive')).toBe('true');
  });

  it('drops the cube when the options pane turns it off', async () => {
    const rendered = renderPanel({ foldArtifacts: { fold: simpleFold() } });
    await flushSimulator();
    expect(rendered.querySelector('.simulator-view-cube')).not.toBeNull();

    act(() => {
      useWorkspaceStore.getState().setSimulatorSetting('showViewCube', false);
    });

    expect(rendered.querySelector('.simulator-view-cube')).toBeNull();
  });

  it('keeps the cube out of the way while there is nothing to look at', () => {
    const rendered = renderPanel({});

    expect(rendered.querySelector('.simulator-view-cube')?.getAttribute('data-interactive')).toBeNull();
    const spots = rendered.querySelectorAll<HTMLButtonElement>('.simulator-view-cube__spot');
    expect(spots).toHaveLength(54);
    expect(Array.from(spots).every((spot) => spot.disabled)).toBe(true);
  });

  it('sets the model upright through the view’s own verb', async () => {
    renderPanel({ foldArtifacts: { fold: simpleFold() } });
    await flushSimulator();
    vi.mocked(announceUprightSet).mockClear();
    vi.mocked(setUprightView).mockClear();

    let ran = false;
    act(() => {
      ran = runSimulatorCommand('simulator.setUpright');
    });

    expect(ran).toBe(true);
    expect(setUprightView).toHaveBeenCalledTimes(1);
    expect(announceUprightSet).toHaveBeenCalledTimes(1);
  });

  it('takes no verbs with nothing to draw', () => {
    // Rendered with no fold artifacts, so the panel never reaches "ready" and
    // never registers an executor: the rail's buttons, which follow that, are
    // disabled, and a run finds nothing. An export here would open a dialog
    // and then fail.
    renderPanel({});

    expect(runSimulatorCommand('simulator.exportView')).toBe(false);
    expect(runSimulatorCommand('simulator.setUpright')).toBe(false);
    expect(usePaperExportUiStore.getState().request).toBeNull();
  });

  it('triangulates polygonal fold faces before rendering', async () => {
    const rendered = renderPanel({ foldArtifacts: { fold: quadFold() } });
    await flushSimulator();

    expect(rendered.textContent).toContain('4 vertices | 2 triangles');
  });

  it('drives the transport from the keyboard', async () => {
    const rendered = renderPanel({ foldArtifacts: { fold: simpleFold() } });
    await flushSimulator();

    // Space toggles play/pause (observed via the button's accessible name).
    expect(rendered.querySelector('[aria-label="Play"]')).not.toBeNull();
    act(() => pressKey(' '));
    expect(rendered.querySelector('[aria-label="Pause"]')).not.toBeNull();
    act(() => pressKey(' '));
    expect(rendered.querySelector('[aria-label="Play"]')).not.toBeNull();

    // Cmd+Arrow jumps the fold to the ends of the timeline.
    act(() => pressKey('ArrowRight', { metaKey: true }));
    expect(rendered.querySelector('output')?.textContent).toBe('100%');
    act(() => pressKey('ArrowLeft', { metaKey: true }));
    expect(rendered.querySelector('output')?.textContent).toBe('0%');

    // A plain arrow scrubs by a step, so 0 -> right lands above 0.
    act(() => pressKey('ArrowRight'));
    const scrubbed = Number(rendered.querySelector('output')?.textContent?.replace('%', ''));
    expect(scrubbed).toBeGreaterThan(0);

    // Let the async settle the scrubs kicked off resolve before teardown, so the
    // in-flight worker mutation is not rejected by unmount.
    await flushSimulator();
  });

  it('ignores shortcuts while typing in a field', async () => {
    const rendered = renderPanel({ foldArtifacts: { fold: simpleFold() } });
    await flushSimulator();

    const foldInput = rendered.querySelector<HTMLInputElement>('[aria-label="Fold percent"]');
    expect(foldInput).not.toBeNull();

    // A Space keydown originating from the range input must not toggle play.
    act(() => {
      foldInput?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(rendered.querySelector('[aria-label="Play"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Pause"]')).toBeNull();
  });
});

/**
 * The rail of the document's patterns, and the phone's two screens.
 *
 * The rail is presentation the panel composes: the segments, the selected one,
 * and a press that the panel routes through its phone flow. On a phone that
 * flow mounts the rail or the simulator, never both — a press on a card opens
 * the simulator with a Back button where the title was.
 */
describe('SimulatorPanel patterns', () => {
  const cards = (rendered: HTMLElement) =>
    [...rendered.querySelectorAll<HTMLButtonElement>('.sheet-card')];

  it('lists a document with more than one pattern and hides the rail for one', async () => {
    const rendered = renderPanel({ foldArtifacts: { fold: twoSquaresFold() } });
    await flushSimulator();

    expect(rendered.querySelector('.segments-sidebar')).not.toBeNull();
    // Reading order, each drawn from its own edges: a square with a diagonal.
    expect(cards(rendered)).toHaveLength(2);
    expect(cards(rendered)[0]?.getAttribute('aria-selected')).toBe('true');
    expect(cards(rendered)[0]?.querySelectorAll('.sheet-card__stroke')).toHaveLength(5);
    // Sized in faces: what the simulator folds, and a number the planarized
    // fold can answer for (its edge count is not the drawn-line count).
    expect(cards(rendered)[0]?.querySelector('.sheet-card__count')?.textContent).toBe('2 faces');

    // A press selects, on every layout.
    act(() => cards(rendered)[1]?.click());
    expect(useWorkspaceStore.getState().selectedSegmentId).toBe(1);
    expect(cards(rendered)[1]?.getAttribute('aria-selected')).toBe('true');
    // Both screens stay: the rail beside the simulator, whose title stays too.
    expect(rendered.querySelector('.simulator-panel')).not.toBeNull();
    expect(rendered.querySelector('.simulator-panel .panel-title')?.textContent).toBe('Simulator');

    // Let the sub-fold swap the runtime kicked off settle before teardown.
    await flushSimulator();
  });

  it('hides the rail for a single pattern', () => {
    const rendered = renderPanel({ foldArtifacts: { fold: simpleFold() } });
    expect(rendered.querySelector('.segments-sidebar')).toBeNull();
    expect(rendered.querySelector('.simulator-panel')).not.toBeNull();
  });

  it('seats the touch Settings pill in its toolbar', () => {
    const rendered = renderPanel({ foldArtifacts: { fold: simpleFold() } });
    const slot = rendered.querySelector('.simulator-panel .panel-toolbar .panel-toolbar__pills');
    expect(slot).not.toBeNull();
    expect(useLayoutStore.getState().viewDrawerSlot).toBe(slot);
    act(() => root?.unmount());
    expect(useLayoutStore.getState().viewDrawerSlot).toBeNull();
  });

  it('on a phone, opens a pattern from the list into the simulator and comes back', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === PHONE_MEDIA_QUERY,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    );
    try {
      const rendered = renderPanel({ foldArtifacts: { fold: twoSquaresFold() } });
      // The list, alone — the simulator, its toolbar and its slot are not mounted.
      expect(rendered.querySelector('.segments-sidebar')).not.toBeNull();
      expect(rendered.querySelector('.simulator-panel')).toBeNull();
      expect(useLayoutStore.getState().viewDrawerSlot).toBeNull();

      act(() => cards(rendered)[1]?.click());
      await flushSimulator();
      // The simulator, alone, on the pressed pattern, with the way back where
      // the title was.
      expect(useWorkspaceStore.getState().selectedSegmentId).toBe(1);
      expect(rendered.querySelector('.segments-sidebar')).toBeNull();
      expect(rendered.querySelector('.simulator-panel')).not.toBeNull();
      expect(rendered.querySelector('.simulator-panel__back')).not.toBeNull();
      expect(rendered.querySelector('.simulator-panel .panel-title')).toBeNull();

      act(() => rendered.querySelector<HTMLButtonElement>('.simulator-panel__back')?.click());
      expect(rendered.querySelector('.segments-sidebar')).not.toBeNull();
      expect(rendered.querySelector('.simulator-panel')).toBeNull();
      await flushSimulator();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('on a phone, opens straight on the simulator for a single pattern, with no Back', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === PHONE_MEDIA_QUERY,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    );
    try {
      const rendered = renderPanel({ foldArtifacts: { fold: simpleFold() } });
      expect(rendered.querySelector('.segments-sidebar')).toBeNull();
      expect(rendered.querySelector('.simulator-panel')).not.toBeNull();
      expect(rendered.querySelector('.simulator-panel__back')).toBeNull();
      expect(rendered.querySelector('.simulator-panel .panel-title')?.textContent).toBe('Simulator');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * The one transport control for starting over. It used to be two — Refresh,
 * which rebuilt the fold artifacts and loaded a new worker session, and Reset,
 * which rewound the session in hand — and the split was the bug: users pressed
 * whichever, and a rebuild came back on the worker's default camera and
 * colours. Now one verb chooses: rewind while the session is healthy, rebuild
 * when it is not.
 */
describe('SimulatorPanel restart', () => {
  function restartButton(rendered: HTMLElement): HTMLButtonElement {
    const button = rendered.querySelector<HTMLButtonElement>('[aria-label="Restart"]');
    expect(button).not.toBeNull();
    return button as HTMLButtonElement;
  }

  it('rewinds a healthy simulation in place', async () => {
    const refreshFoldArtifacts = vi.fn(async () => null);
    const rendered = renderPanel({ foldArtifacts: { fold: simpleFold() }, refreshFoldArtifacts });
    await flushSimulator();

    act(() => pressKey('ArrowRight', { metaKey: true }));
    expect(rendered.querySelector('output')?.textContent).toBe('100%');

    const restart = restartButton(rendered);
    expect(restart.disabled).toBe(false);
    act(() => restart.click());
    expect(rendered.querySelector('output')?.textContent).toBe('0%');
    // The session is kept — its camera and colours with it — not rebuilt.
    expect(refreshFoldArtifacts).not.toHaveBeenCalled();
    await flushSimulator();
  });

  it('puts the view back, where the Cmd+Arrow jumps leave it alone', async () => {
    // jsdom has no pointer capture; the orbit gesture asks for it on the canvas.
    const element = HTMLElement.prototype as unknown as Record<string, unknown>;
    element.setPointerCapture = () => {};
    element.hasPointerCapture = () => false;
    element.releasePointerCapture = () => {};
    try {
      const rendered = renderPanel({ foldArtifacts: { fold: simpleFold() } });
      await flushSimulator();
      // The view cube is turned by the camera, so its transform is the camera as
      // far as the DOM can see it.
      const cube = () =>
        rendered.querySelector<HTMLElement>('.simulator-view-cube__scene')?.style.transform;
      const opening = cube();
      expect(opening).toMatch(/^matrix3d\(/);

      const canvas = rendered.querySelector('canvas');
      expect(canvas).not.toBeNull();
      const send = (type: string, x: number) =>
        act(() => {
          canvas?.dispatchEvent(
            new PointerEvent(type, { pointerId: 1, clientX: x, clientY: 80, bubbles: true })
          );
        });
      send('pointerdown', 100);
      send('pointermove', 160);
      send('pointerup', 160);
      const orbited = cube();
      expect(orbited).not.toBe(opening);

      // Either end of the fold, camera untouched.
      act(() => pressKey('ArrowRight', { metaKey: true }));
      expect(rendered.querySelector('output')?.textContent).toBe('100%');
      expect(cube()).toBe(orbited);
      act(() => pressKey('ArrowLeft', { metaKey: true }));
      expect(rendered.querySelector('output')?.textContent).toBe('0%');
      expect(cube()).toBe(orbited);

      // Restart is the one that starts the *view* over too.
      act(() => pressKey('r'));
      expect(rendered.querySelector('output')?.textContent).toBe('0%');
      expect(cube()).toBe(opening);
      await flushSimulator();
    } finally {
      delete element.setPointerCapture;
      delete element.hasPointerCapture;
      delete element.releasePointerCapture;
    }
  });

  it('rebuilds a simulation the engine could not produce', async () => {
    const refreshFoldArtifacts = vi.fn(async () => null);
    const rendered = renderPanel({
      foldArtifacts: null,
      foldArtifactStatus: 'error',
      foldArtifactError: 'the engine could not fold this',
      refreshFoldArtifacts,
    });
    await flushSimulator();

    expect(rendered.textContent).toContain('the engine could not fold this');
    // Nothing to play, but something to start over: the rebuild is the only
    // way back from here, and it must not need a second button.
    expect(rendered.querySelector<HTMLButtonElement>('[aria-label="Play"]')?.disabled).toBe(true);
    const restart = restartButton(rendered);
    expect(restart.disabled).toBe(false);
    act(() => restart.click());
    expect(refreshFoldArtifacts).toHaveBeenCalledTimes(1);
  });

  it('offers nothing to restart while a rebuild is in flight', async () => {
    const rendered = renderPanel({ foldArtifacts: null, foldArtifactStatus: 'loading' });
    await flushSimulator();

    expect(restartButton(rendered).disabled).toBe(true);
  });
});

/**
 * Drive a chord through the real shortcut dispatcher.
 *
 * The panel no longer owns a `window` keydown listener — its bindings are
 * registered with the dispatcher, which the app shell installs on `document` in
 * the capture phase and which this unit test does not mount. Going through
 * `handleShortcutRuntimeKeyDown` exercises the registration and the scope stack,
 * which is the part that can actually regress.
 */
function pressKey(key: string, init: KeyboardEventInit = {}): void {
  handleShortcutRuntimeKeyDown(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    {
      context: { activeEditingContext: 'crease-pattern' },
      menu: () => {},
    }
  );
}

function renderPanel(state: Partial<ReturnType<typeof useWorkspaceStore.getState>>) {
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      ...singleTreemakerDesignTab({ project: createSampleProject() }),
      status: 'crease_pattern_ready',
      engineReady: true,
      ...state,
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

function simpleFold(
  assignments: FoldDocument['edges_assignment'] = ['B', 'B', 'B', 'B', 'V'],
  foldAngles: FoldDocument['edges_foldAngle'] = [null, null, null, null, 180]
): FoldDocument {
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
    edges_assignment: assignments,
    edges_foldAngle: foldAngles,
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  };
}

/** Two disjoint unit squares, each split by one diagonal: two patterns. */
function twoSquaresFold(): FoldDocument {
  return {
    file_spec: 1.2,
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [2, 0],
      [3, 0],
      [3, 1],
      [2, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 2],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [4, 6],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'V', 'B', 'B', 'B', 'B', 'M'],
    edges_foldAngle: [null, null, null, null, 180, null, null, null, null, -180],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
      [4, 5, 6],
      [4, 6, 7],
    ],
  };
}

function quadFold(): FoldDocument {
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
    ],
    edges_assignment: ['B', 'B', 'B', 'B'],
    edges_foldAngle: [null, null, null, null],
    faces_vertices: [[0, 1, 2, 3]],
  };
}

function mockCanvasContext(): CanvasRenderingContext2D {
  const imageData = {
    data: new Uint8ClampedArray(420 * 360 * 4),
    width: 420,
    height: 360,
    colorSpace: 'srgb',
  } as ImageData;
  putImageDataMock = vi.fn();
  fillMock = vi.fn();
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: fillMock,
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    getImageData: vi.fn(() => imageData),
    putImageData: putImageDataMock,
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
