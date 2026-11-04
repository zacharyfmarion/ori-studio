import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SpatialSpreadAmountRow } from './SpatialSpreadAmountRow';

it('uses a 0–100% slider whose full range reaches four unit displacements', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const preview = vi.fn(),
    commit = vi.fn();
  try {
    await act(async () =>
      root.render(
        <SpatialSpreadAmountRow
          value={{ amount: 2, disabled: false, preview, commit }}
        />
      )
    );
    const slider = host.querySelector<HTMLInputElement>(
      'input[aria-label="Spread amount"]'
    )!;
    expect([
      slider.min,
      slider.max,
      slider.value,
      slider.getAttribute('aria-valuetext'),
    ]).toEqual(['0', '100', '50', '50%']);
    for (const [percent, amount] of [
      [100, 4],
      [0, 0],
    ]) {
      act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )!.set!.call(slider, String(percent));
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(preview).toHaveBeenLastCalledWith(amount);
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
