import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { multiplyMat3, transposeMat3 } from '@treemaker/origami-simulator';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramPoseCameraSpreadView } from './DiagramPoseCameraSpreadView';
import { cameraSpreadInitialView, cameraSpreadViewFrame } from '../../cp-workspace/folded/cameraSpreadView';
import type { CameraLayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import type { FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import type { CameraSpreadHold } from '../../diagram/capture/captureSession';
import { DEFAULT_DIAGRAM_STYLE } from '../../diagram/document/diagramDocument';
import type { UprightViewHandle } from '../../viewport3d/viewport3dHandle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const runtime = vi.hoisted(() => ({
  status: 'ready',
  error: null,
  draw: vi.fn(),
  retry: vi.fn(),
}));
vi.mock('../../cp-workspace/folded/useCameraSpreadRuntime', () => ({
  useCameraSpreadRuntime: () => runtime,
}));
let host: HTMLDivElement;
let root: Root;
let live: UprightViewHandle | undefined;
const register = (view: UprightViewHandle) => {
  live = view;
  return () => {
    live = undefined;
  };
};
const onCamera = vi.fn<(camera: FoldedFigureCamera) => void>();
const view = { scene: {} } as CameraSpreadHold;
const initial: CameraLayerSpreadOptions = {
  kind: 'camera',
  amount: 0.06,
  projection: 'perspective',
  directionDeg: 247,
  inclinationDeg: 45,
  camera: {
    ...cameraSpreadInitialView({ directionDeg: 247, inclinationDeg: 45 }),
    pan: [0.1, -0.2],
    zoom: 1.4,
  },
};
function mount(spread = initial, rotationDeg = 315, stored = true, fallback = false) {
  act(() =>
    root.render(
      <TooltipProvider>
        <DiagramPoseCameraSpreadView
          view={view}
          spread={spread}
          rotationDeg={rotationDeg}
          style={DEFAULT_DIAGRAM_STYLE}
          onCamera={onCamera}
          registerLiveView={register}
          ghost={null}
          fallback={fallback ? <div data-test-picture="">Saved vector</div> : null}
          stored={stored}
        />
      </TooltipProvider>
    )
  );
}
function shownFrame(camera: FoldedFigureCamera, degrees: number) {
  const angle = (degrees * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  return multiplyMat3([c, -s, 0, s, c, 0, 0, 0, 1], cameraSpreadViewFrame(camera));
}
function pointer(type: string, x: number, y: number) {
  act(() =>
    host.querySelector('canvas')!.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        button: 0,
        clientX: x,
        clientY: y,
        bubbles: true,
      })
    )
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  runtime.status = 'ready';
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 300,
  } as DOMRect);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.releasePointerCapture = () => {};
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('sets upright in the displayed page frame and retains it through a saved camera and orbit', () => {
  mount();
  const before = shownFrame(initial.camera, 315);
  act(() => live!.setUpright());
  const saved = onCamera.mock.lastCall![0];
  shownFrame(saved, 315).forEach((v, i) => expect(v).toBeCloseTo(before[i]!, 12));
  expect(saved.pan).toEqual(initial.camera.pan);
  expect(saved.zoom).toBe(initial.camera.zoom);
  mount({ ...initial, camera: saved });
  pointer('pointerdown', 10, 20);
  pointer('pointermove', 60, 20);
  pointer('pointerup', 60, 20);
  const after = shownFrame(onCamera.mock.lastCall![0], 315);
  const delta = multiplyMat3(after, transposeMat3(before));
  expect(delta[1]).toBeCloseTo(0, 12);
  expect(delta[4]).toBeCloseTo(1, 12);
  expect(delta[7]).toBeCloseTo(0, 12);
  // Undo and a new independent page rotation must replace the live gesture frame.
  mount(initial, 90);
  shownFrame(onCamera.mock.lastCall![0], 90).forEach((v, i) =>
    expect(v).toBeCloseTo(shownFrame(initial.camera, 90)[i]!, 12)
  );
});


it('keeps the Pages vector visible while preparing and at rest, but not over a changed preview', () => {
  runtime.status = 'loading';
  mount(initial, 315, true, true);
  expect(host.querySelector('[data-test-picture]')).not.toBeNull();
  expect(host.querySelector('canvas')?.hasAttribute('data-bitmap-hidden')).toBe(true);
  runtime.status = 'ready';
  mount(initial, 315, true, true);
  expect(host.querySelector('[data-test-picture]')).not.toBeNull();
  pointer('pointerdown', 10, 20);
  pointer('pointermove', 60, 20);
  pointer('pointerup', 60, 20);
  expect(host.querySelector('[data-test-picture]')).toBeNull();
  expect(host.querySelector('canvas')?.hasAttribute('data-bitmap-hidden')).toBe(false);
  const saved = onCamera.mock.lastCall![0];
  mount({ ...initial, camera: saved }, 315, true, true);
  expect(host.querySelector('[data-test-picture]')).not.toBeNull();
  mount({ ...initial, camera: saved, amount: 0.2 }, 315, false, true);
  expect(host.querySelector('[data-test-picture]')).toBeNull();
});
