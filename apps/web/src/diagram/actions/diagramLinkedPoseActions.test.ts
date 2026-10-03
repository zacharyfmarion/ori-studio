import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOLDED_3D_CAMERA } from '../../cp-workspace/folded/folded3dCamera';
import {
  buildDiagramLinkedPoseActions,
  isDefaultRender,
  type DiagramLinkedPoseState,
} from './diagramLinkedPoseActions';

const t = ((_key: string, fallback: string, values?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name]))) as unknown as TFunction;

function build(state: Partial<DiagramLinkedPoseState>, pose = vi.fn()) {
  return buildDiagramLinkedPoseActions(
    {
      render: { mode: 'crease-pattern', rotationDeg: 0 },
      readOnly: false,
      busy: false,
      hasNextSolution: null,
      ...state,
    },
    { t, pose }
  );
}

const ids = (state: Partial<DiagramLinkedPoseState>) => build(state).map((action) => action.id);

describe('the linked pose verbs', () => {
  it('offers what each way of showing the pattern can do', () => {
    const modes = ['show-crease-pattern', 'show-folded', 'show-simulated'];
    expect(ids({})).toEqual([...modes, 'rotate-left', 'rotate-right', 'reset']);
    expect(ids({ render: { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 } })).toEqual([
      ...modes,
      'turn-over',
      'rotate-left',
      'rotate-right',
      'next-solution',
      'reset',
    ]);
    expect(
      ids({ render: { mode: 'folded-3d', camera: DEFAULT_FOLDED_3D_CAMERA, side: 'front' } })
    ).toEqual([...modes, 'turn-over', 'view-top', 'view-front', 'view-iso', 'reset']);
    // A simulation is posed in its own viewport (Pose's transport); here, only how it is shown.
    expect(ids({ render: { mode: 'simulated', foldPercent: 0, view: { yaw: 0, pitch: 0, zoom: 1 } } })).toEqual([
      ...modes,
      'reset',
    ]);
  });

  it('marks how the pattern is shown, and runs each verb by its id', () => {
    const pose = vi.fn();
    const actions = build({ render: { mode: 'folded-flat', side: 'back', rotationDeg: 0, foldCase: 3 } }, pose);
    expect(actions.find((action) => action.id === 'show-folded')?.pressed).toBe(true);
    expect(actions.find((action) => action.id === 'show-crease-pattern')?.pressed).toBe(false);
    actions.find((action) => action.id === 'turn-over')?.run();
    expect(pose).toHaveBeenCalledWith('turn-over');
    expect(actions.find((action) => action.id === 'next-solution')?.label).toBe('Next Layer Order (now 3)');
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
    expect(next({ hasNextSolution: null })?.disabled).toBe(false);
    expect(next({ hasNextSolution: false })).toMatchObject({ disabled: true, hint: 'This fold has one layer order' });
    // Past the first, the next wraps back round.
    expect(next({ hasNextSolution: false }, 2)?.disabled).toBe(false);
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
