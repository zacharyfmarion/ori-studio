import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { buildDiagramStepActions, type DiagramStepActionState } from './diagramActions';
import { diagramStepMenuItems } from './diagramContextMenu';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

const BASE: DiagramStepActionState = {
  index: 1,
  count: 3,
  number: 2,
  locked: false,
  readOnly: false,
  hasPicture: false,
  hasSource: false,
  link: null,
  linkKind: null,
  breakBefore: false,
  lightingChanged: false,
  facesMissing: false,
  capturing: false,
  patternOpen: true,
  showAs: null,
  poseAgain: false,
  cardMarks: null,
  enlargedArea: null,
  heldAreas: null,
};

function actions(state: Partial<DiagramStepActionState> = {}) {
  return buildDiagramStepActions({ ...BASE, ...state }, {
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
    updateEnlarged: vi.fn(),
    updateAllEnlarged: vi.fn(),
    openInEdit: vi.fn(),
    openInReferences: vi.fn(),
    makeMarksEditable: vi.fn(),
    replaceFromReferences: vi.fn(),
    fromReferences: vi.fn(),
    showAs: vi.fn(),
    duplicateAs: vi.fn(),
    adjustPose: vi.fn(),
    annotate: vi.fn(),
    exportPicture: vi.fn(),
    removePicture: vi.fn(),
    remove: vi.fn(),
  });
}

describe('the step card menu', () => {
  it('lists the step verbs, with dividers between the groups', () => {
    const items = diagramStepMenuItems(actions());
    expect(items.map((item) => (item.kind === 'action' ? item.id : item.kind))).toEqual([
      'insert-before',
      'insert-after',
      'insert-turn-over',
      'insert-rotate',
      'duplicate',
      'separator',
      'move-earlier',
      'move-later',
      'checkbox',
      'separator',
      'upload-picture',
      'link-pattern',
      'from-references',
      'make-turn-over',
      'make-rotate',
      'adjust-pose',
      'annotate',
      'export-picture',
      'remove-picture',
      'separator',
      'delete',
    ]);
  });

  it('names the area an enlarged step’s Update places it from, and holds it while the step is up to date (review of review fix 4)', () => {
    const update = (outOfDate: boolean) =>
      diagramStepMenuItems(actions({ hasSource: true, hasPicture: true, enlargedArea: { number: 22, outOfDate, updating: false } })).find(
        (item) => item.kind === 'action' && item.id === 'update-enlarged'
      );
    expect(update(true)).toMatchObject({ label: 'Update', disabled: false, hint: 'Place the frame again from step {{number}}’s area as it is now' });
    expect(update(false)).toMatchObject({ disabled: true, hint: 'Up to date with step {{number}}’s area' });
  });

  it('offers a linked pattern’s ways as Show As and Duplicate As submenus, the way it is shown checked', () => {
    const items = diagramStepMenuItems(actions({ hasSource: true, link: 'current', linkKind: 'cp', showAs: 'folded' }));
    const showAs = items.find((item) => item.kind === 'submenu' && item.id === 'show-as');
    expect(showAs).toMatchObject({
      label: 'Show As',
      items: [
        { kind: 'radio', label: 'Crease Pattern', checked: false },
        { kind: 'radio', label: 'Folded', checked: true },
        { kind: 'radio', label: 'Simulated', checked: false },
      ],
    });
    const duplicateAs = items.find((item) => item.kind === 'submenu' && item.id === 'duplicate-as');
    expect(duplicateAs).toMatchObject({
      items: [
        { kind: 'action', label: 'Crease Pattern' },
        { kind: 'action', label: 'Folded' },
        { kind: 'action', label: 'Simulated' },
      ],
    });
  });

  it('offers a new page at the step as a check, and not on the first step', () => {
    const row = (state: Partial<DiagramStepActionState>) =>
      diagramStepMenuItems(actions(state)).find((item) => item.kind === 'checkbox');
    expect(row({})).toMatchObject({ id: 'start-page', label: 'Start a New Page Here', checked: false, disabled: false });
    expect(row({ breakBefore: true })).toMatchObject({ checked: true });
    expect(row({ index: 0, number: 1 })).toMatchObject({ disabled: true, hint: 'The first step always starts a page' });
    // Step 1 behind a turn (D22): still the first step.
    expect(row({ index: 1, number: 1 })).toMatchObject({ disabled: true });
  });

  it('shows the key that runs a verb, as the user has bound it', () => {
    const items = diagramStepMenuItems(actions(), {
      overrides: { 'diagram.moveStepLater': [{ key: 'l' }] },
    });
    const row = (id: string) => items.find((item) => item.kind === 'action' && item.id === id);
    expect(row('move-later')).toMatchObject({ shortcut: 'L' });
    expect(row('move-earlier')).toMatchObject({ shortcut: expect.any(String) });
    expect(row('duplicate')).toMatchObject({ shortcut: undefined });
    expect(row('delete')).toMatchObject({ danger: true, shortcut: expect.any(String) });
  });

  it('carries why a row is disabled', () => {
    const items = diagramStepMenuItems(
      actions({ index: 0 })
    );
    const earlier = items.find((item) => item.kind === 'action' && item.id === 'move-earlier');
    expect(earlier).toMatchObject({ disabled: true, hint: 'Already the first step' });
  });
});
