import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RotateCcwSquare } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import {
  FOLD_LINE_MODES,
  FOLD_SINK_TOOLS,
  type FoldRailItemId,
  type FoldShortcutId,
} from '../../fold/tools/foldToolCatalog';
import { foldRailGroups, type FoldToolsView } from '../../fold/tools/foldRailGroups';
import {
  FOLD_DEFAULT_FAVORITE_IDS,
  foldToolFavoriteIds,
  resetFoldToolFavorites,
} from '../../fold/tools/foldToolFavorites';
import { cpToolFavoriteIds, CP_DEFAULT_FAVORITE_ACTION_IDS } from '../../cp-workspace/toolCatalog/cpToolFavorites';
import { CpToolGlyph } from '../../cp-workspace/toolCatalog/cpToolGlyph';
import { cpActionByOperation } from '../../lib/oristudioCpActions';
import { STORAGE_KEYS, storageKey } from '../../lib/storage';
import { allByRole, byRole, queryByRole } from '../../test/roleQueries';
import { TooltipProvider } from '../ui/Tooltip';
import { FoldActionIcon } from './FoldActionIcon';
import { FoldToolGlyph } from './FoldToolGlyph';
import { FoldToolPickerSheet } from './FoldToolPickerSheet';
import { FoldToolRail } from './FoldToolRail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = i18n.t.bind(i18n);

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  localStorage.clear();
  resetFoldToolFavorites();
});

function mount(node: React.ReactNode): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<TooltipProvider delayDuration={0}>{node}</TooltipProvider>));
  return host;
}

function verbs() {
  return { selectTool: vi.fn(), selectLineMode: vi.fn(), turn: vi.fn() };
}

const view: FoldToolsView = { tool: 'valley', lineMode: 'axiom-2', readOnly: null };

