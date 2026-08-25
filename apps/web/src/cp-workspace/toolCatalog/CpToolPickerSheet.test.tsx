import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../components/ui/Tooltip';
import {
  ORISTUDIO_CP_ACTIONS,
  type OristudioCpActionDefinition,
} from '../../lib/oristudioCpActions';
import { isShiftLatched, resetShiftLatch } from '../touchModifiers/shiftLatch';
import { CpShiftLatchToggle } from '../touchModifiers/CpShiftLatchToggle';
import { cpRailGroups } from './cpRailActions';
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
    const expected = cpRailGroups().flatMap((entry) => entry.actions.map((action) => action.label));

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
