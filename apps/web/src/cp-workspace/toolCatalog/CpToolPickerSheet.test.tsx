import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../components/ui/Tooltip';
import {
  ORISTUDIO_CP_ACTIONS,
  type OristudioCpActionDefinition,
} from '../../lib/oristudioCpActions';
import { TOUCH_LABEL_HOLD_MS } from '../../components/ui/useTouchLabel';
import { isShiftLatched, resetShiftLatch } from '../touchModifiers/shiftLatch';
import { CpShiftLatchToggle } from '../touchModifiers/CpShiftLatchToggle';
import { cpRailGroups } from './cpRailActions';
import {
  CP_DEFAULT_FAVORITE_ACTION_IDS,
  cpFavoriteToolActions,
  cpToolFavoriteIds,
  resetCpToolFavorites,
} from './cpToolFavorites';
import { CpToolPickerSheet } from './CpToolPickerSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function stubPointer(coarse: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('pointer: coarse') ? coarse : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  resetShiftLatch();
  resetCpToolFavorites();
  vi.unstubAllGlobals();
});

function renderSheet(
  onSelectAction: (action: OristudioCpActionDefinition) => void = () => {},
  close: () => void = () => {}
): HTMLElement {
  stubPointer(true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider delayDuration={0}>
        <CpToolPickerSheet
          pickerId="tool-picker"
          close={close}
          activeActionId="cp.action.crease-select"
          activeOperationId="CreaseSelect"
          activeLineColor="Red1"
          onSelectAction={onSelectAction}
        />
      </TooltipProvider>
    );
  });
  const sheet = container.querySelector('.cp-tool-picker');
  if (!(sheet instanceof HTMLElement)) throw new Error('no sheet');
  return sheet;
}

