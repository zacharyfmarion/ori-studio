import { DEFAULT_CONNECTED_SPREAD } from '../../cp-workspace/folded/layerSpreadSettings';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import type {
  AffineSpreadOptions,
  DepthSpreadOptions,
  LayerSpreadOptions,
} from '../../cp-workspace/folded/foldedLayerSpread';
import type { LayerSpreadStarts } from '../../cp-workspace/folded/layerSpreadSettings';
import { foldEffectiveSpread, foldSpreadStarts, type FoldEffectiveSpread } from '../document/foldStepSpread';
import { createFoldSequence } from '../document/foldSequenceDocument';
import { step } from '../document/foldSequence.fixtures';
import { foldStepSpreadControls, type FoldSpreadSitting, type FoldStepSpreadState } from './foldStepSpreadControls';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;
const depth: DepthSpreadOptions = { kind: 'depth', amount: 0.05, toward: 'down' };
const affine: AffineSpreadOptions = { kind: 'affine', amount: 0.04, keep: 'top', skew: 1, axisDeg: 81 };
const starts: LayerSpreadStarts = { connected: DEFAULT_CONNECTED_SPREAD, any: depth, depth, affine: { ...affine, amount: 0.1 } };

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
      ['connected', false],
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

  it('starts a new Fold sequence with spread off and enables Default at 7%', () => {
    const { controls, set } = foldStepSpreadControlsWithDefaults();
    expect(controls.toggle.pressed).toBe(false);
    expect(controls.spread).toBeNull();
    controls.toggle.run();
    expect(set).toHaveBeenCalledWith({ ...DEFAULT_CONNECTED_SPREAD, amount: 0.14 });
  });
});

function foldStepSpreadControlsWithDefaults() {
  const set = vi.fn(() => true);
  const document = { ...createFoldSequence(), steps: [step('first', null)] };
  const controls = foldStepSpreadControls(
    { effective: foldEffectiveSpread(document, 'first'), starts: foldSpreadStarts(document, 'first'), hint: undefined },
    { t, set, changed: vi.fn(), newSession: () => 1, sitting: { current: null } }
  );
  return { controls, set };
}

it('previews a radial reveal as one Fold undo sitting and one analytics event', () => {
  const { controls, set, changed } = build(on(DEFAULT_CONNECTED_SPREAD));
  controls.spread!.start();
  controls.spread!.previewReveal([1, 0.5]);
  controls.spread!.previewReveal([0.4, -0.8]);
  expect(set).toHaveBeenNthCalledWith(1, { ...DEFAULT_CONNECTED_SPREAD, reveal: [1, 0.5] }, 1);
  expect(set).toHaveBeenNthCalledWith(2, { ...DEFAULT_CONNECTED_SPREAD, reveal: [0.4, -0.8] }, 1);
  expect(changed).not.toHaveBeenCalled();
  controls.spread!.commit();
  expect(changed).toHaveBeenCalledExactlyOnceWith('spread_reveal', { ...DEFAULT_CONNECTED_SPREAD, reveal: [0.4, -0.8] });
});

it('keeps a saved amount while offering the Fold-specific 7% reset', () => {
  const saved = { ...DEFAULT_CONNECTED_SPREAD, amount: 1.2 };
  const { controls, set } = build(on(saved));
  expect(controls.spread?.spread.amount).toBe(1.2);
  expect(controls.spread?.defaultAmount).toBe(0.14);
  expect(set).not.toHaveBeenCalled();
});
