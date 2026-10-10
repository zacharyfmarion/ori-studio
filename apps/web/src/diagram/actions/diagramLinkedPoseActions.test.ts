import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOLDED_3D_CAMERA } from '../../cp-workspace/folded/folded3dCamera';
import {
  buildDiagramLinkedPoseActions,
  buildDiagramSpreadControls,
  isDefaultRender,
  type DiagramLinkedPoseState,
  layerOrderLabel,
} from './diagramLinkedPoseActions';
import type { DiagramLayerSpread } from '../document/diagramDocument';

const t = ((_key: string, fallback: string, values?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name]))) as unknown as TFunction;

function build(state: Partial<DiagramLinkedPoseState>, pose = vi.fn(), setUpright?: () => void) {
  return buildDiagramLinkedPoseActions(
    {
      render: { mode: 'crease-pattern', rotationDeg: 0 },
      readOnly: false,
      busy: false,
      solutions: null,
      ...state,
    },
    { t, pose, ...(setUpright ? { setUpright } : {}) }
  );
}

const ids = (state: Partial<DiagramLinkedPoseState>) => build(state).map((action) => action.id);

describe('the linked pose verbs', () => {
  it('does nothing for the way already shown: pressed again, a Simulated step would go back to 0%', () => {
    const pose = vi.fn();
    const actions = build(
      { render: { mode: 'simulated', foldPercent: 40, view: { yaw: 0.8, pitch: -0.9, zoom: 1.4 } } },
      pose
    );
    actions.find((action) => action.id === 'show-simulated')!.run();
    expect(pose).not.toHaveBeenCalled();
    actions.find((action) => action.id === 'show-folded')!.run();
    expect(pose).toHaveBeenCalledWith('show-folded');
  });

  it('offers what each way of showing the pattern can do', () => {
    const modes = ['show-crease-pattern', 'show-folded', 'show-simulated'];
    expect(ids({})).toEqual([...modes, 'rotate-left', 'rotate-right', 'reset']);
    expect(ids({ render: { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 } })).toEqual([
      ...modes,
      'turn-over',
      'rotate-left',
      'rotate-right',
      'upright',
      'previous-solution',
      'next-solution',
      'spread-layers',
      'reset',
    ]);
    expect(
      ids({ render: { mode: 'folded-3d', camera: DEFAULT_FOLDED_3D_CAMERA, side: 'front' } })
    ).toEqual([...modes, 'turn-over', 'view-top', 'set-upright', 'spread-layers', 'reset']);
    // A simulation is posed in its own viewport (Pose's transport); here, how it is shown and which way is up.
    expect(ids({ render: { mode: 'simulated', foldPercent: 0, view: { yaw: 0, pitch: 0, zoom: 1 } } })).toEqual([
      ...modes,
      'set-upright',
      'reset',
    ]);
  });

  it('sets a 3D or Simulated step upright in its live view, never as a pose, and holds it, saying why, with none', () => {
    const renders = [
      { mode: 'folded-3d' as const, camera: DEFAULT_FOLDED_3D_CAMERA, side: 'front' as const },
      { mode: 'simulated' as const, foldPercent: 60, view: { yaw: 0.3, pitch: -0.4, zoom: 1 } },
    ];
    for (const render of renders) {
      const pose = vi.fn();
      const setUpright = vi.fn();
      const live = build({ render, liveView: true }, pose, setUpright).find((action) => action.id === 'set-upright')!;
      expect(live).toMatchObject({ label: 'Set Upright', disabled: false, waiting: false });
      live.run();
      expect(setUpright).toHaveBeenCalledTimes(1);
      expect(pose).not.toHaveBeenCalled();
      // The picture alone, as with no WebGL2 there or the simulator still loading: nothing to take an up from.
      const still = build({ render }, pose, setUpright).find((action) => action.id === 'set-upright')!;
      expect(still).toMatchObject({
        disabled: true,
        hint: 'Its live view isn’t showing, so there is no up to set',
      });
      still.run();
      // Waits for a capture as every verb does.
      build({ render, liveView: true, busy: true }, pose, setUpright).find((action) => action.id === 'set-upright')!.run();
      expect(setUpright).toHaveBeenCalledTimes(1);
      expect(pose).not.toHaveBeenCalled();
    }
  });

  it('stands a flat fold upright while its mirror axes are unknown or found, and holds it, saying why, for a fold with none', () => {
    const flat = { mode: 'folded-flat' as const, side: 'front' as const, rotationDeg: 150, foldCase: 13 };
    const upright = (mirrorAxes?: readonly number[] | null) =>
      build({ render: flat, ...(mirrorAxes === undefined ? {} : { mirrorAxes }) }).find((action) => action.id === 'upright')!;
    // Not known until the fold is held: a press folds it and finds out.
    expect(upright()).toMatchObject({ label: 'Upright', disabled: false });
    expect(upright(null)).toMatchObject({ disabled: false });
    expect(upright([112.5])).toMatchObject({ disabled: false });
    expect(upright([])).toMatchObject({ disabled: true, hint: 'This fold has no mirror axis to stand on' });
    const pose = vi.fn();
    build({ render: flat, mirrorAxes: [112.5] }, pose).find((action) => action.id === 'upright')!.run();
    expect(pose).toHaveBeenCalledWith('upright');
  });

  it('marks how the pattern is shown, and runs each verb by its id', () => {
    const pose = vi.fn();
    const actions = build({ render: { mode: 'folded-flat', side: 'back', rotationDeg: 0, foldCase: 3 } }, pose);
    expect(actions.find((action) => action.id === 'show-folded')?.pressed).toBe(true);
    expect(actions.find((action) => action.id === 'show-crease-pattern')?.pressed).toBe(false);
    actions.find((action) => action.id === 'turn-over')?.run();
    expect(pose).toHaveBeenCalledWith('turn-over');
    expect(actions.find((action) => action.id === 'next-solution')?.label).toBe('Next Layer Order');
  });

  // Disabled under the focus, a verb drops it on the page, and every verb
  // starts a capture: so a capture holds the verbs without disabling them.
  it('holds every verb while a capture runs, focusable and saying why, and runs none', () => {
    const pose = vi.fn();
    const actions = build({ busy: true, render: { mode: 'crease-pattern', rotationDeg: 30 } }, pose);
    for (const action of actions) {
      expect(action).toMatchObject({ disabled: false, waiting: true, hint: 'Its picture is being captured' });
      action.run();
    }
    expect(pose).not.toHaveBeenCalled();
  });

  it('keeps a verb’s own reason over the capture’s', () => {
    const reset = build({ busy: true }).find((action) => action.id === 'reset');
    expect(reset).toMatchObject({ disabled: true, waiting: false, hint: 'Already in its starting pose' });
  });

  it('disables every verb on a read-only diagram, saying why', () => {
    for (const action of build({ readOnly: true, busy: true })) {
      expect(action).toMatchObject({
        disabled: true,
        waiting: false,
        hint: 'This diagram was made with a newer Ori Studio and opens read-only',
      });
    }
  });

  it('offers another layer order unless the fold is known to have only one', () => {
    const next = (state: Partial<DiagramLinkedPoseState>, foldCase = 1) =>
      build({ render: { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase }, ...state }).find(
        (action) => action.id === 'next-solution'
      );
    expect(next({ solutions: null })?.disabled).toBe(false);
    expect(next({ solutions: { discovered: 1, hasNext: false } })).toMatchObject({ disabled: true, hint: 'This fold has one layer order' });
    // Past the first, the next wraps back round.
    expect(next({ solutions: { discovered: 1, hasNext: false } }, 2)?.disabled).toBe(false);
    // None at all: nothing to go on to, and it says so.
    expect(next({ solutions: { discovered: 1, hasNext: false, none: true } })).toMatchObject({
      disabled: true,
      hint: 'This fold has no layer order',
    });
  });

  it('goes back to the layer order before, but not from the first (D23)', () => {
    const previous = (foldCase: number) =>
      build({ render: { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase } }).find(
        (action) => action.id === 'previous-solution'
      );
    expect(previous(1)).toMatchObject({ disabled: true, hint: 'This is its first layer order' });
    expect(previous(3)?.disabled).toBe(false);
    // In order: back, on.
    const ids = build({ render: { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 2 } }).map((action) => action.id);
    expect(ids.indexOf('previous-solution') + 1).toBe(ids.indexOf('next-solution'));
  });

  it('says where a flat fold stands among the layer orders found', () => {
    const t = ((_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''))) as never;
    const flat = (foldCase: number) => ({ mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase }) as const;
    expect(layerOrderLabel(flat(2), null, t)).toEqual({ count: '2', label: 'Layer order 2' });
    expect(layerOrderLabel(flat(2), { discovered: 5, hasNext: false }, t)).toEqual({ count: '2 of 5', label: 'Layer order 2 of 5' });
    expect(layerOrderLabel(flat(2), { discovered: 3, hasNext: true }, t)?.count).toBe('2 of 3+');
    // Never fewer found than the one shown.
    expect(layerOrderLabel(flat(4), { discovered: 3, hasNext: true }, t)?.count).toBe('4 of 4+');
    expect(layerOrderLabel({ mode: 'crease-pattern', rotationDeg: 0 }, null, t)).toBeNull();
    // A fold whose layers could not be ordered has none, not one.
    expect(layerOrderLabel(flat(1), { discovered: 1, hasNext: false, none: true }, t)).toEqual({
      count: 'None',
      label: 'No layer order',
    });
  });

  it('resets only a pose that has moved', () => {
    expect(isDefaultRender({ mode: 'crease-pattern', rotationDeg: 0 })).toBe(true);
    expect(isDefaultRender({ mode: 'crease-pattern', rotationDeg: 15 })).toBe(false);
    expect(isDefaultRender({ mode: 'folded-flat', side: 'back', rotationDeg: 0, foldCase: 1 })).toBe(false);
    expect(isDefaultRender({ mode: 'folded-3d', camera: { ...DEFAULT_FOLDED_3D_CAMERA }, side: 'front' })).toBe(true);
    expect(
      isDefaultRender({ mode: 'folded-3d', camera: { ...DEFAULT_FOLDED_3D_CAMERA, yaw: 0 }, side: 'front' })
    ).toBe(false);
    expect(build({}).find((action) => action.id === 'reset')).toMatchObject({
      disabled: true,
      hint: 'Already in its starting pose',
    });
  });
});