describe('CpToolPickerSheet catalogue', () => {
  it('names every tool the rail draws, and nothing the rail does not', () => {
    const sheet = renderSheet();

    // The line types are chips rather than rows -- five one-letter choices cost
    // a third of the sheet as rows -- so they are named by `aria-label`. Reading
    // both is the point: every tool is still reachable *and* still named, which
    // is what this test is for, and a chip that dropped its label would be a
    // regression the row query alone could not see.
    const labels = [
      ...[...sheet.querySelectorAll('.cp-tool-picker__type')].map((node) =>
        node.getAttribute('aria-label')
      ),
      ...[...sheet.querySelectorAll('.cp-tool-picker__label')].map((node) => node.textContent),
    ];
    // Favorites sit between the chips and the groups, and a starred tool keeps
    // its row in its own group as well — starring is a shortcut, not a move. So
    // the six appear twice, and the expectation says so rather than the test
    // scoping them out and quietly stopping checking where they render.
    const railGroups = cpRailGroups();
    const expected = [
      ...railGroups
        .filter((entry) => entry.group.id === 'line-type')
        .flatMap((entry) => entry.actions.map((action) => action.label)),
      ...cpFavoriteToolActions().map((action) => action.label),
      ...railGroups
        .filter((entry) => entry.group.id !== 'line-type')
        .flatMap((entry) => entry.actions.map((action) => action.label)),
    ];

    expect(labels).toEqual(expected);
    // Not a fixed number: the assertion is "the rail's set", and it should
    // follow the catalogue rather than pin it.
    expect(labels.length).toBeGreaterThan(50);
  });

  it('carries the full label, not the truncation the rail cannot avoid', () => {
    const labels = [...renderSheet().querySelectorAll('.cp-tool-picker__label')].map(
      (node) => node.textContent
    );
    expect(labels).toContain('Parallel Alternating Lines');
    expect(labels).toContain('Concentric from two circles');
  });

  it('selects a tool and closes', () => {
    const selected: string[] = [];
    const closed = vi.fn();
    const sheet = renderSheet((action) => selected.push(action.id), closed);

    const rows = [...sheet.querySelectorAll('.cp-tool-picker__item')];
    const eraser = rows.find((row) => row.textContent?.includes('Eraser'));
    if (!(eraser instanceof HTMLElement)) throw new Error('no Eraser row');
    act(() => {
      eraser.click();
    });

    expect(selected).toHaveLength(1);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('refuses a tool that is not ready, rather than hiding it', () => {
    const selected: string[] = [];
    const sheet = renderSheet((action) => selected.push(action.id));

    const notReady = ORISTUDIO_CP_ACTIONS.find(
      (action) =>
        (action.placement === 'left-rail' || action.placement === 'left-rail-overflow') &&
        action.uiStatus !== 'ready'
    );
    if (!notReady) return; // Every rail tool shipped; nothing to assert.

    const rows = [...sheet.querySelectorAll('.cp-tool-picker__item')];
    const row = rows.find((node) => node.textContent?.includes(notReady.label));
    if (!(row instanceof HTMLElement)) throw new Error(`no row for ${notReady.label}`);
    expect(row.getAttribute('aria-disabled')).toBe('true');
    act(() => {
      row.click();
    });
    expect(selected).toHaveLength(0);
  });

  // `aria-modal` hides everything outside this dialog from a screen reader, so a
  // sheet that opens without taking focus leaves VoiceOver parked on the trigger
  // it can no longer see: nothing announced, and the catalogue reachable only by
  // exploring the screen. The View drawer solves it the same way.
  it('takes focus when it opens, so the dialog is what a screen reader is on', () => {
    const sheet = renderSheet();

    const panel = sheet.querySelector('.cp-tool-picker__sheet');
    expect(document.activeElement).toBe(panel);
  });

  it('closes on a backdrop tap', () => {
    const closed = vi.fn();
    const sheet = renderSheet(() => {}, closed);
    act(() => {
      sheet.click();
    });
    expect(closed).toHaveBeenCalledTimes(1);
  });

  // The phone layout hides the rail this used to live in, so the sheet is the
  // only place left that a finger can reach Shift from.
  it('carries the Shift latch, and toggling it does not close the sheet', () => {
    const closed = vi.fn();
    const sheet = renderSheet(() => {}, closed);

    const latch = sheet.querySelector('.cp-tool-rail__latch');
    if (!(latch instanceof HTMLElement)) throw new Error('no latch in the sheet');
    act(() => {
      latch.click();
    });

    expect(isShiftLatched()).toBe(true);
    expect(closed).not.toHaveBeenCalled();
  });
});

describe('CpToolPickerSheet favorites', () => {
  const ROW_HEIGHT = 40;

  function favoriteRows(sheet: HTMLElement): HTMLElement[] {
    return [...sheet.querySelectorAll<HTMLElement>('[data-cp-favorite]')];
  }

  function favoriteLabels(sheet: HTMLElement): (string | null)[] {
    return favoriteRows(sheet).map(
      (row) => row.querySelector('.cp-tool-picker__label')?.textContent ?? null
    );
  }

  function starFor(sheet: HTMLElement, label: string): HTMLElement {
    const row = [...sheet.querySelectorAll<HTMLElement>('.cp-tool-picker__row')].find(
      (node) => node.querySelector('.cp-tool-picker__label')?.textContent === label
    );
    const star = row?.querySelector<HTMLElement>('.cp-tool-picker__star');
    if (!star) throw new Error(`no star for ${label}`);
    return star;
  }

  it('shows the six shipped defaults, in order', () => {
    const sheet = renderSheet();
    expect(favoriteRows(sheet)).toHaveLength(6);
    expect(favoriteLabels(sheet)).toEqual(
      cpFavoriteToolActions().map((action) => action.label)
    );
  });

  // Between the crease types and every tool group. The types are the one group
  // that is not a tool, and the thing the rest hangs off.
  it('sits directly below the crease types', () => {
    const sheet = renderSheet();
    const sections = [...sheet.querySelectorAll('.cp-tool-picker__group')];
    const titles = sections.map((node) =>
      node.querySelector('.cp-tool-picker__group-title')?.textContent
    );
    expect(titles[0]).toBe('Line type');
    expect(titles[1]).toBe('Favorites');
    expect(sections[1].querySelectorAll('[data-cp-favorite]')).toHaveLength(6);
  });

  it('gives every tool row a star, and the crease-type chips none', () => {
    const sheet = renderSheet();
    expect(sheet.querySelectorAll('.cp-tool-picker__row').length).toBe(
      sheet.querySelectorAll('.cp-tool-picker__star').length
    );
    for (const chip of sheet.querySelectorAll('.cp-tool-picker__type')) {
      expect(chip.querySelector('.cp-tool-picker__star')).toBeNull();
    }
  });

  /*
   * The failure the row restructure exists to prevent. While the row was one
   * `<button>` end to end, a star inside it could not be tapped separately — the
   * outer control took the tap and selected the tool.
   */
  it('stars a tool without selecting it or closing the sheet', () => {
    const selected: string[] = [];
    const closed = vi.fn();
    const sheet = renderSheet((action) => selected.push(action.id), closed);

    act(() => {
      starFor(sheet, 'Angle Bisector').click();
    });

    expect(cpToolFavoriteIds()).toContain('cp.action.square-bisector');
    expect(selected).toEqual([]);
    expect(closed).not.toHaveBeenCalled();
  });

  it('un-stars from the favorites section', () => {
    const sheet = renderSheet();
    const [firstFavorite] = cpFavoriteToolActions();

    act(() => {
      favoriteRows(sheet)[0]
        .querySelector<HTMLElement>('.cp-tool-picker__star')
        ?.click();
    });

    expect(cpToolFavoriteIds()).not.toContain(firstFavorite.id);
    expect(favoriteRows(sheet)).toHaveLength(5);
  });

  // The same action renders twice, so its two stars must not disagree.
  it('keeps both copies of a starred tool in the same state', () => {
    const sheet = renderSheet();
    const label = cpFavoriteToolActions()[0].label;
    const stars = [...sheet.querySelectorAll<HTMLElement>('.cp-tool-picker__row')]
      .filter((row) => row.querySelector('.cp-tool-picker__label')?.textContent === label)
      .map((row) => row.querySelector('.cp-tool-picker__star'));

    expect(stars).toHaveLength(2);
    for (const star of stars) expect(star?.getAttribute('aria-pressed')).toBe('true');

    act(() => {
      stars[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(sheet.querySelectorAll('[data-cp-favorite]')).toHaveLength(5);
  });

  it('selects from the favorites section and closes, like any other row', () => {
    const selected: string[] = [];
    const closed = vi.fn();
    const sheet = renderSheet((action) => selected.push(action.id), closed);

    act(() => {
      favoriteRows(sheet)[0].querySelector<HTMLElement>('.cp-tool-picker__item')?.click();
    });

    expect(selected).toEqual([cpFavoriteToolActions()[0].id]);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('disappears entirely once nothing is starred', () => {
    const sheet = renderSheet();
    for (const id of [...CP_DEFAULT_FAVORITE_ACTION_IDS]) {
      const label = cpFavoriteToolActions().find((action) => action.id === id)?.label;
      if (!label) continue;
      act(() => {
        starFor(sheet, label).click();
      });
    }

    expect(cpToolFavoriteIds()).toEqual([]);
    expect(favoriteRows(sheet)).toHaveLength(0);
    expect(
      [...sheet.querySelectorAll('.cp-tool-picker__group-title')].map((node) => node.textContent)
    ).not.toContain('Favorites');
  });

  /*
   * A phone has no keyboard, so a row spends its width on the tool and nothing
   * else: no chord badge naming a key the device cannot press, and no move
   * buttons offering a pointer-free route it does not need.
   */
  it('carries neither a shortcut badge nor move buttons', () => {
    const sheet = renderSheet();
    expect(sheet.querySelector('.cp-tool-picker__shortcut')).toBeNull();
    expect(sheet.querySelector('.cp-tool-picker__move-button')).toBeNull();
    expect(sheet.querySelector('kbd')).toBeNull();
  });

  /*
   * The drag, end to end through the store. jsdom has no layout, so each row's
   * rect is stubbed from its index — that geometry is the whole of what the hit
   * test consults.
   */
  it('reorders on a long press and drag, without selecting the tool', () => {
    vi.useFakeTimers();
    try {
      const selected: string[] = [];
      const closed = vi.fn();
      const sheet = renderSheet((action) => selected.push(action.id), closed);
      const before = favoriteLabels(sheet);

      favoriteRows(sheet).forEach((row, index) => {
        const top = index * ROW_HEIGHT;
        row.getBoundingClientRect = () =>
          ({ top, bottom: top + ROW_HEIGHT, left: 0, right: 100 }) as DOMRect;
      });

      const source = favoriteRows(sheet)[0];
      act(() => {
        source.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            button: 0,
            pointerType: 'touch',
            clientX: 0,
            clientY: ROW_HEIGHT / 2,
          })
        );
      });
      act(() => {
        vi.advanceTimersByTime(TOUCH_LABEL_HOLD_MS);
      });
      act(() => {
        window.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            clientX: 0,
            clientY: 2 * ROW_HEIGHT + ROW_HEIGHT / 2,
          })
        );
      });
      act(() => {
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      });

      expect(favoriteLabels(sheet)).toEqual([before[1], before[2], before[0], ...before.slice(3)]);

      // The press that moved it must not also pick it. Without the consumed
      // click, letting go selects the tool and closes the sheet mid-reorder.
      act(() => {
        favoriteRows(sheet)[2]
          .querySelector<HTMLElement>('.cp-tool-picker__item')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(selected).toEqual([]);
      expect(closed).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CpShiftLatchToggle', () => {
  function renderToggle(coarse: boolean): HTMLDivElement {
    stubPointer(coarse);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<CpShiftLatchToggle />);
    });
    return container;
  }

  it('is absent on a fine pointer, which has the key', () => {
    expect(renderToggle(false).querySelector('.cp-tool-rail__latch')).toBeNull();
  });

  it('latches and unlatches, and says which it is', () => {
    const host = renderToggle(true);
    const button = host.querySelector('.cp-tool-rail__latch');
    if (!(button instanceof HTMLElement)) throw new Error('no latch');

    expect(button.getAttribute('aria-pressed')).toBe('false');
    act(() => {
      button.click();
    });
    expect(isShiftLatched()).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('data-active')).toBe('true');

    act(() => {
      button.click();
    });
    expect(isShiftLatched()).toBe(false);
    expect(button.getAttribute('data-active')).toBeNull();
  });
});
