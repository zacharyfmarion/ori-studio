import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../engines/designHandles', () => ({
  acquireDesignHandle: vi.fn(async () => 1),
  withDesignHandle: vi.fn(),
  serializeDesign: vi.fn(async () => 'serialized-design'),
  parkDesign: vi.fn(async () => undefined),
  forgetDesign: vi.fn(async () => undefined),
  adoptDesign: vi.fn(),
  isDesignHot: vi.fn(() => false),
  hotDesignIds: vi.fn(() => []),
  subscribeToDesignHandles: vi.fn(() => () => undefined),
}));

const { useWorkspaceStore } = await import('../../store/workspaceStore');
const { DEFAULT_DESIGN_TITLE, resetDesignTabIds } = await import(
  '../../store/workspaceStore/designTabs'
);
const { TooltipProvider } = await import('../ui/Tooltip');
const { DesignTabStrip } = await import('./DesignTabStrip');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider delayDuration={0}>
        <DesignTabStrip />
      </TooltipProvider>
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDesignTabIds();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const store = () => useWorkspaceStore.getState();
const tabEls = () => Array.from(document.querySelectorAll<HTMLElement>('[data-design-tab]'));
const triggers = () => Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
const tabTitles = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.design-tab__title')).map(
    (element) => element.textContent
  );

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** Radix activates a tab on mousedown, not click. */
function pressTab(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
}

/** jsdom has no PointerEvent; React routes by type, and MouseEvent carries clientX. */
function pointer(target: EventTarget, type: string, clientX: number) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX }));
  });
}

/** Lay the strip out: jsdom reports every rect as zero, so the hit-test needs help. */
function layOutTabs(widthPx = 100) {
  tabEls().forEach((element, index) => {
    element.getBoundingClientRect = () =>
      ({ left: index * widthPx, right: (index + 1) * widthPx }) as DOMRect;
  });
}

function addTabs(count: number) {
  act(() => {
    for (let index = 0; index < count; index += 1) store().addDesignTab();
  });
}

describe('DesignTabStrip', () => {
  it('exposes one tab per design with the active one selected', () => {
    addTabs(2);
    const [first, , third] = store().designTabs.map((tab) => tab.id);
    act(() => store().activateDesignTab(first));
    render();

    expect(triggers()).toHaveLength(3);
    expect(document.querySelector('[role="tablist"]')).not.toBeNull();
    expect(triggers()[0].getAttribute('aria-selected')).toBe('true');
    expect(triggers()[2].getAttribute('aria-selected')).toBe('false');
    expect(third).toBe(store().designTabs[2].id);
  });

  it('activates a design when its tab is clicked', () => {
    addTabs(1);
    const [first] = store().designTabs.map((tab) => tab.id);
    render();

    pressTab(triggers()[0]);

    expect(store().activeDesignId).toBe(first);
  });

  it('keeps the close button outside the tab role', () => {
    // A focusable control inside `role="tab"` is invalid ARIA and unreachable by
    // keyboard — the tab swallows it. This is the regression guard for that.
    addTabs(1);
    render();

    const closeButtons = document.querySelectorAll('.design-tab__close');
    expect(closeButtons).toHaveLength(2);
    for (const button of closeButtons) {
      expect(button.closest('[role="tab"]')).toBeNull();
      expect(button.closest('[data-design-tab]')).not.toBeNull();
    }
  });

  it('closes a design from its close button', () => {
    addTabs(1);
    const [first, second] = store().designTabs.map((tab) => tab.id);
    render();

    click(document.querySelectorAll('.design-tab__close')[0]);

    expect(store().designTabs.map((tab) => tab.id)).toEqual([second]);
    expect(first).not.toBe(second);
  });

  it('hides the close button on a lone untouched design', () => {
    // Closing it would swap one empty chooser tab for an identical one.
    render();
    expect(document.querySelector('.design-tab__close')).toBeNull();
  });

  it('adds a design from the strip', () => {
    render();
    const add = document.querySelector('.design-tab-strip__add');
    expect(add).not.toBeNull();

    click(add as Element);

    expect(store().designTabs).toHaveLength(2);
  });
});

