import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import {
  buildDiagramStepActions,
  diagramStepCommand,
  type DiagramStepActionDeps,
  type DiagramStepActionState,
} from './diagramActions';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

function deps(): DiagramStepActionDeps {
  return {
    t,
    insert: vi.fn(),
    duplicate: vi.fn(),
    move: vi.fn(),
    uploadPicture: vi.fn(),
    exportPicture: vi.fn(),
    removePicture: vi.fn(),
    remove: vi.fn(),
  };
}

function build(state: Partial<DiagramStepActionState>, bound = deps()) {
  return buildDiagramStepActions(
    { index: 1, count: 3, locked: false, readOnly: false, hasPicture: false, ...state },
    bound
  );
}

describe('the diagram step verbs', () => {
  it('lists them in one order for every surface', () => {
    expect(build({}).map((action) => action.id)).toEqual([
      'insert-before',
      'insert-after',
      'duplicate',
      'after-add',
      'move-earlier',
      'move-later',
      'after-move',
      'upload-picture',
      'export-picture',
      'remove-picture',
      'after-picture',
      'delete',
    ]);
  });

  it('runs each through its bound callback', () => {
    const bound = deps();
    const actions = build({}, bound);
    diagramStepCommand(actions, 'insert-before')?.run();
    diagramStepCommand(actions, 'insert-after')?.run();
    diagramStepCommand(actions, 'move-later')?.run();
    diagramStepCommand(actions, 'duplicate')?.run();
    diagramStepCommand(actions, 'delete')?.run();
    diagramStepCommand(build({ hasPicture: true }, bound), 'upload-picture')?.run();
    diagramStepCommand(build({ hasPicture: true }, bound), 'export-picture')?.run();
    diagramStepCommand(build({ hasPicture: true }, bound), 'remove-picture')?.run();
    expect(bound.uploadPicture).toHaveBeenCalledOnce();
    expect(bound.exportPicture).toHaveBeenCalledOnce();
    expect(bound.removePicture).toHaveBeenCalledOnce();
    expect(bound.insert).toHaveBeenNthCalledWith(1, 'before');
    expect(bound.insert).toHaveBeenNthCalledWith(2, 'after');
    expect(bound.move).toHaveBeenCalledWith('later');
    expect(bound.duplicate).toHaveBeenCalledOnce();
    expect(bound.remove).toHaveBeenCalledOnce();
  });

  it('stops moving at the ends, and says why', () => {
    const first = build({ index: 0 });
    expect(diagramStepCommand(first, 'move-earlier')).toMatchObject({
      disabled: true,
      hint: 'Already the first step',
    });
    expect(diagramStepCommand(first, 'move-later')?.disabled).toBe(false);
    const last = build({ index: 2 });
    expect(diagramStepCommand(last, 'move-later')?.disabled).toBe(true);
    const only = build({ index: 0, count: 1 });
    expect(diagramStepCommand(only, 'move-earlier')?.disabled).toBe(true);
    expect(diagramStepCommand(only, 'move-later')?.disabled).toBe(true);
  });

  it('lets a step from a newer build move and go, but not be copied', () => {
    const actions = build({ locked: true });
    expect(diagramStepCommand(actions, 'duplicate')?.disabled).toBe(true);
    expect(diagramStepCommand(actions, 'duplicate')?.hint).toContain('newer Ori Studio');
    expect(diagramStepCommand(actions, 'move-earlier')?.disabled).toBe(false);
    expect(diagramStepCommand(actions, 'delete')?.disabled).toBe(false);
  });

  it('disables everything on a read-only diagram, with the reason', () => {
    const actions = build({ readOnly: true });
    for (const action of actions) {
      if (action.kind !== 'command') continue;
      expect(action.disabled, action.id).toBe(true);
      expect(action.hint, action.id).toContain('read-only');
    }
  });

  it('uploads a first picture, or replaces one, and exports or removes only one there is', () => {
    const empty = build({});
    expect(diagramStepCommand(empty, 'upload-picture')).toMatchObject({
      label: 'Upload Picture…',
      disabled: false,
    });
    expect(diagramStepCommand(empty, 'export-picture')).toMatchObject({
      disabled: true,
      hint: 'This step has no picture yet',
    });
    expect(diagramStepCommand(empty, 'remove-picture')?.disabled).toBe(true);
    const pictured = build({ hasPicture: true });
    expect(diagramStepCommand(pictured, 'upload-picture')?.label).toBe('Replace Picture…');
    expect(diagramStepCommand(pictured, 'export-picture')?.disabled).toBe(false);
    expect(diagramStepCommand(pictured, 'remove-picture')?.disabled).toBe(false);
    // A newer build's step is only carried: it gets no picture from this one.
    expect(diagramStepCommand(build({ locked: true }), 'upload-picture')?.disabled).toBe(true);
  });

  it('marks Delete as the dangerous one', () => {
    const actions = build({});
    expect(diagramStepCommand(actions, 'delete')?.danger).toBe(true);
    expect(diagramStepCommand(actions, 'duplicate')?.danger).toBeUndefined();
  });
});
