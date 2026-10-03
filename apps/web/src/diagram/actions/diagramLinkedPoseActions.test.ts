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
    expect(ids({})).toEqual(['show-crease-pattern', 'show-folded', 'rotate-left', 'rotate-right', 'reset']);
    expect(ids({ render: { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 } })).toEqual([
      'show-crease-pattern',
      'show-folded',
      'turn-over',
      'rotate-left',
      'rotate-right',
      'next-solution',
      'reset',
    ]);
    expect(
      ids({ render: { mode: 'folded-3d', camera: DEFAULT_FOLDED_3D_CAMERA, side: 'front' } })
    ).toEqual(['show-crease-pattern', 'show-folded', 'turn-over', 'view-top', 'view-front', 'view-iso', 'reset']);
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

  it('holds every verb while a capture runs, or on a read-only diagram, saying why', () => {
    for (const action of build({ busy: true })) {
      expect(action).toMatchObject({ disabled: true, hint: 'Its picture is being captured' });
    }
    for (const action of build({ readOnly: true })) expect(action.disabled).toBe(true);
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
