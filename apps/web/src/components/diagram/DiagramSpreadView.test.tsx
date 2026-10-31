import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CONNECTED_SPREAD } from '../../cp-workspace/folded/layerSpreadSettings';
import { DEFAULT_DIAGRAM_STYLE } from '../../diagram/document/diagramDocument';
import type { ConnectedSpreadView } from '../../layer-spread/view';
import { DiagramSpreadView } from './DiagramSpreadView';

const renderer = vi.hoisted(() => ({ status: 'ready' as const, request: vi.fn() }));
vi.mock('../../layer-spread/useSpreadRenderer', () => ({ useSpreadRenderer: () => renderer }));
let viewport: ComponentProps<typeof import('../../simulator/SimulatorViewport').SimulatorViewport>;
vi.mock('../../simulator/SimulatorViewport', () => ({
  SimulatorViewport: (props: typeof viewport) => {
    viewport = props;
    return <canvas aria-label={props.ariaLabel} className={props.className} />;
  },
}));
const decodes: { src: string; finish: () => void; fail: () => void }[] = [];
class MockImage {
  src = '';
  decode() {
    return new Promise<void>((resolve, reject) => decodes.push({ src: this.src, finish: resolve, fail: reject }));
  }
}
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let props: ComponentProps<typeof DiagramSpreadView>;
const final = () => host.querySelector<HTMLImageElement>('[data-pose-final-picture]');
async function show(patch: Partial<typeof props> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(<DiagramSpreadView {...props} />));
}
const rest = () => act(async () => { await vi.advanceTimersByTimeAsync(450); });
const decode = (index = decodes.length - 1) => act(async () => decodes[index]!.finish());
function pointer(type: string, id = 1) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: id });
  act(() => host.querySelector('canvas')!.dispatchEvent(event));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Image', MockImage);
  decodes.length = 0;
  host = document.createElement('div');
  root = createRoot(host);
  props = {
    view: {} as ConnectedSpreadView,
    spread: DEFAULT_CONNECTED_SPREAD,
    capturedSpread: DEFAULT_CONNECTED_SPREAD,
    picture: { url: 'final-1.svg', scene: null },
    rotationDeg: 0,
    style: DEFAULT_DIAGRAM_STYLE,
    onCamera: vi.fn(), onReveal: vi.fn(), fallback: <img src="fallback.svg" alt="" />,
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('uses the captured artwork only once idle and decoded, keeping the live canvas mounted', async () => {
  await show();
  const canvas = host.querySelector('canvas');
  await rest();
  expect(final()).toBeNull();
  await decode();
  expect(final()?.getAttribute('src')).toBe(props.picture.url);
  expect(host.querySelector('canvas')).toBe(canvas);
  pointer('pointerdown');
  expect(final()).toBeNull();
  await rest();
  expect(final()).toBeNull(); // Resting with a pointer held is still a gesture.
  pointer('pointerup');
  await rest();
  expect(final()).not.toBeNull();
});

it('keeps previews live until the saved spread catches up, with no new solve or capture', async () => {
  await show();
  await decode();
  await rest();
  const spread = { ...DEFAULT_CONNECTED_SPREAD, amount: 0.9 };
  await show({ spread });
  expect(final()).toBeNull();
  await rest();
  expect(final()).toBeNull();
  await show({ capturedSpread: spread, picture: { url: 'final-2.svg', scene: null } });
  await decode();
  expect(final()?.getAttribute('src')).toBe('final-2.svg');
  expect(renderer.request.mock.lastCall![0].spread).toEqual(spread);
});

it('never covers a newer orbit with an older picture or late image decode', async () => {
  const camera = { yaw: 0, pitch: 0, zoom: 1 };
  await show({ presentation: { kind: 'perspective', camera, orderSide: 'front' } });
  const late = decodes[0]!;
  await act(async () => viewport.pushCamera({ ...camera, yaw: 0.3 }, 800, 600));
  await rest();
  await act(async () => late.finish());
  expect(final()).toBeNull();
  expect(props.onCamera).toHaveBeenLastCalledWith({ ...camera, yaw: 0.3 });
  await act(async () => viewport.pushCamera({ ...camera, yaw: 0.3 }, 900, 650));
  expect(props.onCamera).toHaveBeenCalledTimes(1); // Resize is not another orbit.
  await show({ presentation: { kind: 'perspective', camera: { ...camera, yaw: 0.3 }, orderSide: 'front' }, picture: { url: 'final-2.svg', scene: null } });
  await decode();
  await rest();
  expect(final()?.getAttribute('src')).toBe('final-2.svg');
  await act(async () => viewport.pushCamera({ ...camera, yaw: 0.4 }, 800, 600));
  expect(final()).toBeNull();
});

it('keeps the live view on a decode failure and restores a loaded image after wheel input', async () => {
  await show();
  await act(async () => decodes[0]!.fail());
  await rest();
  expect(final()).toBeNull();
  await show({ picture: { url: 'final-2.svg', scene: null } });
  await decode();
  expect(final()).not.toBeNull();
  act(() => host.querySelector('canvas')!.dispatchEvent(new Event('wheel', { bubbles: true })));
  expect(final()).toBeNull();
  await rest();
  expect(final()).not.toBeNull();
});