describe('spreading a flat fold’s layers (Phase 13)', () => {
  const FLAT = { mode: 'folded-flat' as const, side: 'front' as const, rotationDeg: 0, foldCase: 1 };
  const SPREAD = { kind: 'depth' as const, amount: 0.05, toward: 'up-left' as const };
  const toggle = (state: Partial<DiagramLinkedPoseState>, pose = vi.fn()) =>
    build({ render: FLAT, ...state }, pose).find((action) => action.id === 'spread-layers')!;

  it('is a toggle: pressed while on, and pressed again it turns off', () => {
    const pose = vi.fn();
    const off = toggle({}, pose);
    expect(off).toMatchObject({ label: 'Spread Layers', pressed: false, disabled: false });
    off.run();
    const on = toggle({ render: { ...FLAT, spread: SPREAD } }, pose);
    expect(on.pressed).toBe(true);
    on.run();
    expect(pose.mock.calls).toEqual([['spread-layers'], ['spread-layers']]);
  });

  it('is held, saying why, for a fold in 3D or one with no layer order, and waits for a capture', () => {
    const pose = vi.fn();
    const spatial = toggle({ render: { mode: 'folded-3d', camera: DEFAULT_FOLDED_3D_CAMERA, side: 'front' } }, pose);
    expect(spatial).toMatchObject({ disabled: true, hint: 'Only a flat folded picture has layers to spread' });
    const reason = 'This fold has no layer order, so it has no layers to spread';
    expect(toggle({ seeThrough: true }, pose)).toMatchObject({ disabled: true, hint: reason });
    expect(toggle({ solutions: { discovered: 1, hasNext: false, none: true } }, pose)).toMatchObject({ disabled: true, hint: reason });
    const waiting = toggle({ busy: true, render: { ...FLAT, spread: SPREAD } }, pose);
    expect(waiting).toMatchObject({ disabled: false, waiting: true, pressed: true });
    for (const held of [spatial, waiting]) held.run();
    expect(pose).not.toHaveBeenCalled();
  });

  const AFFINE = { kind: 'affine' as const, amount: 0.03, keep: 'top' as const, skew: 1, axisDeg: 81 };
  const verbs = () => ({ kind: vi.fn(), direction: vi.fn(), keep: vi.fn() });
  const controlsWith = (deps: ReturnType<typeof verbs>) => (state: Partial<DiagramLinkedPoseState>, shown: DiagramLayerSpread | null = null) =>
    buildDiagramSpreadControls({ render: FLAT, readOnly: false, busy: false, solutions: null, ...state }, shown, { t, ...deps });

  it('offers its kind and a depth spread’s direction only while on, the drag’s spread over the step’s', () => {
    const deps = verbs();
    const controls = controlsWith(deps);
    expect(controls({})).toBeNull();
    expect(controls({ render: { mode: 'crease-pattern', rotationDeg: 0 } }, SPREAD)).toBeNull();
    const on = controls({ render: { ...FLAT, spread: SPREAD } })!;
    expect(on).toMatchObject({ spread: SPREAD, disabled: false, keeps: [] });
    // Affine first (Zach, 2026-10-05).
    expect(on.kinds.map(({ value, label, pressed }) => [value, label, pressed])).toEqual([
      ['affine', 'Affine', false],
      ['depth', 'Depth', true],
    ]);
    expect(on.directions.map((option) => option.value)).toEqual([
      'up-left', 'up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left',
    ]);
    expect(on.directions.filter((option) => option.pressed).map((option) => option.label)).toEqual([
      'Deeper layers up and left',
    ]);
    // The way it steps already is no change; another is. So for the kind.
    on.directions[0]!.run();
    on.directions[5]!.run();
    on.kinds[0]!.run();
    on.kinds[1]!.run();
    expect(deps.direction.mock.calls).toEqual([['down']]);
    expect(deps.kind.mock.calls).toEqual([['affine']]);
    // A drag's spread shows over the step's while it is previewed.
    expect(controls({ render: { ...FLAT, spread: SPREAD } }, { ...SPREAD, amount: 0.12 })!.spread.amount).toBe(0.12);
  });

  it('offers an affine spread’s layer held still, and no directions', () => {
    const deps = verbs();
    const on = controlsWith(deps)({ render: { ...FLAT, spread: AFFINE } })!;
    expect(on).toMatchObject({ spread: AFFINE, directions: [] });
    expect(on.kinds.find((kind) => kind.pressed)?.value).toBe('affine');
    expect(on.keeps.map(({ value, label, pressed }) => [value, label, pressed])).toEqual([
      ['top', 'Top', true],
      ['bottom', 'Bottom', false],
    ]);
    on.keeps[0]!.run();
    on.keeps[1]!.run();
    expect(deps.keep.mock.calls).toEqual([['bottom']]);
  });

  it('shows a drag’s spread only while it is of the step’s kind, and no rows for a spread turned off', () => {
    const controls = controlsWith(verbs());
    // A preview begun before the kind changed under it.
    const switched = controls({ render: { ...FLAT, spread: AFFINE } }, { ...SPREAD, amount: 0.12 })!;
    expect(switched.spread).toEqual(AFFINE);
    // A preview left over from a spread since turned off.
    expect(controls({}, { ...SPREAD, amount: 0.12 })).toBeNull();
  });

  it('turns off on a fold with no layer order, though it cannot turn on there', () => {
    const pose = vi.fn();
    const on = toggle({ seeThrough: true, render: { ...FLAT, spread: SPREAD } }, pose);
    expect(on).toMatchObject({ pressed: true, disabled: false });
    on.run();
    expect(pose.mock.calls).toEqual([['spread-layers']]);
  });

  it('holds every choice while a capture runs, on a read-only diagram, and on a picture with no layers', () => {
    const deps = verbs();
    const controls = controlsWith(deps);
    for (const spread of [SPREAD, AFFINE]) {
      const build = (state: Partial<DiagramLinkedPoseState>) => controls({ render: { ...FLAT, spread }, ...state })!;
      const choices = (built: ReturnType<typeof build>) => [...built.kinds, ...built.directions, ...built.keeps];
      for (const choice of choices(build({ busy: true }))) {
        expect(choice).toMatchObject({ waiting: true, disabled: false, hint: 'Its picture is being captured' });
      }
      expect(build({ readOnly: true })).toMatchObject({
        disabled: true,
        hint: 'This diagram was made with a newer Ori Studio and opens read-only',
      });
      for (const choice of choices(build({ seeThrough: true }))) expect(choice).toMatchObject({ disabled: true, waiting: false });
      for (const state of [{ busy: true }, { readOnly: true }, { seeThrough: true }]) {
        for (const choice of choices(build(state))) choice.run();
      }
    }
    expect(deps.kind).not.toHaveBeenCalled();
    expect(deps.direction).not.toHaveBeenCalled();
    expect(deps.keep).not.toHaveBeenCalled();
  });
});
