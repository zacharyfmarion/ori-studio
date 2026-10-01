import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORISTUDIO_CP_LINE_TYPE_ACTIONS } from '../../lib/oristudioCpActions';
import { storageKey, STORAGE_KEYS } from '../../lib/storage';
import { resetShiftLatch } from '../../cp-workspace/touchModifiers/shiftLatch';
import { PHONE_MEDIA_QUERY } from '../../platform/phoneLayout';
import { TOUCH_LABEL_HOLD_MS } from '../ui/useTouchLabel';
import { TooltipProvider } from '../ui/Tooltip';
import { CpToolRail } from './CpToolRail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAIL_GROUPS_KEY = storageKey(STORAGE_KEYS.cpToolRailGroups);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  localStorage.clear();
  resetShiftLatch();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * The rail's touch affordances are gated on the primary pointer, and jsdom has
 * no opinion about one. Stubbed rather than mocked away so the fine-pointer
 * assertions run through the same code path the desktop does.
 *
 * The two queries are answered independently, because the rail's touch header
 * turns on for one and off for the other: a tablet is coarse and keeps it, and a
 * phone hides the whole rail and moves the latch into the tool sheet. Defaulting
 * `phone` to false makes the unqualified coarse case the tablet, which is the
 * only device that renders this header at all.
 */
function stubPointer(coarse: boolean, phone = false) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches:
        query === PHONE_MEDIA_QUERY ? phone : query.includes('pointer: coarse') ? coarse : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

function renderRail(
  active: Partial<CpToolRailActive> = {},
  onSelectAction: ComponentProps<typeof CpToolRail>['onSelectAction'] = () => {},
  editable = true
): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider delayDuration={0}>
        <CpToolRail
          activeActionId={active.activeActionId ?? null}
          activeOperationId={active.activeOperationId ?? null}
          activeLineColor="Red1"
          editable={editable}
          onSelectAction={onSelectAction}
        />
      </TooltipProvider>
    );
  });
  return container;
}

type CpToolRailActive = Pick<
  ComponentProps<typeof CpToolRail>,
  'activeActionId' | 'activeOperationId'
>;

function buttonFor(host: HTMLDivElement, label: string): HTMLElement {
  const button = host.querySelector(`[aria-label="${label}"]`);
  if (!(button instanceof HTMLElement)) throw new Error(`Missing rail button ${label}`);
  return button;
}

function groupToggle(host: HTMLDivElement, groupId: string): HTMLElement {
  const toggle = host.querySelector(`[aria-controls="cp-tool-rail-group-${groupId}"]`);
  if (!(toggle instanceof HTMLElement)) throw new Error(`no rail toggle for group ${groupId}`);
  return toggle;
}

function isExpanded(host: HTMLDivElement, groupId: string): boolean {
  return groupToggle(host, groupId).getAttribute('aria-expanded') === 'true';
}

function hasButtons(host: HTMLDivElement, groupId: string): boolean {
  return host.querySelector(`#cp-tool-rail-group-${groupId}`) !== null;
}

function remount(): HTMLDivElement {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  return renderRail();
}

describe('CpToolRail collapsible groups', () => {
  it('opens every group by default except the ones marked collapsed', () => {
    const host = renderRail();

    expect(isExpanded(host, 'select-edit')).toBe(true);
    expect(hasButtons(host, 'select-edit')).toBe(true);
    expect(isExpanded(host, 'advanced')).toBe(false);
    expect(hasButtons(host, 'advanced')).toBe(false);
  });

  it('persists each group independently and restores it on the next render', () => {
    const host = renderRail();

    act(() => {
      groupToggle(host, 'advanced').click();
      groupToggle(host, 'select-edit').click();
    });

    expect(hasButtons(host, 'advanced')).toBe(true);
    expect(hasButtons(host, 'select-edit')).toBe(false);
    expect(JSON.parse(localStorage.getItem(RAIL_GROUPS_KEY) ?? '{}')).toEqual({
      advanced: true,
      'select-edit': false,
    });

    const remounted = remount();
    expect(isExpanded(remounted, 'advanced')).toBe(true);
    expect(isExpanded(remounted, 'select-edit')).toBe(false);
  });
});

