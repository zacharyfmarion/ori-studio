import { endOpenCanvasSessions } from '../../cp-workspace/canvasObjects/canvasSessions';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { layerSpreadControls } from '../../cp-workspace/folded/layerSpreadControls';
import { DEFAULT_CONNECTED_SPREAD, withSpreadField } from '../../cp-workspace/folded/layerSpreadSettings';
import { LayerSpreadRows } from './LayerSpreadRows';
import { TooltipProvider } from '../ui/Tooltip';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const preview = vi.fn(), amountPreview = vi.fn(), commit = vi.fn(), choose = vi.fn();
let disabled = false;
function Harness({ initial = DEFAULT_CONNECTED_SPREAD }: { initial?: LayerSpreadOptions }) {
  const [spread, setSpread] = useState<LayerSpreadOptions>(initial);
  const controls = layerSpreadControls(spread, { t, busy: false, hint: disabled ? 'Read-only' : undefined, kind: choose, direction: vi.fn(), keep: vi.fn() });
  return <TooltipProvider><LayerSpreadRows toggle={{ pressed: true, disabled, run: vi.fn() }} spread={{ ...controls,
    start: () => !disabled, commit,
    preview: (field, value) => {
      amountPreview(field, value);
      if (field === 'amount') setSpread((old) => withSpreadField(old, { verb: 'spread-amount', kind: old.kind, amount: value }));
    },
    previewReveal: (reveal) => {
      preview(reveal);
      setSpread((old) => withSpreadField(old, { verb: 'spread-reveal', reveal }));
    },
  }} /></TooltipProvider>;
}
const pad = () => host.querySelector<HTMLButtonElement>('[role="slider"]')!;
function pointer(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => pad().dispatchEvent(event));
}
beforeEach(async () => {
  disabled = false; preview.mockClear(); amountPreview.mockClear(); commit.mockClear(); choose.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
  pad().setPointerCapture = vi.fn();
  pad().getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('shows Default amount as 0–100%, preserving the full height range and resetting to 25%', () => {
  const amount = host.querySelector<HTMLInputElement>('input[aria-label="Spread amount"]')!;
  expect([amount.min, amount.max, amount.value, amount.getAttribute('aria-valuetext')]).toEqual(['0', '100', '25', '25%']);
  for (const [percent, multiplier] of [[100, 2], [0, 0]]) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(amount, String(percent));
      amount.dispatchEvent(new Event('input', { bubbles: true }));
      amount.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(amountPreview).toHaveBeenLastCalledWith('amount', multiplier);
  }
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Reset Amount to default"]')!.click());
  expect(amountPreview).toHaveBeenLastCalledWith('amount', 0.5);
  expect(amount.value).toBe('25');
});

it.each<{ initial: LayerSpreadOptions; shown: string; max: string }>([
  { initial: { ...DEFAULT_CONNECTED_SPREAD, amount: 1.03 }, shown: '51.5', max: '100' },
  { initial: { kind: 'depth', amount: 0.025, toward: 'down' }, shown: '2.5', max: '20' },
  { initial: { kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 81 }, shown: '3', max: '25' },
])('displays saved $initial.kind amounts without rewriting them', async ({ initial, shown, max }) => {
  await act(async () => root.render(<Harness key="saved" initial={initial} />));
  const amount = host.querySelector<HTMLInputElement>('input[aria-label="Spread amount"]')!;
  expect([amount.value, amount.max]).toEqual([shown, max]);
  expect(amountPreview).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

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
