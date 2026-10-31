import { endOpenCanvasSessions } from '../../cp-workspace/canvasObjects/canvasSessions';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { ConnectedSpread } from '@oristudio/layer-spread';
import { layerSpreadControls } from '../../cp-workspace/folded/layerSpreadControls';
import { DEFAULT_CONNECTED_SPREAD, withSpreadField } from '../../cp-workspace/folded/layerSpreadSettings';
import { LayerSpreadRows } from './LayerSpreadRows';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const preview = vi.fn(), commit = vi.fn(), choose = vi.fn();
let disabled = false;
function Harness() {
  const [spread, setSpread] = useState<ConnectedSpread>(DEFAULT_CONNECTED_SPREAD);
  const controls = layerSpreadControls(spread, { t, busy: false, hint: disabled ? 'Read-only' : undefined, kind: choose, direction: vi.fn(), keep: vi.fn() });
  return <LayerSpreadRows toggle={{ pressed: true, disabled, run: vi.fn() }} spread={{ ...controls,
    start: () => !disabled, commit, preview: vi.fn(),
    previewReveal: (reveal) => {
      preview(reveal);
      setSpread((old) => withSpreadField(old, { verb: 'spread-reveal', reveal }) as ConnectedSpread);
    },
  }} />;
}
const pad = () => host.querySelector<HTMLButtonElement>('[role="slider"]')!;
function pointer(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => pad().dispatchEvent(event));
}
beforeEach(async () => {
  disabled = false; preview.mockClear(); commit.mockClear(); choose.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
  pad().setPointerCapture = vi.fn();
  pad().getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('offers Default, Affine and Depth even after Default is selected', () => {
  const group = host.querySelector('[role="group"][aria-label="Spread by"]')!;
  expect([...group.querySelectorAll('button')].map(b => [b.textContent, b.getAttribute('aria-pressed')]))
    .toEqual([['Default', 'true'], ['Affine', 'false'], ['Depth', 'false']]);
  act(() => (group.querySelectorAll('button')[1] as HTMLButtonElement).click());
  expect(choose).toHaveBeenCalledWith('affine');
  expect(host.textContent).not.toContain('Use new spread');
  expect(host.textContent).not.toContain('Reveal horizontally');
});

it('clicks and drags both coordinates, caps the rim, and commits only on release', () => {
  pointer('pointerdown', 92, 50);
  expect(preview).toHaveBeenLastCalledWith([2, 0]);
  pointer('pointermove', 50, 8);
  expect(preview).toHaveBeenLastCalledWith([0, -2]);
  pointer('pointermove', 50, 50);
  expect(preview).toHaveBeenLastCalledWith([0, -0.1]);
  expect(commit).not.toHaveBeenCalled();
  pointer('pointerup', 50, 50);
  pointer('lostpointercapture', 50, 50);
  expect(commit).toHaveBeenCalledTimes(1);
});

it('supports arrow keys and reset without reaching zero', () => {
  act(() => pad().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, shiftKey: true })));
  expect(preview).toHaveBeenLastCalledWith([1, 0.6]);
  expect(commit).toHaveBeenCalledTimes(1);
  act(() => pad().dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
  expect(preview).toHaveBeenLastCalledWith([0.8, 0.6]);
});

it('keeps read-only gestures inert', async () => {
  disabled = true;
  await act(async () => root.render(<Harness />));
  expect(pad().disabled).toBe(true);
  pointer('pointerdown', 92, 50);
  pointer('pointermove', 50, 8);
  pointer('pointerup', 50, 8);
  expect(preview).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});


it('does not recommit a held pointer after Undo or replacing the document', () => {
  pointer('pointerdown', 92, 50);
  const previews = preview.mock.calls.length;
  act(() => endOpenCanvasSessions('history'));
  pointer('pointermove', 50, 8);
  pointer('pointerup', 50, 8);
  expect(preview).toHaveBeenCalledTimes(previews);
  expect(commit).not.toHaveBeenCalled();
});
