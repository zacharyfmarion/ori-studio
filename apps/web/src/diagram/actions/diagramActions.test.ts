import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import {
  buildDiagramStepActions,
  diagramStepChoice,
  diagramStepCommand,
  type DiagramStepActionDeps,
  type DiagramStepActionState,
} from './diagramActions';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

function deps(): DiagramStepActionDeps {
  return {
    t,
    insert: vi.fn(),
    insertTurn: vi.fn(),
    makeTurn: vi.fn(),
    duplicate: vi.fn(),
    move: vi.fn(),
    toggleBreak: vi.fn(),
    uploadPicture: vi.fn(),
    linkPattern: vi.fn(),
    refreshPicture: vi.fn(),
    openInEdit: vi.fn(),
    openInReferences: vi.fn(),
    replaceFromReferences: vi.fn(),
    fromReferences: vi.fn(),
    showAs: vi.fn(),
    duplicateAs: vi.fn(),
    adjustPose: vi.fn(),
    annotate: vi.fn(),
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
      // A link, unless a test says otherwise, is to a pattern.
      linkKind: state.link ? 'cp' : null,
      breakBefore: false,
      lightingChanged: false,
      capturing: false,
      patternOpen: true,
      showAs: null,
      poseAgain: false,
      ...state,
    } as DiagramStepActionState,
    bound
  );
}

