import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureStatus,
} from '../../engine/oristudioCpTypes';
import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import { buildFoldedFigureActions, type FoldedFigureActionDeps } from './foldedFigureActions';
import { foldedFigureMenuItems, styleMenuItems } from './foldedFigureMenuItems';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

function makeFigure(
  overrides: Partial<OristudioCpFoldedFigureEntry> = {}
): OristudioCpFoldedFigureEntry {
  const status: OristudioCpFoldedFigureStatus = 'ready';
  return {
    id: 'folded-1',
    title: 'Folded model 1',
    handle: 3,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status,
    snapshot: {
      model: { state: 'Front0' },
      find_another_overlap_valid: true,
      discovered_fold_cases: 3,
      current_fold_case: 3,
    },
    renderSnapshot: {},
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    error: null,
    ...overrides,
  } as unknown as OristudioCpFoldedFigureEntry;
}

function makeDeps(overrides: Partial<FoldedFigureActionDeps> = {}): FoldedFigureActionDeps {
  return {
    t,
    flip: vi.fn(),
    resetView: vi.fn(),
    setUpright: vi.fn(),
    setDisplayStyle: vi.fn(),
    updateModel: vi.fn(),
    endModelGesture: vi.fn(),
    foldAnother: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}

describe('foldedFigureMenuItems', () => {
  it('renders commands as actions and choice groups as submenus', () => {
    const items = foldedFigureMenuItems(makeFigure(), makeDeps());
    const kinds = new Set(items.map((item) => item.kind));

    expect(kinds.has('action')).toBe(true);
    expect(kinds.has('submenu')).toBe(true);
  });

  function styleMenu(items: ContextMenuItem[]) {
    const found = items.find((item) => item.kind === 'submenu' && item.id === 'style');
    if (found?.kind !== 'submenu') throw new Error('no Style submenu');
    return found;
  }

  it('nests the Style group as one submenu: two picks, three colours, one switch', () => {
    const items = styleMenu(foldedFigureMenuItems(makeFigure(), makeDeps())).items;
    expect(items.map((item) => (item.kind === 'separator' ? '—' : `${item.kind}:${item.id}`))).toEqual([
      'submenu:display-style',
      'submenu:side',
      '—',
      'color:front-color',
      'color:back-color',
      'color:line-color',
      '—',
      'checkbox:shadow',
    ]);
  });

  it('gives an exclusive choice radio items, so the current mode is checked', () => {
    const items = styleMenu(foldedFigureMenuItems(makeFigure({ displayStyle: 'Wire2' }), makeDeps())).items;
    const renderAs = items.find((item) => item.kind === 'submenu' && item.id === 'display-style');

    expect(renderAs?.kind).toBe('submenu');
    if (renderAs?.kind !== 'submenu') return;
    expect(renderAs.items.every((item) => item.kind === 'radio')).toBe(true);
    const checked = renderAs.items.filter((item) => item.kind === 'radio' && item.checked);
    expect(checked).toHaveLength(1);
  });

  // The context menu builds its rows once at open, so a row kept open would go
  // on showing the state it was built with. Its picks close it, as a context
  // menu's picks do everywhere; the toolbar asks for the opposite explicitly.
  it('closes on a pick in the context menu, and stays open only where asked', () => {
    const items = foldedFigureMenuItems(makeFigure(), makeDeps({ exportAs: vi.fn() }));
    const style = styleMenu(items).items;
    for (const item of style) {
      if (item.kind === 'submenu') {
        expect(item.items.every((row) => row.kind === 'radio' && !row.keepOpen)).toBe(true);
      }
      if (item.kind === 'checkbox') expect(item.keepOpen).toBeFalsy();
    }
    const exportMenu = items.find((item) => item.kind === 'submenu' && item.id === 'export');
    if (exportMenu?.kind !== 'submenu') throw new Error('no export submenu');
    expect(exportMenu.items.every((row) => row.kind === 'action')).toBe(true);

    const group = buildFoldedFigureActions(makeFigure(), makeDeps()).find(
      (action) => action.kind === 'group'
    );
    if (group?.kind !== 'group') throw new Error('no Style group');
    const kept = styleMenuItems(group, { keepOpen: true });
    for (const item of kept) {
      if (item.kind === 'submenu') {
        expect(item.items.every((row) => row.kind === 'radio' && row.keepOpen === true)).toBe(true);
      }
      if (item.kind === 'checkbox') expect(item.keepOpen).toBe(true);
    }
  });

  it('routes a colour row and the shadow row to the model bindings', () => {
    const deps = makeDeps();
    const figure = makeFigure({
      snapshot: {
        model: { state: 'Front0', display_shadows: false },
        find_another_overlap_valid: true,
      },
    } as unknown as Partial<OristudioCpFoldedFigureEntry>);
    const style = styleMenu(foldedFigureMenuItems(figure, deps)).items;
    const front = style.find((item) => item.kind === 'color' && item.id === 'front-color');
    const shadow = style.find((item) => item.kind === 'checkbox');
    if (front?.kind !== 'color' || shadow?.kind !== 'checkbox') throw new Error('rows missing');

    front.onChange('#010203');
    front.onCommit();
    shadow.onToggle();

    expect(deps.updateModel).toHaveBeenNthCalledWith(
      1,
      figure,
      { front_color: { red: 1, green: 2, blue: 3 } },
      { scope: 'folded-color:folded-1:front_color', label: 'Change folded model color' }
    );
    expect(deps.endModelGesture).toHaveBeenCalledWith('folded-color:folded-1:front_color');
    expect(deps.updateModel).toHaveBeenNthCalledWith(2, figure, { display_shadows: true });
  });

  it('invokes the bound verb when an item is selected', () => {
    const remove = vi.fn();
    const figure = makeFigure();
    const items = foldedFigureMenuItems(figure, makeDeps({ remove }));
    const del = items.find((item) => item.kind === 'action' && item.id === 'delete');

    expect(del?.kind).toBe('action');
    if (del?.kind !== 'action') return;
    del.onSelect();
    expect(remove).toHaveBeenCalledWith(figure);
  });
});