// Extend Line and Divided Line are one button each over two kernel operations.
// The button draws the variant its mode currently resolves to, so which mode is
// armed is readable from the rail without opening the context panel.
describe('CpToolRail merged tools', () => {
  it('shows one button per merged pair, not one per operation', () => {
    const host = renderRail();

    expect(host.querySelector('[aria-label="Extend Line"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Divided Line"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Lengthen by Same Color"]')).toBeNull();
    expect(host.querySelector('[aria-label="Divided Line (ratio)"]')).toBeNull();
  });

  it('draws the resolved variant glyph while the tool is active', () => {
    const asCount = renderRail({
      activeActionId: 'cp.action.line-segment-division',
      activeOperationId: 'LineSegmentDivision',
    });
    expect(buttonFor(asCount, 'Divided Line').textContent).toBe('\uE011');

    act(() => {
      root?.unmount();
    });
    container?.remove();

    const asRatio = renderRail({
      activeActionId: 'cp.action.line-segment-division',
      activeOperationId: 'LineSegmentRatioSet',
    });
    expect(buttonFor(asRatio, 'Divided Line').textContent).toBe('\uE044');
  });

  it('falls back to its own glyph when another tool is active', () => {
    const host = renderRail({
      activeActionId: 'cp.action.draw-crease',
      activeOperationId: 'DrawCreaseFree',
    });
    expect(buttonFor(host, 'Divided Line').textContent).toBe('\uE011');
  });
});

/*
 * The rail is 52 icon-only tools whose only visible label is a Radix tooltip,
 * and Radix deliberately has no touch path for one. Press-and-hold is how a
 * finger gets the label instead, and it takes none of the rail's width.
 *
 * The rail also carries the Shift latch, which is the one modifier a device with
 * no keyboard cannot otherwise have.
 */
