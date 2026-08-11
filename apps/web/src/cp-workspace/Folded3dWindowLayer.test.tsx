import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Profiler, act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrbitView } from '@treemaker/origami-simulator';
import type {
  OristudioCpFolded3dRenderModel,
  OristudioCpFolded3dSnapshot,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
} from '../engine/oristudioCpTypes';
import { cpOverlayViewStore } from './cpOverlayViewStore';
import { overlayModelToCss } from './annotations/annotationTransform';
import { foldedFigureBox } from './adapters/cpFoldedToScene';
import type { CpOverlayView } from './CreasePatternWebglCanvas';
import { Folded3dWindowLayer } from './Folded3dWindowLayer';
import { defaultFolded3dCamera, folded3dFrameRadius } from './folded/foldedFigure3dProjection';
import { project3dRenderSnapshot } from './folded/folded3dReproject';
import { resetFolded3dRenderModels, setFolded3dRenderModel } from './folded/folded3dRenderModels';
import { clearAllFolded3dOrbits, publishFolded3dOrbit } from './folded/folded3dRuntime';

/**
 * The window layer, as a DOM surface.
 *
 * Two things are asserted here that nothing else can assert, and both are bugs
 * this repo has already paid for once:
 *
 * 1. **A camera frame writes no layout-affecting property.** At twenty windows
 *    that was *the* bottleneck — no thread saturated, 206 frames dropped —
 *    because a layout write woke every canvas's `ResizeObserver`, which asked
 *    for a fresh render, at 640 bitmaps a second. A transform provably does not
 *    change the layout box; `width`/`height`/`left`/`top` provably do.
 * 2. **The figure is placed through SVG *user* space, not model space.** Both
 *    are `CpOverlayView`, so reading the wrong one type-checks cleanly and puts
 *    every figure hundreds of units from where it belongs.
 *
 * The worker runtime is stubbed. What is under test is the DOM the layer
 * produces, and reaching a real worker from jsdom would only add a Worker
 * polyfill between the assertion and the thing it asserts.
 */

const meshCameras = vi.hoisted(() => [] as OrbitView[]);