describe('FoldToolRail', () => {
  it('draws the usable groups without a Planned section', () => {
    const rail = mount(<FoldToolRail groups={foldRailGroups(t, view, verbs())} />);
    expect(byRole(rail, 'complementary', 'Fold tools')).toBeTruthy();
    const toggles = [...rail.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];
    expect(toggles.map((toggle) => [toggle.textContent, toggle.getAttribute('aria-expanded')])).toEqual([
      ['Fold', 'true'],
      ['Sinks', 'true'],
      ['Reference points', 'true'],
      ['Locate line', 'true'],
      ['Model', 'true'],
      ['Sequence', 'true'],
    ]);
    expect(queryByRole(rail, 'button', 'Planned')).toBeNull();
    // Unfold to step and Repeat are tools on the rail, as every other.
    expect(byRole(rail, 'button', 'Unfold to step').getAttribute('aria-disabled')).not.toBe('true');
    expect(byRole(rail, 'button', 'Repeat').getAttribute('aria-disabled')).not.toBe('true');
    expect(byRole(rail, 'button', 'Pleat').getAttribute('aria-disabled')).not.toBe('true');
    expect(byRole(rail, 'button', 'Precrease').getAttribute('aria-disabled')).not.toBe('true');
    // The crimp, the tuck, the vertex folds and the sinks are tools, open with the other folds.
    expect(byRole(rail, 'button', 'Crimp').getAttribute('aria-disabled')).not.toBe('true');
    expect(byRole(rail, 'button', 'Squash fold').getAttribute('aria-disabled')).not.toBe('true');
    expect(byRole(rail, 'button', 'Unsink').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('takes a tool, a line mode and a model verb from their buttons', () => {
    const calls = verbs();
    const rail = mount(<FoldToolRail groups={foldRailGroups(t, view, calls)} />);
    act(() => byRole(rail, 'button', 'Mountain fold').click());
    act(() => byRole(rail, 'button', 'Reverse fold').click());
    act(() => byRole(rail, 'button', 'Crimp').click());
    expect([...rail.querySelectorAll('button')].some((button) => button.getAttribute('aria-label') === 'Tuck')).toBe(false);
    act(() => byRole(rail, 'button', 'Open sink').click());
    act(() => byRole(rail, 'button', 'Axiom 6: two points onto two lines').click());
    act(() => byRole(rail, 'button', 'Turn over').click());
    expect(calls.selectTool.mock.calls).toEqual([['mountain'], ['inside-reverse'], ['crimp'], ['open-sink']]);
    expect(calls.selectLineMode.mock.calls).toEqual([['axiom-6']]);
    expect(calls.turn).toHaveBeenCalledWith({ kind: 'turn-over', axis: 'vertical' });
    // Shown as the tool and the line mode in hand.
    expect(byRole(rail, 'button', 'Valley fold').hasAttribute('data-active')).toBe(true);
    expect(byRole(rail, 'button', 'Axiom 2: point onto point').hasAttribute('data-active')).toBe(true);
  });

  it('names each tool’s key in its tooltip, from the layout the surface resolves', async () => {
    const keyLabel = (id: FoldShortcutId) => (id === 'fold.toolValley' ? 'V' : undefined);
    const rail = mount(<FoldToolRail groups={foldRailGroups(t, view, verbs())} keyLabel={keyLabel} />);
    await act(async () => byRole(rail, 'button', 'Valley fold').focus());
    const tip = allByRole(document.body, 'tooltip').map((element) => element.textContent);
    expect(tip).toContain('Valley fold (V) - Fold the moving side toward you, so it lands on top.');
  });
});

describe('FoldToolPickerSheet', () => {
  it('names every tool the rail shows, in its groups, and closes on a pick', () => {
    const calls = verbs();
    const close = vi.fn();
    const groups = foldRailGroups(t, view, calls);
    const sheet = mount(<FoldToolPickerSheet pickerId="fold-tools" groups={groups} close={close} />);
    expect(byRole(sheet, 'dialog', 'Fold tools')).toBeTruthy();
    // The starred tools first, then the rail's groups.
    expect([...sheet.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual([
      'Favorites',
      ...groups.map((group) => group.label),
    ]);
    // The same items as the rail, one row each.
    expect([...sheet.querySelectorAll('[data-fold-tool]')].map((row) => row.getAttribute('data-fold-tool'))).toEqual(
      groups.flatMap((group) => group.items.map((item) => item.id))
    );
    act(() => byRole(sheet, 'button', /^Free line/).click());
    expect(calls.selectLineMode).toHaveBeenCalledWith('free');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps unavailable tools disabled in the phone sheet', () => {
    const calls = verbs();
    const close = vi.fn();
    const sheet = mount(<FoldToolPickerSheet pickerId="fold-tools" groups={foldRailGroups(t, { ...view, readOnly: 'locked' }, calls)} close={close} />);
    const row = sheet.querySelector<HTMLButtonElement>('[data-fold-tool="valley"] [data-tool-item]');
    if (!row) throw new Error('no Valley fold row');
    expect(row.getAttribute('aria-disabled')).toBe('true');
    act(() => row.click());
    expect(calls.selectTool).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(sheet.textContent).not.toContain('Planned');
  });

  it('heads the sheet with the starred tools, and a star adds one there without moving its row', () => {
    const calls = verbs();
    const close = vi.fn();
    const sheet = mount(<FoldToolPickerSheet pickerId="fold-tools" groups={foldRailGroups(t, view, calls)} close={close} />);
    const favorites = () =>
      [...sheet.querySelectorAll('[data-fold-favorite]')].map((row) => row.getAttribute('data-fold-favorite'));
    expect(favorites()).toEqual(FOLD_DEFAULT_FAVORITE_IDS);
    // Starring is a shortcut, not a move: Squash fold keeps its row in Fold.
    const star = byRole(sheet, 'button', 'Add Squash fold to favorites');
    expect(star.getAttribute('aria-pressed')).toBe('false');
    act(() => star.click());
    expect(favorites()).toEqual([...FOLD_DEFAULT_FAVORITE_IDS, 'squash']);
    expect(sheet.querySelector('[data-fold-tool="squash"]')).not.toBeNull();
    // A star is not a pick: the sheet stays open.
    expect(close).not.toHaveBeenCalled();
    expect(calls.selectTool).not.toHaveBeenCalled();
    // Un-starred from Favorites, it leaves them.
    const unstar = sheet.querySelector<HTMLButtonElement>('[data-fold-favorite="valley"] [data-favorite-toggle]');
    act(() => unstar?.click());
    expect(favorites()).toEqual(['mountain', 'precrease', 'turn-over', 'squash']);
    expect(foldToolFavoriteIds()).toEqual(['mountain', 'precrease', 'turn-over', 'squash']);
  });

  it('keeps Fold’s favorites apart from Edit’s', () => {
    const sheet = mount(<FoldToolPickerSheet pickerId="fold-tools" groups={foldRailGroups(t, view, verbs())} close={vi.fn()} />);
    act(() => byRole(sheet, 'button', 'Add Squash fold to favorites').click());
    expect(cpToolFavoriteIds()).toEqual(CP_DEFAULT_FAVORITE_ACTION_IDS);
    expect(localStorage.getItem(storageKey(STORAGE_KEYS.foldToolFavorites))).toContain('squash');
    expect(localStorage.getItem(storageKey(STORAGE_KEYS.cpToolFavorites))).toBeNull();
  });
});

describe('FoldToolGlyph', () => {
  it('draws a glyph for every item the rail can show', () => {
    const ids: FoldRailItemId[] = [
      'valley',
      'mountain',
      'inside-reverse',
      'divide-line',
      'turn-over',
      'rotate',
      ...FOLD_SINK_TOOLS,
      ...FOLD_LINE_MODES,
    ];
    const glyphs = mount(
      <>
        {ids.map((id) => (
          <span key={id} data-glyph={id}>
            <FoldToolGlyph id={id} />
          </span>
        ))}
      </>
    );
    for (const id of ids) {
      const glyph = glyphs.querySelector(`[data-glyph="${id}"]`);
      expect(glyph?.firstElementChild, id).not.toBeNull();
      // Decoration: the button around it carries the name.
      expect(glyph?.firstElementChild?.getAttribute('aria-hidden'), id).toBe('true');
    }
    for (const id of ['valley', 'mountain', 'inside-reverse']) {
      expect(glyphs.querySelector(`[data-glyph="${id}"] svg`)).not.toBeNull();
      expect(glyphs.querySelector(`[data-glyph="${id}"]`)?.textContent).toBe('');
    }
  });

  it('draws the rabbit ear as Edit draws its own Rabbit Ear tool, in the rail and compact', () => {
    const edit = cpActionByOperation('Inward');
    expect(edit?.label).toBe('Rabbit Ear');
    if (!edit) return;
    const glyphs = mount(
      <>
        <span data-glyph="fold">
          <FoldToolGlyph id="rabbit-ear" />
        </span>
        <span data-glyph="edit">
          <CpToolGlyph action={edit} />
        </span>
        <span data-glyph="fold-compact">
          <FoldToolGlyph id="rabbit-ear" compact />
        </span>
        <span data-glyph="edit-compact">
          <CpToolGlyph action={edit} compact />
        </span>
      </>
    );
    const html = (name: string) => glyphs.querySelector(`[data-glyph="${name}"]`)?.innerHTML ?? '';
    expect(html('fold')).not.toBe('');
    expect(html('fold')).toBe(html('edit'));
    expect(html('fold-compact')).toBe(html('edit-compact'));
    // Decoration: the button around it carries the name.
    expect(glyphs.querySelector('[data-glyph="fold"]')?.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws Turn over, on the rail and in the menus, as the turn-over icon Edit’s Flip and the Diagram draw', () => {
    const drawn = mount(
      <>
        <span data-glyph="rail">
          <FoldToolGlyph id="turn-over" />
        </span>
        <span data-glyph="menu">
          <FoldActionIcon icon="turn-over" />
        </span>
        <span data-glyph="shared">
          <RotateCcwSquare />
        </span>
      </>
    );
    const paths = (which: string) =>
      [...drawn.querySelectorAll(`[data-glyph="${which}"] svg > *`)].map((shape) => shape.outerHTML);
    expect(paths('shared').length).toBeGreaterThan(0);
    expect(paths('rail')).toEqual(paths('shared'));
    expect(paths('menu')).toEqual(paths('shared'));
  });
});
