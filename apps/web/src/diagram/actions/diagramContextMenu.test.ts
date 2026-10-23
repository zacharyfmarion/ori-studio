import type { TFunction } from 'i18next';
import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import { describe, expect, it, vi } from 'vitest';
import { buildDiagramStepActions, type DiagramStepActionState } from './diagramActions';
import { diagramPageMenuItems, diagramStepMenuItems } from './diagramContextMenu';
import { buildDiagramPageActions } from './diagramPageActions';

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
    openInFold: vi.fn(),
    makeMarksEditable: vi.fn(),
    replaceFromReferences: vi.fn(),
    fromReferences: vi.fn(),
    fromFold: vi.fn(),
    showAs: vi.fn(),
    duplicateAs: vi.fn(),
    adjustPose: vi.fn(),
    annotate: vi.fn(),
    exportPicture: vi.fn(),
    removePicture: vi.fn(),
    remove: vi.fn(),
  });
}

/** A row by id, wherever the menu keeps it. */
function row(items: readonly ContextMenuItem[], id: string): ContextMenuItem | undefined {
  for (const item of items) {
    if (item.kind === 'separator') continue;
    if (item.id === id) return item;
    if (item.kind === 'submenu') {
      const found = row(item.items, id);
      if (found) return found;
    }
  }
  return undefined;
}

/** The menu as it reads: a row's id, a divider, and a submenu as its id and its rows. */
function outline(items: readonly ContextMenuItem[]): unknown[] {
  return items.map((item) =>
    item.kind === 'separator' ? '—' : item.kind === 'submenu' ? [item.id, outline(item.items)] : item.id
  );
}

const LINKED: Partial<DiagramStepActionState> = {
  hasSource: true,
  hasPicture: true,
  link: 'current',
  linkKind: 'cp',
  showAs: 'folded',
  placement: { size: true, position: true, newer: false },
};