vi.mock('./folded/useFolded3dMeshRuntime', () => ({
  useFolded3dMeshRuntime: () => ({
    status: 'ready' as const,
    shallowDepthBuffer: false,
    setCamera: (view: OrbitView) => {
      meshCameras.push(view);
    },
    setRenderSettings: () => {},
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'folded', '__fixtures__');
const RENDER_MODEL: OristudioCpFolded3dRenderModel = JSON.parse(
  readFileSync(join(FIXTURES, 'hinge_90.rendermodel.json'), 'utf8')
);

const HANDLE = 21;

const MODEL: OristudioCpFoldedFigureModel = {
  front_color: { red: 255, green: 255, blue: 100 },
  back_color: { red: 60, green: 60, blue: 200 },
  line_color: { red: 0, green: 0, blue: 0 },
  scale: 1,
  rotation: 0,
  anti_alias: true,
  display_shadows: false,
  state: 'Front0',
  folded_cases: 1,
  transparent_transparency: 16,
  transparency_color: false,
};

const FOLDED_3D = {
  model: MODEL,
  diagnostics: {
    tolerances: {
      angle_radians: 1e-7,
      distance_relative: 1e-6,
      flat_snap_degrees: 1e-6,
      overlap_area_relative: 1e-9,
    },
  },
} as unknown as OristudioCpFolded3dSnapshot;

const CAMERA = defaultFolded3dCamera(RENDER_MODEL, MODEL.state);

function figure(): OristudioCpFoldedFigureEntry {
  return {
    id: 'folded-1',
    title: 'Folded model 1',
    handle: HANDLE,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: null,
    folded3d: FOLDED_3D,
    renderSnapshot: project3dRenderSnapshot(RENDER_MODEL, FOLDED_3D, 'Paper5', CAMERA),
    camera: CAMERA,
    frameRadius: folded3dFrameRadius(RENDER_MODEL),
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    error: null,
  } as unknown as OristudioCpFoldedFigureEntry;
}

/** A camera at `scale` CSS px per user unit, with the origin at `origin`. */
function view(scale: number, origin: [number, number] = [0, 0]): CpOverlayView {
  return { origin, ex: [scale, 0], ey: [0, scale] } as unknown as CpOverlayView;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  meshCameras.length = 0;
  commits = 0;
  resetFolded3dRenderModels();
  clearAllFolded3dOrbits();
  setFolded3dRenderModel(HANDLE, RENDER_MODEL);
  cpOverlayViewStore.set({ model: view(1), user: view(1) });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetFolded3dRenderModels();
  clearAllFolded3dOrbits();
});

/**
 * React commits of the layer's subtree. Zero means React did not run: nothing
 * re-rendered, nothing was reconciled, no DOM was touched.
 */
let commits = 0;

/** Counts commits of whatever it wraps. */
function Profiled({ children }: { children: ReactNode }) {
  return (
    <Profiler
      id="folded-window-layer"
      onRender={() => {
        commits += 1;
      }}
    >
      {children}
    </Profiler>
  );
}

function render(): void {
  act(() => {
    root.render(
      <Profiled>
        <Folded3dWindowLayer figures={[figure()]} focusedId={null} staleIds={new Set()} />
      </Profiled>
    );
  });
}

function windowEl(): HTMLElement {
  const element = container.querySelector<HTMLElement>('.cp-folded-figure-window');
  if (!element) throw new Error('no window rendered');
  return element;
}

/** Every property that reaches layout, as the element currently declares it. */
function layoutProperties(element: HTMLElement): Record<string, string> {
  return {
    width: element.style.width,
    height: element.style.height,
    left: element.style.left,
    top: element.style.top,
    margin: element.style.margin,
    padding: element.style.padding,
    inset: element.style.inset,
  };
}

describe('placing a folded figure window', () => {
  it('renders one window per figure', () => {
    render();
    expect(container.querySelectorAll('.cp-folded-figure-window')).toHaveLength(1);
  });

  it('moves a camera frame entirely through the transform', () => {
    // The measured failure: writing left/top/width/height per frame relaid out
    // the layer, and a canvas whose box changes wakes its ResizeObserver and
    // re-renders. This is the assertion that stops that coming back.
    render();
    const before = layoutProperties(windowEl());
    const beforeTransform = windowEl().style.transform;

    act(() => cpOverlayViewStore.set({ model: view(1, [37, -12]), user: view(1, [37, -12]) }));

    expect(layoutProperties(windowEl())).toEqual(before);
    expect(windowEl().style.transform).not.toBe(beforeTransform);
  });

  it('zooms through the transform too, until the camera settles', () => {
    // A zoom is the case where holding the layout box still costs sharpness, and
    // where it was tempting to resize instead. It re-renders on settle; during
    // the gesture it is a scale.
    render();
    const before = layoutProperties(windowEl());
    const beforeTransform = windowEl().style.transform;

    act(() => cpOverlayViewStore.set({ model: view(1.4), user: view(1.4) }));

    expect(layoutProperties(windowEl())).toEqual(before);
    expect(windowEl().style.transform).not.toBe(beforeTransform);
    expect(windowEl().style.transform).toContain('scale(1.4)');
  });

  it('places the figure through user space, not model space', () => {
    // The two spaces differ by a constant affine, so the wrong one type-checks
    // and lands the figure hundreds of units away. Pinned by making the two
    // views disagree and computing where each one would put the box.
    const userView = view(2, [40, 80]);
    const modelView = view(1, [1000, 1000]);
    act(() => cpOverlayViewStore.set({ model: modelView, user: userView }));
    render();

    const box = foldedFigureBox(figure());
    if (!box) throw new Error('the fixture figure has no box');
    const inUser = overlayModelToCss(userView, box.center);
    const inModel = overlayModelToCss(modelView, box.center);
    // Non-vacuous only if the two answers differ.
    expect(inUser).not.toEqual(inModel);
    expect(windowEl().style.transform).toContain(`translate(${inUser.x}px, ${inUser.y}px)`);
  });

  it('sizes the window from the figure’s frame, not from its projection', () => {
    // A frame is `2 · frameRadius` of user units across, and it does not change
    // when the model turns — which is what makes it a window rather than a
    // bounding box that jumps.
    render();
    const width = Number.parseFloat(windowEl().style.width);
    expect(width).toBeGreaterThan(0);
    expect(windowEl().style.height).toBe(windowEl().style.width);
  });

  it('takes no pointer events, so the overlay and the canvas still get theirs', () => {
    // Selection, move and resize belong to the shared overlay above; the orbit
    // gesture still belongs to the crease-pattern canvas below. A window that
    // took presses would take them from both.
    render();
    expect(windowEl().style.pointerEvents).toBe('none');
  });

  it('clips its canvas with a camera-dependent corner radius', () => {
    render();
    expect(windowEl().style.borderRadius).not.toBe('');
    expect(container.querySelector('.cp-folded-figure-window__canvas')).not.toBeNull();
  });

  it('marks a stale figure so the stylesheet can fade it', () => {
    act(() => {
      root.render(
        <Folded3dWindowLayer
          figures={[figure()]}
          focusedId="folded-1"
          staleIds={new Set(['folded-1'])}
        />
      );
    });
    expect(windowEl().dataset.stale).toBe('true');
    expect(windowEl().dataset.focused).toBe('true');
  });
});

/**
 * Turning a figure is a uniform and a draw. Nothing about the page changes, so
 * nothing about the page should be recomputed — not this layer, not the windows
 * beside the one being turned, and not the DOM.
 *
 * The counter is React's own `Profiler`, which is called once per commit of the
 * subtree: zero calls means React never ran.
 */
describe('turning a folded figure', () => {
  it('reaches the mesh camera without a single React commit', () => {
    render();
    const pushed = meshCameras.length;
    commits = 0;

    act(() => {
      publishFolded3dOrbit('folded-1', {
        camera: { yaw: 1.25, pitch: -0.5, zoom: 1 },
        snapshot: null,
      });
    });

    expect(commits).toBe(0);
    expect(meshCameras.length).toBe(pushed + 1);
    const latest = meshCameras.at(-1);
    expect(latest?.yaw).toBe(1.25);
    expect(latest?.pitch).toBe(-0.5);
  });

  it('leaves the window’s DOM byte-identical while it turns', () => {
    render();
    const layout = layoutProperties(windowEl());
    const transform = windowEl().style.transform;
    const radius = windowEl().style.borderRadius;

    act(() => {
      publishFolded3dOrbit('folded-1', {
        camera: { yaw: 2.5, pitch: 0.25, zoom: 1 },
        snapshot: null,
      });
    });

    expect(layoutProperties(windowEl())).toEqual(layout);
    expect(windowEl().style.transform).toBe(transform);
    expect(windowEl().style.borderRadius).toBe(radius);
  });

  it('counts a camera move of the crease pattern, so the counter is not asleep', () => {
    // Non-vacuity for the two above: the Profiler does fire for a change that
    // genuinely has to re-render, and a turn is not one of those.
    render();
    commits = 0;
    act(() => cpOverlayViewStore.set({ model: view(1, [9, 4]), user: view(1, [9, 4]) }));
    expect(commits).toBeGreaterThan(0);
  });

  it('sends a turn only to the figure being turned', () => {
    const second: OristudioCpFoldedFigureEntry = { ...figure(), id: 'folded-2' };
    act(() => {
      root.render(
        <Profiled>
          <Folded3dWindowLayer
            figures={[figure(), second]}
            focusedId={null}
            staleIds={new Set()}
          />
        </Profiled>
      );
    });
    meshCameras.length = 0;

    act(() => {
      publishFolded3dOrbit('folded-2', {
        camera: { yaw: 0.75, pitch: 0.1, zoom: 1 },
        snapshot: null,
      });
    });

    expect(meshCameras).toHaveLength(1);
    expect(meshCameras[0]?.yaw).toBe(0.75);
  });

  /**
   * The whole of Phase 4's cost model, as one assertion.
   *
   * A turn costs one worker message and nothing else, at any number of open
   * figures — so the main thread's per-frame budget does not depend on how many
   * figures the document holds. Delivering the camera as React state instead
   * cost one commit of the layer plus one of every window, which is the shape
   * that puts a document of thirty figures over budget while a document of one
   * looks fine.
   */
  it('costs the same to turn a figure at 1, 10 and 30 of them', () => {
    for (const count of [1, 10, 30]) {
      const many = Array.from({ length: count }, (_, index) => ({
        ...figure(),
        id: `folded-${index + 1}`,
      }));
      act(() => {
        root.render(
          <Profiled>
            <Folded3dWindowLayer figures={many} focusedId={null} staleIds={new Set()} />
          </Profiled>
        );
      });
      expect(container.querySelectorAll('.cp-folded-figure-window')).toHaveLength(count);

      meshCameras.length = 0;
      commits = 0;
      const layout = layoutProperties(windowEl());

      act(() => {
        for (let step = 1; step <= 20; step += 1) {
          publishFolded3dOrbit('folded-1', {
            camera: { yaw: step * 0.02, pitch: -0.4, zoom: 1 },
            snapshot: null,
          });
        }
      });

      expect({ count, commits, pushes: meshCameras.length }).toEqual({
        count,
        commits: 0,
        pushes: 20,
      });
      expect(layoutProperties(windowEl())).toEqual(layout);
    }
  });
});
