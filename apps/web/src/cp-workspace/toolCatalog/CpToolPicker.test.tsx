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
import { CpToolPicker } from './CpToolPicker';

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

function renderPicker(
  coarse: boolean,
  onSelectAction: (action: OristudioCpActionDefinition) => void = () => {}
): HTMLDivElement {
  stubPointer(coarse);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider delayDuration={0}>
        <CpToolPicker
          activeActionId="cp.action.crease-select"
          activeOperationId="CreaseSelect"
          activeLineColor="Red1"
          editable
          onSelectAction={onSelectAction}
          shortcutResolution={{}}
        />
      </TooltipProvider>
    );
  });
  return container;
}

function trigger(host: HTMLDivElement): HTMLElement {
  const button = host.querySelector('.cp-tool-rail__picker-trigger');
  if (!(button instanceof HTMLElement)) throw new Error('no picker trigger');
  return button;
}

function sheet(): HTMLElement | null {
  return document.querySelector('.cp-tool-picker');
}

describe('CpToolPicker pointer branch', () => {
  it('offers nothing on a fine pointer, where hover already names every tool', () => {
    const host = renderPicker(false);
    expect(host.querySelector('.cp-tool-rail__picker-trigger')).toBeNull();
  });

  it('shows a visible trigger on a coarse pointer', () => {
    const host = renderPicker(true);
    expect(trigger(host).textContent).toContain('All tools');
    expect(sheet()).toBeNull();
  });
});

describe('CpToolPicker sheet', () => {
  it('names every tool the rail draws, and nothing the rail does not', () => {
    const host = renderPicker(true);
    act(() => {
      trigger(host).click();
    });

    const labels = [...(sheet()?.querySelectorAll('.cp-tool-picker__label') ?? [])].map(
      (node) => node.textContent
    );
    const expected = cpRailGroups().flatMap((entry) =>
      entry.actions.map((action) => action.label)
    );

    expect(labels).toEqual(expected);
    // Not a fixed number: the assertion is "the rail's set", and it should
    // follow the catalogue rather than pin it.
    expect(labels.length).toBeGreaterThan(50);
  });

  it('carries the full label, not the truncation the rail cannot avoid', () => {
    const host = renderPicker(true);
    act(() => {
      trigger(host).click();
    });

    const labels = [...(sheet()?.querySelectorAll('.cp-tool-picker__label') ?? [])].map(
      (node) => node.textContent
    );
    expect(labels).toContain('Parallel Alternating Lines');
    expect(labels).toContain('Concentric from two circles');
  });

  it('selects a tool and closes', () => {
    const selected: string[] = [];
    const host = renderPicker(true, (action) => selected.push(action.id));
    act(() => {
      trigger(host).click();
    });

    const rows = [...(sheet()?.querySelectorAll('.cp-tool-picker__item') ?? [])];
    const eraser = rows.find((row) => row.textContent?.includes('Eraser'));
    if (!(eraser instanceof HTMLElement)) throw new Error('no Eraser row');
    act(() => {
      eraser.click();
    });

    expect(selected).toHaveLength(1);
    expect(sheet()).toBeNull();
  });

  it('refuses a tool that is not ready, rather than hiding it', () => {
    const selected: string[] = [];
    const host = renderPicker(true, (action) => selected.push(action.id));
    act(() => {
      trigger(host).click();
    });

    const notReady = ORISTUDIO_CP_ACTIONS.find(
      (action) =>
        (action.placement === 'left-rail' || action.placement === 'left-rail-overflow') &&
        action.uiStatus !== 'ready'
    );
    if (!notReady) return; // Every rail tool shipped; nothing to assert.

    const rows = [...(sheet()?.querySelectorAll('.cp-tool-picker__item') ?? [])];
    const row = rows.find((node) => node.textContent?.includes(notReady.label));
    if (!(row instanceof HTMLElement)) throw new Error(`no row for ${notReady.label}`);
    expect(row.getAttribute('aria-disabled')).toBe('true');
    act(() => {
      row.click();
    });
    expect(selected).toHaveLength(0);
  });

  it('closes on a backdrop tap', () => {
    const host = renderPicker(true);
    act(() => {
      trigger(host).click();
    });

    const backdrop = sheet();
    if (!(backdrop instanceof HTMLElement)) throw new Error('no backdrop');
    act(() => {
      backdrop.click();
    });
    expect(sheet()).toBeNull();
  });

  it('closes on Escape from wherever focus is inside it', () => {
    const host = renderPicker(true);
    act(() => {
      trigger(host).click();
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(sheet()).toBeNull();
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
