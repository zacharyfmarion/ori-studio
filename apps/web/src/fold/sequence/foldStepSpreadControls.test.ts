import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import type {
  AffineSpreadOptions,
  DepthSpreadOptions,
  LayerSpreadOptions,
} from '../../cp-workspace/folded/foldedLayerSpread';
import { DEFAULT_SPREAD_STARTS, type LayerSpreadStarts } from '../../cp-workspace/folded/layerSpreadSettings';
import type { FoldEffectiveSpread } from '../document/foldStepSpread';
import { foldStepSpreadControls, type FoldSpreadSitting, type FoldStepSpreadState } from './foldStepSpreadControls';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;
const depth: DepthSpreadOptions = { kind: 'depth', amount: 0.05, toward: 'down' };
const affine: AffineSpreadOptions = { kind: 'affine', amount: 0.04, keep: 'top', skew: 1, axisDeg: 81 };
const starts: LayerSpreadStarts = { any: depth, depth, affine: { ...affine, amount: 0.1 } };

function build(effective: FoldEffectiveSpread, state: Partial<FoldStepSpreadState> = {}, changes = true) {
  const set = vi.fn(() => changes);
  const changed = vi.fn();
  let sessions = 0;
  const sitting: { current: FoldSpreadSitting | null } = { current: null };
  const controls = foldStepSpreadControls(
    { effective, starts, hint: undefined, ...state },
    { t, set, changed, newSession: () => (sessions += 1), sitting }
  );
  return { controls, set, changed, sitting };
}

const on = (spread: LayerSpreadOptions = affine): FoldEffectiveSpread => ({ spread, origin: 'earlier', from: 'fstep-a' });
const off: FoldEffectiveSpread = { spread: null, origin: 'own', from: 'fstep-b' };

describe('a Fold step’s spread controls', () => {
  it('turns a spread off, and on again from the spreads before it, counting each', () => {
    const shown = build(on());
    expect(shown.controls.toggle).toMatchObject({ pressed: true, disabled: false });
    shown.controls.toggle.run();
    expect(shown.set).toHaveBeenCalledWith('off');
    expect(shown.changed).toHaveBeenCalledWith('spread_off', null);

    const hidden = build(off);
    expect(hidden.controls.toggle.pressed).toBe(false);
    expect(hidden.controls.spread).toBeNull();
    hidden.controls.toggle.run();
    expect(hidden.set).toHaveBeenCalledWith(depth);
    expect(hidden.changed).toHaveBeenCalledWith('spread_on', depth);
  });

  it('starts a kind from the nearest earlier spread of it, and sets a direction or a layer held still', () => {
    const shown = build(on());
    expect(shown.controls.spread?.kinds.map((kind) => [kind.value, kind.pressed])).toEqual([
      ['affine', true],
      ['depth', false],
    ]);
    shown.controls.spread?.kinds.find((kind) => kind.value === 'depth')?.run();
    expect(shown.set).toHaveBeenLastCalledWith(depth);
    shown.controls.spread?.keeps.find((keep) => keep.value === 'bottom')?.run();
    expect(shown.set).toHaveBeenLastCalledWith({ ...affine, keep: 'bottom' });
    expect(shown.changed.mock.calls.map(([change]) => change)).toEqual(['spread_kind', 'spread_keep']);

    const byDepth = build(on(depth));
    byDepth.controls.spread?.directions.find((direction) => direction.value === 'up-left')?.run();
    expect(byDepth.set).toHaveBeenLastCalledWith({ ...depth, toward: 'up-left' });
  });

  it('writes a drag as it moves in one sitting, and counts it once, as it ends', () => {
    const { controls, set, changed, sitting } = build(on());
    expect(controls.spread?.start()).toBe(true);
    controls.spread?.preview('amount', 0.051);
    controls.spread?.preview('amount', 0.06);
    expect(set.mock.calls).toEqual([
      [{ ...affine, amount: 0.051 }, 1],
      [{ ...affine, amount: 0.06 }, 1],
    ]);
    expect(changed).not.toHaveBeenCalled();
    controls.spread?.commit();
    expect(changed).toHaveBeenCalledWith('spread_amount', { ...affine, amount: 0.06 });
    expect(sitting.current).toBeNull();
    // A key's step, with no drag begun: a sitting of its own.
    controls.spread?.preview('axis', 200);
    expect(set).toHaveBeenLastCalledWith({ ...affine, axisDeg: 20 }, 2);
    controls.spread?.commit();
    expect(changed).toHaveBeenLastCalledWith('spread_axis', { ...affine, axisDeg: 20 });
  });

  it('counts nothing that changed nothing', () => {
    const { controls, changed } = build(on(), {}, false);
    controls.toggle.run();
    controls.spread?.start();
    controls.spread?.preview('skew', 0.5);
    controls.spread?.commit();
    expect(changed).not.toHaveBeenCalled();
  });

  it('refuses every control on a sequence or step it cannot change, and says why', () => {
    const { controls, set } = build(on(), { hint: 'Read-only' });
    expect(controls.toggle).toMatchObject({ disabled: true, hint: 'Read-only' });
    expect(controls.spread).toMatchObject({ disabled: true, hint: 'Read-only' });
    controls.toggle.run();
    expect(controls.spread?.start()).toBe(false);
    controls.spread?.preview('amount', 0.1);
    controls.spread?.kinds[1]?.run();
    expect(set).not.toHaveBeenCalled();
  });

  it('offers the defaults as starts when nothing before is spread', () => {
    const { controls, set } = foldStepSpreadControlsWithDefaults();
    controls.toggle.run();
    expect(set).toHaveBeenCalledWith(DEFAULT_SPREAD_STARTS.any);
  });
});

function foldStepSpreadControlsWithDefaults() {
  const set = vi.fn(() => true);
  const controls = foldStepSpreadControls(
    { effective: off, starts: DEFAULT_SPREAD_STARTS, hint: undefined },
    { t, set, changed: vi.fn(), newSession: () => 1, sitting: { current: null } }
  );
  return { controls, set };
}