describe('CpToolRail touch affordances', () => {
  it('adds nothing to the rail on a fine pointer', () => {
    stubPointer(false);
    const host = renderRail();

    expect(host.querySelector('[data-rail-part="touch-header"]')).toBeNull();
    expect(host.querySelector('[data-shift-latch]')).toBeNull();
  });

  it('offers the Shift latch on a tablet', () => {
    stubPointer(true);
    const host = renderRail();

    expect(host.querySelector('[data-shift-latch]')).not.toBeNull();
  });

  // The phone layout hides this rail and puts the latch in the tool sheet that
  // replaces it. Rendering one here too would be two buttons over one
  // module-level latch, with the invisible one able to disagree.
  it('leaves the latch to the tool sheet on a phone', () => {
    stubPointer(true, true);
    const host = renderRail();

    expect(host.querySelector('[data-rail-part="touch-header"]')).toBeNull();
    expect(host.querySelector('[data-shift-latch]')).toBeNull();
  });

  it('keeps the button grid exactly as wide as it was', () => {
    stubPointer(true);
    const host = renderRail();

    // The affordances are rows above the grid, not columns beside it: the
    // iPad's constraint is horizontal, and a rail that got wider to fit labels
    // would trade one problem for another.
    const header = host.querySelector('[data-rail-part="touch-header"]');
    const buttons = host.querySelector('[data-group]');
    expect(header?.contains(buttons ?? null)).toBe(false);
    expect(header?.nextElementSibling?.getAttribute('data-rail-part')).toBe('groups');
  });

  it('names a tool on a press-and-hold without arming it', () => {
    vi.useFakeTimers();
    stubPointer(true);
    const selected: string[] = [];
    const host = renderRail({}, (action) => selected.push(action.id));
    const button = buttonFor(host, 'Eraser');

    act(() => {
      button.dispatchEvent(touchPointer('pointerdown'));
    });
    act(() => {
      vi.advanceTimersByTime(TOUCH_LABEL_HOLD_MS);
    });
    expect(document.querySelector('.tooltip-content')?.textContent).toContain('Eraser');

    act(() => {
      button.dispatchEvent(touchPointer('pointerup'));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // The press that asked what a tool is must not also select it — that is the
    // difference between this and the canvas long-press that was removed.
    expect(selected).toEqual([]);
  });

  it('still selects a tool on a plain tap', () => {
    vi.useFakeTimers();
    stubPointer(true);
    const selected: string[] = [];
    const host = renderRail({}, (action) => selected.push(action.id));
    const button = buttonFor(host, 'Eraser');

    act(() => {
      button.dispatchEvent(touchPointer('pointerdown'));
      button.dispatchEvent(touchPointer('pointerup'));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(selected).toHaveLength(1);
  });
});

/*
 * The line types are one segmented control rather than five tool buttons, and
 * each option keeps what a tool button gives it: its name, a hold that names it
 * without choosing it, and a refusal while nothing is editable.
 */
describe('CpToolRail line types', () => {
  const valley = ORISTUDIO_CP_LINE_TYPE_ACTIONS.find((action) => action.lineColor === 'Blue2');

  const lineTypes = (host: HTMLDivElement) =>
    host.querySelectorAll<HTMLButtonElement>(
      '#cp-tool-rail-group-line-type [role="group"] button'
    );

  it('are one labelled group that presses the active type', () => {
    const host = renderRail();
    const pressed = [...lineTypes(host)].map((button) => [
      button.getAttribute('aria-label'),
      button.getAttribute('aria-pressed'),
    ]);
    expect(pressed).toEqual([
      ['Mountain', 'true'],
      ['Valley', 'false'],
      ['Edge', 'false'],
      ['Auxiliary', 'false'],
      ['Unassigned', 'false'],
    ]);
  });

  it('pick a type with a click', () => {
    const selected: string[] = [];
    const host = renderRail({}, (action) => selected.push(action.id));
    act(() => buttonFor(host, 'Valley').click());
    expect(selected).toEqual([valley?.id]);
  });

  it('name a type on a press-and-hold without picking it', () => {
    vi.useFakeTimers();
    stubPointer(true);
    const selected: string[] = [];
    const host = renderRail({}, (action) => selected.push(action.id));
    const button = buttonFor(host, 'Valley');

    act(() => {
      button.dispatchEvent(touchPointer('pointerdown'));
    });
    act(() => {
      vi.advanceTimersByTime(TOUCH_LABEL_HOLD_MS);
    });
    expect(document.querySelector('.tooltip-content')?.textContent).toContain('Valley');

    act(() => {
      button.dispatchEvent(touchPointer('pointerup'));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(selected).toEqual([]);
  });

  it('refuse a pick while nothing is editable, staying reachable to say why', () => {
    const selected: string[] = [];
    const host = renderRail({}, (action) => selected.push(action.id), false);
    const button = buttonFor(host, 'Valley');

    expect(button.getAttribute('aria-disabled')).toBe('true');
    // Focusable, unlike a native `disabled`: the tooltip is where it says why.
    expect(button.hasAttribute('disabled')).toBe(false);
    act(() => button.click());
    expect(selected).toEqual([]);
  });
});

/** jsdom has no `PointerEvent`; the fields the hold reads are a MouseEvent's plus this one. */
function touchPointer(type: string): Event {
  const event = new MouseEvent(type, { bubbles: true, clientX: 0, clientY: 0 });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  return event;
}

/*
 * `.cp-tool-rail` is a grid with one explicit row, so an empty header div would
 * still open a second implicit one — the fine-pointer rail must not gain a child
 * at all.
 */
describe('CpToolRail desktop layout', () => {
  it('has exactly the children it had before the touch work', () => {
    stubPointer(false);
    const host = renderRail();
    const rail = host.querySelector('aside[aria-label="Crease pattern tools"]');

    expect([...(rail?.children ?? [])].map((node) => node.getAttribute('data-rail-part'))).toEqual([
      'groups',
    ]);
  });
});
