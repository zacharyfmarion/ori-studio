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
function Harness({ initial = DEFAULT_CONNECTED_SPREAD, busy = false, kindLayout, valuesHeld }: { initial?: LayerSpreadOptions; busy?: boolean; kindLayout?: 'row' | 'stacked'; valuesHeld?: string }) {
  const [spread, setSpread] = useState<LayerSpreadOptions>(initial);
  const controls = layerSpreadControls(spread, { t, busy, hint: disabled ? 'Read-only' : undefined, kind: choose, direction: vi.fn(), keep: vi.fn() });
  return <TooltipProvider><LayerSpreadRows kindLayout={kindLayout} toggle={{ pressed: true, disabled, run: vi.fn(), ...(valuesHeld ? { note: valuesHeld } : {}) }} spread={{ ...controls,
    ...(valuesHeld ? { valuesHeld } : {}),
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

it('shows Default amount as 0–100%, preserving the full height range and resetting to 7%', () => {
  const amount = host.querySelector<HTMLInputElement>('input[aria-label="Spread amount"]')!;
  expect([amount.min, amount.max, amount.getAttribute('aria-valuetext')]).toEqual(['0', '100', '7%']);
  expect(amount.valueAsNumber).toBeCloseTo(7);
  for (const [percent, multiplier] of [[100, 2], [0, 0]]) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(amount, String(percent));
      amount.dispatchEvent(new Event('input', { bubbles: true }));
      amount.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(amountPreview).toHaveBeenLastCalledWith('amount', multiplier);
  }
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Reset Amount to default"]')!.click());
  expect(amountPreview).toHaveBeenLastCalledWith('amount', 0.14);
  expect(amount.valueAsNumber).toBeCloseTo(7);
  expect(amount.getAttribute('aria-valuetext')).toBe('7%');
});

// Shown at the nearest whole percent, and left as saved until the slider moves.
it.each<{ initial: LayerSpreadOptions; shown: string; max: string }>([
  { initial: { ...DEFAULT_CONNECTED_SPREAD, amount: 1.03 }, shown: '52', max: '100' },
  { initial: { kind: 'depth', amount: 0.025, toward: 'down' }, shown: '3', max: '20' },
  { initial: { kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 81 }, shown: '3', max: '25' },
])('displays saved $initial.kind amounts without rewriting them', async ({ initial, shown, max }) => {
  await act(async () => root.render(<Harness key="saved" initial={initial} />));
  const amount = host.querySelector<HTMLInputElement>('input[aria-label="Spread amount"]')!;
  expect([amount.value, amount.max]).toEqual([shown, max]);
  expect(amountPreview).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it('holds a Default spread’s own values, never its kind, while its layers can’t be spread', async () => {
  const failed = 'These layers couldn’t be spread';
  await act(async () => root.render(<Harness key="failed" valuesHeld={failed} />));
  // Said under Spread layers, and on the values it holds.
  expect(host.textContent).toContain(failed);
  const amount = host.querySelector<HTMLInputElement>('input[aria-label="Spread amount"]')!;
  expect(amount.disabled).toBe(true);
  expect(pad().disabled).toBe(true);
  expect(pad().title).toBe(failed);
  const kinds = [...host.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Spread by"] button')];
  expect(kinds.every((kind) => !kind.disabled && kind.getAttribute('aria-disabled') !== 'true')).toBe(true);
  act(() => kinds.find((kind) => kind.textContent === 'Affine')!.click());
  expect(choose).toHaveBeenCalledWith('affine');
});

it('offers Default, Affine and Depth without extra captions or a busy-state layout row', async () => {
  const group = host.querySelector('[role="group"][aria-label="Spread by"]')!;
  expect([...group.querySelectorAll('button')].map(b => [b.textContent, b.getAttribute('aria-pressed')]))
    .toEqual([['Default', 'true'], ['Affine', 'false'], ['Depth', 'false']]);
  act(() => (group.querySelectorAll('button')[1] as HTMLButtonElement).click());
  expect(choose).toHaveBeenCalledWith('affine');
  expect(host.textContent).not.toContain('Use new spread');
  expect(host.textContent).not.toContain('Reveal horizontally');
  await act(async () => root.render(<Harness busy />));
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(host.querySelector('[data-field-note]')).toBeNull();
  expect(host.textContent).not.toContain('Deeper layers');
  expect(pad().getAttribute('aria-valuetext')).toContain('Deeper layers');
});

it('stacks Spread by over its choices where asked, with the Affine credit beside its label', async () => {
  const affine: LayerSpreadOptions = { kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 81 };
  await act(async () => root.render(<Harness key="stacked" initial={affine} kindLayout="stacked" />));
  const group = [...host.querySelectorAll('[role="group"]')].find(
    (candidate) => document.getElementById(candidate.getAttribute('aria-labelledby') ?? '')?.textContent === 'Spread by'
  );
  // Named once, by the label over it, and across the row rather than beside the label.
  expect(group?.hasAttribute('aria-label')).toBe(false);
  expect(group?.closest('[data-field-row]')).toBeNull();
  expect(group?.hasAttribute('data-fill')).toBe(true);
  const label = document.getElementById(group!.getAttribute('aria-labelledby')!)!;
  const credit = host.querySelector('button[aria-label="About affine spreading"]');
  expect(label.parentElement?.contains(credit)).toBe(true);
  expect(label.parentElement?.contains(group!)).toBe(false);
  act(() => [...group!.querySelectorAll('button')].find((option) => option.textContent === 'Depth')!.click());
  expect(choose).toHaveBeenCalledWith('depth');

  await act(async () => root.render(<Harness key="stacked" initial={affine} kindLayout="stacked" busy />));
  expect(group?.closest('[aria-busy="true"]')).not.toBeNull();
});

it('clicks and drags both coordinates, caps the rim, and commits only on release', () => {
  pointer('pointerdown', 92, 50);
  expect(preview).toHaveBeenLastCalledWith([8, 0]);
  expect(pad().getAttribute('aria-valuenow')).toBe('100');
  const handle = pad().querySelector('circle:last-child')!;
  expect([handle.getAttribute('cx'), handle.getAttribute('cy')]).toEqual(['92', '50']);
  pointer('pointermove', 50, 8);
  expect(preview).toHaveBeenLastCalledWith([0, -8]);
  pointer('pointermove', 50, -100);
  expect(preview).toHaveBeenLastCalledWith([0, -8]);
  pointer('pointermove', 50, 50);
  expect(preview).toHaveBeenLastCalledWith([0, -0.1]);
  expect(pad().getAttribute('aria-valuenow')).toBe('1.25');
  expect(pad().getAttribute('aria-valuemin')).toBe('1.25');
  expect(commit).not.toHaveBeenCalled();
  pointer('pointerup', 50, 50);
  pointer('lostpointercapture', 50, 50);
  expect(commit).toHaveBeenCalledTimes(1);
});

it.each<[number, number, number]>([[0, 0, 0], [0.8, 0.6, 12.5], [2, 0, 25], [0, -8, 100], [8.000005, 0, 100]])(
  'places saved reveal (%s, %s) inside the expanded pad without editing it',
  async (x, y, percent) => {
    await act(async () => root.render(<Harness key="saved-reveal" initial={{ ...DEFAULT_CONNECTED_SPREAD, reveal: [x, y] }} />));
    expect(Number(pad().getAttribute('aria-valuenow'))).toBe(percent);
    const handle = pad().querySelector('circle:last-child')!;
    expect(Number(handle.getAttribute('cx'))).toBeCloseTo(50 + x * 5.25);
    expect(Number(handle.getAttribute('cy'))).toBeCloseTo(50 + y * 5.25);
    expect(preview).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  },
);

it('allows fine keyboard edits past the old rim and restores the saved vector on cancellation', async () => {
  await act(async () => root.render(<Harness key="old-rim" initial={{ ...DEFAULT_CONNECTED_SPREAD, reveal: [2, 0] }} />));
  pad().setPointerCapture = vi.fn();
  pad().getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
  act(() => pad().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(preview).toHaveBeenLastCalledWith([2.05, 0]);
  commit.mockClear();
  pointer('pointerdown', 92, 50);
  pointer('pointercancel', 92, 50);
  expect(preview).toHaveBeenLastCalledWith([2.05, 0]);
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