describe('the step card menu', () => {
  it('leads with the verbs used most, groups the rest as submenus, and ends with Delete', () => {
    expect(outline(diagramStepMenuItems(actions(LINKED)))).toEqual([
      'adjust-pose',
      'annotate',
      'duplicate',
      ['show-as', ['show-as-crease-pattern', 'show-as-folded', 'show-as-simulated']],
      '—',
      ['insert', ['insert-before', 'insert-after', 'insert-turn-over', 'insert-rotate']],
      ['duplicate-as', ['duplicate-as-crease-pattern', 'duplicate-as-folded', 'duplicate-as-simulated']],
      ['move', ['move-earlier', 'move-later', 'start-page']],
      ['picture', ['upload-picture', 'link-pattern', 'refresh-picture', 'open-in-edit', '—', 'export-picture', 'remove-picture']],
      ['page', ['reset-size', 'reset-position', 'reset-layout']],
      '—',
      'delete',
    ]);
    const insert = row(diagramStepMenuItems(actions(LINKED)), 'insert');
    expect(insert).toMatchObject({
      kind: 'submenu',
      label: 'Insert',
      items: [{ label: 'Step Before' }, { label: 'Step After' }, { label: 'Turn Over After' }, { label: 'Rotate After' }],
    });
    expect(row(diagramStepMenuItems(actions(LINKED)), 'page')).toMatchObject({ label: 'On the Page' });
  });

  it('puts Refresh Picture at the top while the picture is out of date', () => {
    const items = diagramStepMenuItems(actions({ ...LINKED, link: 'stale' }));
    expect(items.slice(0, 5).map((item) => (item.kind === 'separator' ? '—' : item.id))).toEqual([
      'adjust-pose',
      'annotate',
      'duplicate',
      'show-as',
      'refresh-picture',
    ]);
    const picture = row(items, 'picture');
    expect(picture?.kind === 'submenu' && picture.items.some((item) => item.kind !== 'separator' && item.id === 'refresh-picture')).toBe(false);
  });

  it('names the area an enlarged step’s Update places it from, and holds it while the step is up to date (review of review fix 4)', () => {
    const update = (outOfDate: boolean) =>
      row(diagramStepMenuItems(actions({ hasSource: true, hasPicture: true, enlargedArea: { number: 22, outOfDate, updating: false } })), 'update-enlarged');
    expect(update(true)).toMatchObject({ label: 'Update', disabled: false, hint: 'Place the frame again from step {{number}}’s area as it is now' });
    expect(update(false)).toMatchObject({ disabled: true, hint: 'Up to date with step {{number}}’s area' });
  });

  it('offers a linked pattern’s ways as Show As and Duplicate As submenus, the way it is shown checked', () => {
    const items = diagramStepMenuItems(actions({ hasSource: true, link: 'current', linkKind: 'cp', showAs: 'folded' }));
    expect(row(items, 'show-as')).toMatchObject({
      label: 'Show As',
      items: [
        { kind: 'radio', label: 'Crease Pattern', checked: false },
        { kind: 'radio', label: 'Folded', checked: true },
        { kind: 'radio', label: 'Simulated', checked: false },
      ],
    });
    expect(row(items, 'duplicate-as')).toMatchObject({
      items: [
        { kind: 'action', label: 'Crease Pattern' },
        { kind: 'action', label: 'Folded' },
        { kind: 'action', label: 'Simulated' },
      ],
    });
  });

  it('offers a new page at the step as a check in Move, and not on the first step', () => {
    const page = (state: Partial<DiagramStepActionState>) => row(diagramStepMenuItems(actions(state)), 'start-page');
    expect(page({})).toMatchObject({ kind: 'checkbox', label: 'Start a New Page Here', checked: false, disabled: false });
    expect(page({ breakBefore: true })).toMatchObject({ checked: true });
    expect(page({ index: 0, number: 1 })).toMatchObject({ disabled: true, hint: 'The first step always starts a page' });
    // Step 1 behind a turn (D22): still the first step.
    expect(page({ index: 1, number: 1 })).toMatchObject({ disabled: true });
  });

  it('shows the key that runs a verb, as the user has bound it, in its submenu too', () => {
    const items = diagramStepMenuItems(actions(), {
      overrides: { 'diagram.moveStepLater': [{ key: 'l' }] },
    });
    expect(row(items, 'move-later')).toMatchObject({ label: 'Later', shortcut: 'L' });
    expect(row(items, 'move-earlier')).toMatchObject({ label: 'Earlier', shortcut: expect.any(String) });
    expect(row(items, 'duplicate')).toMatchObject({ shortcut: undefined });
    expect(row(items, 'delete')).toMatchObject({ danger: true, shortcut: expect.any(String) });
  });

  it('carries why a row is disabled, and why a submenu is', () => {
    expect(row(diagramStepMenuItems(actions({ index: 0 })), 'move-earlier')).toMatchObject({
      disabled: true,
      hint: 'Already the first step',
    });
    expect(row(diagramStepMenuItems(actions({ index: 0, count: 1, number: 1 })), 'move')).toMatchObject({
      kind: 'submenu',
      disabled: true,
      hint: expect.stringContaining('Already the first step'),
    });
  });

  // Zach's review of #436: an icon for everything. Every row draws one, at
  // the top and in a submenu — but for a way to show the pattern, which is
  // one of a set (Show As's checks) or a name (Duplicate As's), not a verb.
  it('draws every row and every submenu with an icon, whatever the step', () => {
    const steps: Partial<DiagramStepActionState>[] = [
      {},
      { hasSource: true, hasPicture: true },
      { ...LINKED, link: 'stale', enlargedArea: { number: 2, outOfDate: false, updating: false }, heldAreas: { outOfDate: 1 } },
      { hasSource: true, hasPicture: true, link: 'current', linkKind: 'references', cardMarks: { lifted: 3, total: 3, fits: true } },
      { ...LINKED, locked: true },
      { ...LINKED, readOnly: true },
    ];
    const missing = (items: readonly ContextMenuItem[], ways: boolean): string[] =>
      items.flatMap((item) => {
        if (item.kind === 'separator' || ways) return [];
        if (item.kind === 'radio' || item.kind === 'color') return [item.id];
        const own = item.icon == null ? [item.id] : [];
        return item.kind === 'submenu' ? [...own, ...missing(item.items, item.id === 'show-as' || item.id === 'duplicate-as')] : own;
      });
    for (const state of steps) {
      expect(missing(diagramStepMenuItems(actions(state)), false), JSON.stringify(state)).toEqual([]);
    }
  });
});

describe('diagramPageMenuItems', () => {
  it('lays a flow page’s verbs out as rows, each running its own, with why it is held back', () => {
    const deps = { t, repackPage: vi.fn(), repackAll: vi.fn() };
    const items = diagramPageMenuItems(buildDiagramPageActions({ flow: true, readOnly: false }, deps));
    expect(items).toMatchObject([
      { kind: 'action', id: 'repack-page', label: 'Re-pack Page', disabled: false },
      { kind: 'action', id: 'repack-all', label: 'Re-pack All Pages', disabled: false },
    ]);
    const all = items[1]!;
    if (all.kind === 'action') all.onSelect();
    expect(deps.repackAll).toHaveBeenCalledOnce();
    expect(diagramPageMenuItems(buildDiagramPageActions({ flow: true, readOnly: true }, deps))).toMatchObject([
      { kind: 'action', id: 'repack-page', disabled: true, hint: expect.stringMatching(/read-only/) },
      { kind: 'action', id: 'repack-all', disabled: true, hint: expect.stringMatching(/read-only/) },
    ]);
  });
});
