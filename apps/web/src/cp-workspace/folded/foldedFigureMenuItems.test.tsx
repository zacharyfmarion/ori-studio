import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureStatus,
} from '../../engine/oristudioCpTypes';
import type { FoldedFigureActionDeps } from './foldedFigureActions';
import { foldedFigureMenuItems } from './foldedFigureMenuItems';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

function makeFigure(
  overrides: Partial<OristudioCpFoldedFigureEntry> = {},
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

  it('gives an exclusive choice radio items, so the current mode is checked', () => {
    const items = foldedFigureMenuItems(makeFigure({ displayStyle: 'Wire2' }), makeDeps());
    const styleMenu = items.find((item) => item.kind === 'submenu' && item.id === 'display-style');

    expect(styleMenu?.kind).toBe('submenu');
    if (styleMenu?.kind !== 'submenu') return;
    expect(styleMenu.items.every((item) => item.kind === 'radio')).toBe(true);
    const checked = styleMenu.items.filter((item) => item.kind === 'radio' && item.checked);
    expect(checked).toHaveLength(1);
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
