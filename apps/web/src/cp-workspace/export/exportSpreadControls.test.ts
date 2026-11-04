import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import type { LayerSpreadOptions } from '../folded/foldedLayerSpread';
import { DEFAULT_CONNECTED_SPREAD, DEFAULT_SPREAD_STARTS } from '../folded/layerSpreadSettings';
import { exportSpreadControls, type ExportSpreadControlsState } from './exportSpreadControls';

const t = ((key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key)) as unknown as TFunction;

function controls(state: Partial<ExportSpreadControlsState> = {}, shown: LayerSpreadOptions | null = null) {
  const deps = { t, commit: vi.fn(), preview: vi.fn(), sitting: { current: null as LayerSpreadOptions | null } };
  const built = exportSpreadControls(
    { setting: null, spreadable: true, failed: false, starts: DEFAULT_SPREAD_STARTS, ...state },
    shown,
    deps
  );
  return { ...built, deps };
}

describe('a dialog figure’s Spread layers', () => {
  it('turns on at the start the dialog has for it, and off again', () => {
    const off = controls();
    expect(off.toggle).toMatchObject({ pressed: false, disabled: false });
    expect(off.spread).toBeNull();
    off.toggle.run();
    expect(off.deps.commit).toHaveBeenCalledWith(DEFAULT_SPREAD_STARTS.any);

    const on = controls({ setting: DEFAULT_CONNECTED_SPREAD });
    expect(on.toggle.pressed).toBe(true);
    on.toggle.run();
    expect(on.deps.commit).toHaveBeenCalledWith(null);
  });

  it('is held off, saying why under it, for a fold with no layer order', () => {
    const { toggle, spread, deps } = controls({ setting: DEFAULT_CONNECTED_SPREAD, spreadable: false });
    expect(toggle).toMatchObject({
      pressed: false,
      disabled: true,
      note: 'This fold has no layer order, so it has no layers to spread',
    });
    expect(spread).toBeNull();
    toggle.run();
    expect(deps.commit).not.toHaveBeenCalled();
  });

  it('shows its setting and says nothing against it while the figure is still folding', () => {
    const { toggle, spread } = controls({ setting: DEFAULT_CONNECTED_SPREAD, spreadable: null });
    expect(toggle).toMatchObject({ pressed: true, disabled: false });
    expect(toggle.note).toBeUndefined();
    expect(spread).not.toBeNull();
  });

  it('keeps a spread on whose layers could not be spread, says so, and offers another kind', () => {
    const reason = 'These layers couldn’t be spread';
    const { toggle, spread, deps } = controls({ setting: DEFAULT_CONNECTED_SPREAD, failed: true });
    expect(toggle).toMatchObject({ pressed: true, disabled: false, note: reason });
    expect(spread).toMatchObject({ disabled: false, valuesHeld: reason });
    expect(spread!.kinds.map((kind) => kind.disabled)).toEqual([false, false, false]);
    // No value of Default's own changes layers it could not spread: a drag waits.
    expect(spread!.start()).toBe(false);
    spread!.preview('amount', 1);
    spread!.previewReveal([0, 0]);
    spread!.commit();
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.preview).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'connected' }));
    // Affine and Depth need no solve: either is the way on.
    spread!.kinds.find((kind) => kind.value === 'affine')!.run();
    expect(deps.commit).toHaveBeenCalledWith(DEFAULT_SPREAD_STARTS.affine);
    // And it turns off as ever.
    toggle.run();
    expect(deps.commit).toHaveBeenLastCalledWith(null);
  });

  it('holds a depth spread’s direction with its other values while its layers could not be spread', () => {
    const { spread, deps } = controls({ setting: DEFAULT_SPREAD_STARTS.depth, failed: true });
    const left = spread!.directions.find((direction) => direction.value === 'left')!;
    expect(left).toMatchObject({ disabled: true, hint: 'These layers couldn’t be spread' });
    left.run();
    expect(deps.commit).not.toHaveBeenCalled();
    spread!.kinds.find((kind) => kind.value === 'connected')!.run();
    expect(deps.commit).toHaveBeenCalledWith(DEFAULT_SPREAD_STARTS.connected);
  });

  it('is held, saying why on hover, once the share card is made', () => {
    const { toggle, spread, deps } = controls({ setting: DEFAULT_CONNECTED_SPREAD, held: 'The card is made.' });
    expect(toggle).toMatchObject({ pressed: true, disabled: true, hint: 'The card is made.' });
    expect(toggle.note).toBeUndefined();
    expect(spread!.disabled).toBe(true);
    expect(spread!.start()).toBe(false);
    spread!.preview('amount', 1);
    spread!.kinds.find((kind) => kind.value === 'depth')!.run();
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.preview).not.toHaveBeenCalled();
  });
});

describe('a dialog figure’s spread values', () => {
  it('shows a drag as it moves and commits it once, its last move, as it ends', () => {
    const { spread, deps } = controls({ setting: DEFAULT_CONNECTED_SPREAD });
    expect(spread!.start()).toBe(true);
    spread!.preview('amount', 0.8);
    spread!.preview('amount', 1.2);
    expect(deps.preview).toHaveBeenLastCalledWith({ ...DEFAULT_CONNECTED_SPREAD, amount: 1.2 });
    expect(deps.commit).not.toHaveBeenCalled();
    spread!.commit();
    expect(deps.commit).toHaveBeenCalledOnce();
    expect(deps.commit).toHaveBeenCalledWith({ ...DEFAULT_CONNECTED_SPREAD, amount: 1.2 });
    expect(deps.preview).toHaveBeenLastCalledWith(null);
  });

  it('moves the reveal pad as a drag of its own', () => {
    const { spread, deps } = controls({ setting: DEFAULT_CONNECTED_SPREAD });
    spread!.start();
    spread!.previewReveal([-0.5, 0.5]);
    spread!.commit();
    expect(deps.commit).toHaveBeenCalledWith({ ...DEFAULT_CONNECTED_SPREAD, reveal: [-0.5, 0.5] });
  });

  it('commits a key’s step, a preview with no drag before it, at once', () => {
    const { spread, deps } = controls({ setting: DEFAULT_CONNECTED_SPREAD });
    spread!.preview('amount', 0.7);
    spread!.commit();
    expect(deps.commit).toHaveBeenCalledWith({ ...DEFAULT_CONNECTED_SPREAD, amount: 0.7 });
  });

  it('commits nothing for a gesture that moved nothing', () => {
    const { spread, deps } = controls({ setting: DEFAULT_CONNECTED_SPREAD });
    spread!.start();
    spread!.commit();
    expect(deps.commit).not.toHaveBeenCalled();
  });

  it('shows the drag’s value in the rows while it lasts', () => {
    const dragged = { ...DEFAULT_CONNECTED_SPREAD, amount: 1.5 };
    const { spread } = controls({ setting: DEFAULT_CONNECTED_SPREAD }, dragged);
    expect(spread!.spread).toBe(dragged);
  });

  it('switches kind to the kind’s start, and sets a depth spread’s direction at once', () => {
    const { spread, deps } = controls({ setting: DEFAULT_CONNECTED_SPREAD });
    spread!.kinds.find((kind) => kind.value === 'affine')!.run();
    expect(deps.commit).toHaveBeenCalledWith(DEFAULT_SPREAD_STARTS.affine);

    const depth = controls({ setting: DEFAULT_SPREAD_STARTS.depth });
    depth.spread!.directions.find((direction) => direction.value === 'left')!.run();
    expect(depth.deps.commit).toHaveBeenCalledWith({ ...DEFAULT_SPREAD_STARTS.depth, toward: 'left' });
  });
});
