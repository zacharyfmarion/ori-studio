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
    linkPattern: vi.fn(),
    refreshPicture: vi.fn(),
    exportPicture: vi.fn(),
    removePicture: vi.fn(),
    remove: vi.fn(),
  };
}

function build(state: Partial<DiagramStepActionState>, bound = deps()) {
  return buildDiagramStepActions(
    {
      index: 1,
      count: 3,
      locked: false,
      readOnly: false,
      hasPicture: false,
      hasSource: false,
      link: null,
      capturing: false,
      patternOpen: true,
      ...state,
    },
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
      'link-pattern',
      'export-picture',
      'remove-picture',
      'after-picture',
      'delete',
    ]);
    // A linked step can also be refreshed.
    expect(build({ link: 'stale' }).map((action) => action.id)).toContain('refresh-picture');
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
    diagramStepCommand(build({ hasPicture: true, hasSource: true }, bound), 'remove-picture')?.run();
    diagramStepCommand(build({}, bound), 'link-pattern')?.run();
    diagramStepCommand(build({ link: 'stale' }, bound), 'refresh-picture')?.run();
    expect(bound.linkPattern).toHaveBeenCalledOnce();
    expect(bound.refreshPicture).toHaveBeenCalledOnce();
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

  it('disables every edit on a read-only diagram, with the reason, but not an export', () => {
    const actions = build({ readOnly: true, hasPicture: true, hasSource: true, link: 'stale' });
    for (const action of actions) {
      if (action.kind !== 'command' || action.id === 'export-picture') continue;
      expect(action.disabled, action.id).toBe(true);
      expect(action.hint, action.id).toContain('read-only');
    }
    // An export changes nothing, so it is offered wherever there is a picture.
    expect(diagramStepCommand(actions, 'export-picture')).toMatchObject({ disabled: false });
    expect(diagramStepCommand(build({ readOnly: true }), 'export-picture')).toMatchObject({
      disabled: true,
      hint: 'This step has no picture yet',
    });
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
    const pictured = build({ hasPicture: true, hasSource: true });
    expect(diagramStepCommand(pictured, 'upload-picture')?.label).toBe('Replace Picture…');
    expect(diagramStepCommand(pictured, 'export-picture')?.disabled).toBe(false);
    expect(diagramStepCommand(pictured, 'remove-picture')?.disabled).toBe(false);
    // A newer build's step is only carried: it gets no picture from this one.
    expect(diagramStepCommand(build({ locked: true }), 'upload-picture')?.disabled).toBe(true);
  });

  it('links a step to a pattern, or relinks one, only with a pattern open', () => {
    expect(diagramStepCommand(build({}), 'link-pattern')).toMatchObject({
      label: 'Link Pattern…',
      disabled: false,
    });
    expect(diagramStepCommand(build({ link: 'current' }), 'link-pattern')?.label).toBe('Relink Pattern…');
    expect(diagramStepCommand(build({ patternOpen: false }), 'link-pattern')).toMatchObject({
      disabled: true,
      hint: 'Open a crease pattern in Edit to link it',
    });
    expect(diagramStepCommand(build({ locked: true }), 'link-pattern')?.disabled).toBe(true);
  });

  it('refreshes a linked step only when its pattern changed, or cannot be checked yet', () => {
    const refresh = (state: Partial<DiagramStepActionState>) =>
      diagramStepCommand(build({ hasSource: true, ...state }), 'refresh-picture');
    expect(refresh({ link: 'stale' })?.disabled).toBe(false);
    expect(refresh({ link: 'current' })).toMatchObject({
      disabled: true,
      hint: 'Already shows its pattern as it is',
    });
    expect(refresh({ link: 'missing' })).toMatchObject({
      disabled: true,
      hint: 'Its pattern is gone: relink it to another',
    });
    expect(refresh({ link: 'unknown' })?.disabled).toBe(false);
    expect(refresh({ link: 'unknown', patternOpen: false })?.disabled).toBe(true);
    // Not on a step that is not linked.
    expect(refresh({ link: null })).toBeNull();
  });

  it('holds the picture verbs while a capture runs, and removes a link with no picture yet', () => {
    const capturing = build({ link: 'stale', hasSource: true, capturing: true });
    for (const id of ['upload-picture', 'link-pattern', 'refresh-picture', 'remove-picture'] as const) {
      expect(diagramStepCommand(capturing, id), id).toMatchObject({
        disabled: true,
        hint: 'Its picture is being captured',
      });
    }
    // Linked, not yet posed: nothing to export, but a link to take away.
    const unposed = build({ link: 'current', hasSource: true, hasPicture: false });
    expect(diagramStepCommand(unposed, 'export-picture')?.disabled).toBe(true);
    expect(diagramStepCommand(unposed, 'remove-picture')?.disabled).toBe(false);
  });

  it('marks Delete as the dangerous one', () => {
    const actions = build({});
    expect(diagramStepCommand(actions, 'delete')?.danger).toBe(true);
    expect(diagramStepCommand(actions, 'duplicate')?.danger).toBeUndefined();
  });
});