describe('the diagram step verbs', () => {
  it('lists them in one order for every surface', () => {
    expect(build({}).map((action) => action.id)).toEqual([
      'insert-before',
      'insert-after',
      'insert-turn-over',
      'insert-rotate',
      'duplicate',
      'after-add',
      'move-earlier',
      'move-later',
      'start-page',
      'after-move',
      'upload-picture',
      'link-pattern',
      'from-references',
      'make-turn-over',
      'make-rotate',
      'adjust-pose',
      'annotate',
      'export-picture',
      'remove-picture',
      'after-picture',
      'delete',
    ]);
    // A linked step can also be refreshed, and shown in Edit.
    const linked = build({ link: 'stale' }).map((action) => action.id);
    expect(linked).toContain('refresh-picture');
    expect(linked).toContain('open-in-edit');
  });

  it('offers an empty step to be a turn instead, and no other (D24)', () => {
    const bound = deps();
    diagramStepCommand(build({}, bound), 'make-turn-over')?.run();
    diagramStepCommand(build({}, bound), 'make-rotate')?.run();
    expect(bound.makeTurn).toHaveBeenNthCalledWith(1, 'turn-over');
    expect(bound.makeTurn).toHaveBeenNthCalledWith(2, 'rotate');
    for (const step of [{ hasSource: true }, { hasSource: true, hasPicture: true }, { locked: true }]) {
      expect(diagramStepCommand(build(step), 'make-turn-over')).toBeNull();
    }
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
    diagramStepCommand(build({}, bound), 'from-references')?.run();
    diagramStepCommand(build({ link: 'stale', linkKind: 'references' }, bound), 'open-in-references')?.run();
    expect(bound.fromReferences).toHaveBeenCalledOnce();
    expect(bound.openInReferences).toHaveBeenCalledOnce();
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
      // Exporting and showing the pattern in Edit change nothing in the diagram.
      if (action.kind !== 'command' || action.id === 'export-picture' || action.id === 'open-in-edit') continue;
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

  it('annotates only a step with a picture this build can change', () => {
    const bound = deps();
    expect(diagramStepCommand(build({}), 'annotate')).toMatchObject({
      disabled: true,
      hint: 'Give the step a picture to annotate',
    });
    diagramStepCommand(build({ hasPicture: true, hasSource: true }, bound), 'annotate')?.run();
    expect(bound.annotate).toHaveBeenCalledOnce();
    expect(diagramStepCommand(build({ locked: true, hasPicture: true }), 'annotate')?.disabled).toBe(true);
  });

  it('offers a linked pattern’s ways as Show As, the current one checked, and Duplicate As beside Duplicate', () => {
    const bound = deps();
    const actions = build({ hasSource: true, link: 'current', showAs: 'crease-pattern' }, bound);
    const showAs = diagramStepChoice(actions, 'show-as')!;
    expect(showAs.options.map((option) => [option.label, option.checked])).toEqual([
      ['Crease Pattern', true],
      ['Folded', false],
      ['Simulated', false],
    ]);
    showAs.options[1]!.run();
    expect(bound.showAs).toHaveBeenCalledWith('folded');
    const ids = actions.map((action) => action.id);
    expect(ids.indexOf('duplicate-as')).toBe(ids.indexOf('duplicate') + 1);
    diagramStepChoice(actions, 'duplicate-as')!.options[1]!.run();
    expect(bound.duplicateAs).toHaveBeenCalledWith('folded');
    // Not for a step that is not linked to the pattern.
    expect(diagramStepChoice(build({}), 'show-as')).toBeNull();
  });

  it('holds Show As while there is no pattern to capture from, or its region is gone', () => {
    expect(diagramStepChoice(build({ link: 'current', showAs: 'folded', patternOpen: false }), 'show-as')).toMatchObject({
      disabled: true,
      hint: 'Its crease pattern isn’t open',
    });
    expect(diagramStepChoice(build({ link: 'missing', showAs: 'folded' }), 'show-as')?.disabled).toBe(true);
    expect(diagramStepChoice(build({ link: 'current', showAs: 'folded', capturing: true }), 'show-as')?.disabled).toBe(true);
    expect(diagramStepChoice(build({ link: 'current', showAs: 'folded', readOnly: true }), 'show-as')?.disabled).toBe(true);
  });

  it('poses a step with a picture or a link, and not an empty or a newer build’s one', () => {
    const bound = deps();
    expect(diagramStepCommand(build({}), 'adjust-pose')).toMatchObject({
      disabled: true,
      hint: 'Give the step a picture to pose',
    });
    // A linked step not captured yet: Pose is where it chooses how to show its pattern.
    diagramStepCommand(build({ hasSource: true, linkKind: 'cp', link: 'current' }, bound), 'adjust-pose')?.run();
    expect(bound.adjustPose).toHaveBeenCalledOnce();
    expect(diagramStepCommand(build({ locked: true, hasSource: true }), 'adjust-pose')?.disabled).toBe(true);
    expect(diagramStepCommand(build({ readOnly: true, hasSource: true }), 'adjust-pose')?.disabled).toBe(true);
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
    // A 3D picture lit by an old style relights, even when its pattern is as it was.
    expect(refresh({ link: 'current', lightingChanged: true })?.disabled).toBe(false);
    expect(refresh({ link: 'missing', lightingChanged: true })?.disabled).toBe(true);
    // Not on a step that is not linked.
    expect(refresh({ link: null })).toBeNull();
  });

  it('poses again a step folded part way in the simulator, which only Pose captures', () => {
    const refresh = (state: Partial<DiagramStepActionState>) =>
      diagramStepCommand(build({ hasSource: true, poseAgain: true, ...state }), 'refresh-picture');
    expect(refresh({ link: 'stale' })).toMatchObject({ label: 'Pose Again', disabled: false });
    expect(refresh({ link: 'current' })).toMatchObject({ label: 'Pose Again', disabled: true });
  });

  it('shows a linked step’s pattern in Edit, even on a read-only diagram, while one is open', () => {
    const bound = deps();
    const open = diagramStepCommand(build({ link: 'current', readOnly: true }, bound), 'open-in-edit');
    expect(open?.disabled).toBe(false);
    open?.run();
    expect(bound.openInEdit).toHaveBeenCalledOnce();
    expect(diagramStepCommand(build({ link: 'current', patternOpen: false }), 'open-in-edit')).toMatchObject({
      disabled: true,
      hint: 'Its crease pattern isn’t open',
    });
  });

  describe('a step sent from References', () => {
    const sent = (state: Partial<DiagramStepActionState> = {}, bound = deps()) =>
      build({ link: 'stale', linkKind: 'references', hasPicture: true, hasSource: true, ...state }, bound);

    it('is never refreshed and never shown in Edit: it leads back to its sheet', () => {
      const actions = sent();
      expect(diagramStepCommand(actions, 'refresh-picture')).toBeNull();
      expect(diagramStepCommand(actions, 'open-in-edit')).toBeNull();
      expect(diagramStepCommand(actions, 'open-in-references')).toMatchObject({
        label: 'Open in References',
        disabled: false,
      });
      // Linking one to a pattern is a link, not a relink.
      expect(diagramStepCommand(actions, 'link-pattern')?.label).toBe('Link Pattern…');
    });

    it('replaces its card from the References browser, while the pattern is open and it can change', () => {
      const bound = deps();
      const replace = diagramStepCommand(sent({}, bound), 'replace-from-references');
      expect(replace).toMatchObject({ label: 'Replace from References…', disabled: false });
      replace?.run();
      expect(bound.replaceFromReferences).toHaveBeenCalledOnce();
      expect(diagramStepCommand(sent({ patternOpen: false }), 'replace-from-references')).toMatchObject({
        disabled: true,
        hint: 'Its crease pattern isn’t open',
      });
      expect(diagramStepCommand(sent({ readOnly: true }), 'replace-from-references')?.disabled).toBe(true);
      expect(diagramStepCommand(sent({ locked: true }), 'replace-from-references')?.disabled).toBe(true);
      // Only a References step has a card to replace.
      expect(diagramStepCommand(build({ link: 'current', linkKind: 'cp', hasSource: true }), 'replace-from-references')).toBeNull();
    });

    it('opens its sheet on a read-only diagram too, while the pattern is open', () => {
      expect(diagramStepCommand(sent({ readOnly: true }), 'open-in-references')?.disabled).toBe(false);
      expect(diagramStepCommand(sent({ patternOpen: false }), 'open-in-references')).toMatchObject({
        disabled: true,
        hint: 'Its crease pattern isn’t open',
      });
    });
  });

  it('fills an empty step from References, while a pattern is open to plan', () => {
    expect(diagramStepCommand(build({}), 'from-references')).toMatchObject({
      label: 'From References…',
      disabled: false,
    });
    expect(diagramStepCommand(build({ patternOpen: false }), 'from-references')).toMatchObject({
      disabled: true,
      hint: 'Open a crease pattern in Edit to plan its folds',
    });
    expect(diagramStepCommand(build({ locked: true }), 'from-references')?.disabled).toBe(true);
    expect(diagramStepCommand(build({ readOnly: true }), 'from-references')?.disabled).toBe(true);
    // Only for an empty step: the header's From References… adds after one with a picture.
    expect(diagramStepCommand(build({ hasSource: true, hasPicture: true }), 'from-references')).toBeNull();
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