describe('inline rename', () => {
  function startRename(index = 0) {
    act(() => {
      tabEls()[index].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const input = document.querySelector<HTMLInputElement>('.design-tab__name-input');
    if (!input) throw new Error('rename input did not mount');
    return input;
  }

  function type(input: HTMLInputElement, value: string) {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function key(input: HTMLInputElement, name: string) {
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
    });
  }

  /** React's `onBlur` listens for `focusout`, which is the one that bubbles. */
  function blur(input: HTMLInputElement) {
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
  }

  it('replaces the trigger rather than nesting an input inside it', () => {
    render();
    const input = startRename();

    // A disabled trigger wrapping the input would swallow its pointer events;
    // the input has to *be* the tab's content while renaming.
    expect(input.closest('[role="tab"]')).toBeNull();
    expect(triggers()).toHaveLength(0);
  });

  it('commits on Enter', () => {
    render();
    const input = startRename();
    type(input, 'Crane');
    key(input, 'Enter');

    expect(tabTitles()).toEqual(['Crane']);
    expect(store().designTabs[0].title).toBe('Crane');
  });

  it('discards on Escape', () => {
    render();
    const input = startRename();
    type(input, 'Crane');
    key(input, 'Escape');

    expect(store().designTabs[0].title).toBe(DEFAULT_DESIGN_TITLE);
  });

  it('commits once when Enter is followed by the blur it causes', () => {
    // Enter moves focus off the field, so a naive commit-on-both would write
    // twice — two undo-worthy edits and two dirty marks for one rename.
    const rename = vi.fn(useWorkspaceStore.getState().renameDesignTab);
    useWorkspaceStore.setState({ renameDesignTab: rename });
    render();
    const input = startRename();
    type(input, 'Crane');
    key(input, 'Enter');
    blur(input);

    expect(store().designTabs[0].title).toBe('Crane');
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it('commits on blur when focus leaves without a key', () => {
    render();
    const input = startRename();
    type(input, 'Kabuto');
    blur(input);

    expect(store().designTabs[0].title).toBe('Kabuto');
  });
});

describe('drag reorder', () => {
  it('reorders as the pointer crosses a neighbour', () => {
    addTabs(2);
    const ids = store().designTabs.map((tab) => tab.id);
    render();
    layOutTabs();

    pointer(tabEls()[0], 'pointerdown', 10);
    pointer(window, 'pointermove', 150);
    pointer(window, 'pointerup', 150);

    expect(store().designTabs.map((tab) => tab.id)).toEqual([ids[1], ids[0], ids[2]]);
  });

  it('does not reorder on a click that never moves', () => {
    addTabs(1);
    const ids = store().designTabs.map((tab) => tab.id);
    render();
    layOutTabs();

    pointer(tabEls()[0], 'pointerdown', 10);
    pointer(window, 'pointermove', 12);
    pointer(window, 'pointerup', 12);

    expect(store().designTabs.map((tab) => tab.id)).toEqual(ids);
  });

  it('tracks the tab across successive moves rather than its starting index', () => {
    // The dragged tab's index changes the moment the first reorder lands. A
    // handler that compared against the pointerdown index would treat every
    // later move as a fresh reorder and oscillate.
    addTabs(2);
    const ids = store().designTabs.map((tab) => tab.id);
    render();
    layOutTabs();

    pointer(tabEls()[0], 'pointerdown', 10);
    pointer(window, 'pointermove', 150);
    act(() => layOutTabs());
    pointer(window, 'pointermove', 250);
    pointer(window, 'pointerup', 250);

    expect(store().designTabs.map((tab) => tab.id)).toEqual([ids[1], ids[2], ids[0]]);
  });

  it('stops listening after the gesture ends', () => {
    addTabs(1);
    render();
    layOutTabs();

    pointer(tabEls()[0], 'pointerdown', 10);
    pointer(window, 'pointermove', 150);
    pointer(window, 'pointerup', 150);
    const afterDrag = store().designTabs.map((tab) => tab.id);

    pointer(window, 'pointermove', 10);

    expect(store().designTabs.map((tab) => tab.id)).toEqual(afterDrag);
  });
});

/**
 * A tab that only responds where its label is.
 *
 * The trigger was sized to its content inside a 32px tab, so the strips above
 * and below the text — and the gap beside the close button — hit the wrapper
 * instead and did nothing. jsdom does no layout, so a rendered click cannot
 * catch this; what is checkable is the rule the hit area depends on: **the
 * element carrying `role="tab"` fills its wrapper, and nothing else in the tab
 * takes flow space away from it except the close button.**
 */
const themeCss = readFileSync(
  join(dirname(new URL(import.meta.url).pathname), '../../styles/theme.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

/** The declaration block of the rule whose selector is exactly `selector`. */
function declarations(selector: string): string {
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(themeCss)) !== null) {
    if (match[1].trim() === selector) return match[2];
  }
  throw new Error(`no rule for ${selector}`);
}

describe('the tab hit area', () => {
  it('stretches the trigger over the whole tab', () => {
    const trigger = declarations('.design-tab__trigger');

    // Vertically: the tab is taller than a 12px line of text.
    expect(trigger).toMatch(/align-self:\s*stretch/);
    // Horizontally: any width the wrapper has and the trigger does not want.
    expect(trigger).toMatch(/flex:\s*1\b/);
  });

  it('floats the close button over the trigger instead of beside it', () => {
    // As a flex sibling the close was an 18px box in a 32px tab, carving dead
    // strips directly above and below itself. Out of flow, the trigger runs the
    // full height underneath it and only the button itself is not the tab.
    expect(declarations('.design-tab__close')).toMatch(/position:\s*absolute/);
    // Which only lands inside the tab if the tab is its containing block.
    expect(declarations('.design-tab')).toMatch(/position:\s*relative/);
  });
});

/**
 * The tab's two ends.
 *
 * Nothing here is visible to jsdom — it does no layout, so the only thing a test
 * can hold is the shape of the rules the spacing comes out of. Both regressions
 * these cover were invisible in code review and obvious on screen.
 */
describe('the horizontal gutter', () => {
  it('insets both ends of the trigger from one value', () => {
    // Written as two literals, the sides drifted: the label sat 12px from the
    // tab's left edge and 4px from its right.
    expect(declarations('.design-tab__trigger')).toMatch(
      /padding:\s*0\s+var\(--design-tab-pad-x\)\s*;/
    );
    // And the close button is the right end of that same gutter, not its own
    // spacing decision.
    expect(declarations('.design-tab__close')).toMatch(/right:\s*var\(--design-tab-close-inset\)/);
    expect(declarations('.design-tab')).toMatch(/--design-tab-close-inset:\s*calc\(/);
  });

  it('reserves room for the close button at its real inset', () => {
    // The label is ellipsized against this padding, so it has to cover where the
    // button actually sits. Reserving only the button's own width let a long
    // title run under it once the inset grew.
    expect(declarations('.design-tab:has(.design-tab__close) .design-tab__trigger')).toMatch(
      /padding-right:\s*calc\(\s*var\(--design-tab-close-inset\)\s*\+\s*var\(--design-tab-close-size\)/
    );
  });

  it('zeroes the close button so its glyph can centre', () => {
    // Not redundant with `place-items: center`. A button carries `padding: 1px
    // 6px` from the UA sheet, which under `border-box` leaves the 18px box a 6px
    // content box; the 12px icon overflows it, and Chrome resolves that overflow
    // to one side — the X rendered flush against the button's right edge.
    expect(declarations('.design-tab__close')).toMatch(/padding:\s*0\s*;/);
  });
});

describe('context menu', () => {
  function openMenu(index = 0) {
    act(() => {
      tabEls()[index].dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })
      );
    });
    return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  it('offers the keyboard route to reordering', () => {
    // Drag alone is not reachable without a pointer, so these are the accessible
    // equivalent, not a convenience.
    addTabs(2);
    render();
    const items = openMenu(1);
    const labels = items.map((item) => item.textContent);

    expect(labels).toContain('Move left');
    expect(labels).toContain('Move right');
  });

  it('disables the move that would run off the end', () => {
    addTabs(1);
    render();
    const first = openMenu(0);
    const byLabel = (items: HTMLElement[], label: string) =>
      items.find((item) => item.textContent === label);

    expect(byLabel(first, 'Move left')?.getAttribute('data-disabled')).not.toBeNull();
    expect(byLabel(first, 'Move right')?.getAttribute('data-disabled')).toBeNull();
  });

  it('moves a design with the menu', () => {
    addTabs(1);
    const ids = store().designTabs.map((tab) => tab.id);
    render();
    const items = openMenu(0);
    click(items.find((item) => item.textContent === 'Move right') as Element);

    expect(store().designTabs.map((tab) => tab.id)).toEqual([ids[1], ids[0]]);
  });

  it('refuses to duplicate a design that has chosen no method', () => {
    render();
    const items = openMenu(0);
    const duplicate = items.find((item) => item.textContent === 'Duplicate');

    expect(duplicate?.getAttribute('data-disabled')).not.toBeNull();
  });

  it('starts a rename from the menu, and keeps focus in the field', async () => {
    // The rename cannot start inside `onSelect`: the menu's focus trap is still
    // armed there and pulls focus straight back out of the field, blurring it
    // and ending the rename before a key is pressed. It starts once the menu
    // releases focus instead.
    render();
    const items = openMenu(0);
    click(items.find((item) => item.textContent === 'Rename') as Element);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const input = document.querySelector<HTMLInputElement>('.design-tab__name-input');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });
});
