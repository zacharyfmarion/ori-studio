import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { buildDiagramStepActions, type DiagramStepActionState } from './diagramActions';
import { diagramStepMenuItems } from './diagramContextMenu';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

const BASE: DiagramStepActionState = {
  index: 1,
  count: 3,
  locked: false,
  readOnly: false,
  hasPicture: false,
  hasSource: false,
  link: null,
  linkKind: null,
  capturing: false,
  patternOpen: true,
};

function actions(state: Partial<DiagramStepActionState> = {}) {
  return buildDiagramStepActions({ ...BASE, ...state }, {
    t,
    insert: vi.fn(),
    duplicate: vi.fn(),
    move: vi.fn(),
    uploadPicture: vi.fn(),
    linkPattern: vi.fn(),
    refreshPicture: vi.fn(),
    openInEdit: vi.fn(),
    openInReferences: vi.fn(),
    fromReferences: vi.fn(),
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
      'duplicate',
      'separator',
      'move-earlier',
      'move-later',
      'separator',
      'upload-picture',
      'link-pattern',
      'from-references',
      'export-picture',
      'remove-picture',
      'separator',
      'delete',
    ]);
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
