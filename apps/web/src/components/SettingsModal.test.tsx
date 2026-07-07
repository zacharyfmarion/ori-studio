import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutStore } from '../store/layoutStore';
import { useSettingsStore, type SettingsTab } from '../store/settingsStore';
import { useShortcutStore } from '../store/shortcutStore';
import { useThemeStore } from '../store/themeStore';
import { applyTheme, DEFAULT_THEME, PRESET_THEMES } from '../themes';
import { CommandDialogModal } from './CommandDialogModal';
import { SettingsModal } from './SettingsModal';
import { TooltipProvider } from './ui/Tooltip';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialSettingsState = useSettingsStore.getInitialState();
const initialLayoutState = useLayoutStore.getInitialState();
const initialShortcutState = useShortcutStore.getInitialState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find((element) =>
    element.textContent?.includes(label)
  );
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}

function findExactButton(label: string): HTMLButtonElement {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find(
    (element) => element.textContent === label
  );
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}

function themeNamesForSection(rendered: HTMLElement, label: string): string[] {
  const section = Array.from(rendered.querySelectorAll('.settings-section')).find((element) =>
    element.querySelector('.settings-section__title')?.textContent?.includes(label)
  );
  expect(section).toBeDefined();
  return Array.from(section?.querySelectorAll('.settings-theme-card__name') ?? []).map(
    (element) => element.textContent ?? ''
  );
}

function shortcutRowFor(label: string): HTMLElement {
  const row = Array.from(container?.querySelectorAll('.settings-shortcuts__row') ?? []).find(
    (element) =>
      element.querySelector('.settings-shortcuts__copy span')?.textContent === label
  );
  expect(row).toBeDefined();
  return row as HTMLElement;
}

function renderModal(tab?: SettingsTab) {
  useSettingsStore.getState().openSettings(tab);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider delayDuration={0}>
        <SettingsModal />
        <CommandDialogModal />
      </TooltipProvider>
    );
  });
  return container;
}

beforeEach(() => {
  localStorage.clear();
  applyTheme(DEFAULT_THEME);
  useThemeStore.setState({
    currentTheme: DEFAULT_THEME,
    presetThemes: PRESET_THEMES,
  });
  useSettingsStore.setState(initialSettingsState, true);
  useLayoutStore.setState(initialLayoutState, true);
  useShortcutStore.setState(initialShortcutState, true);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe('SettingsModal', () => {
  it('renders Cascade themes and applies a selected theme', () => {
    const rendered = renderModal();

    expect(rendered.querySelector('[role="dialog"]')).not.toBeNull();
    expect(rendered.textContent).toContain('Appearance');
    expect(rendered.textContent).toContain('Solarized Dark');
    expect(rendered.textContent).toContain('GitHub Light');

    expect(themeNamesForSection(rendered, 'Dark')[0]).toBe('One Dark');
    expect(themeNamesForSection(rendered, 'Light')[0]).toBe('Atom One Light');

    act(() => {
      findButton('GitHub Light').click();
    });

    expect(useThemeStore.getState().currentTheme.name).toBe('GitHub Light');
    expect(document.documentElement.getAttribute('data-theme-type')).toBe('light');
  });

  it('opens the requested tab and can reset the layout', async () => {
    const resetLayout = vi.fn();
    useLayoutStore.setState({ resetLayout });

    const rendered = renderModal('workspace');
    expect(rendered.textContent).toContain('Workspace');

    act(() => {
      findButton('Reset Workspace Layout').click();
    });

    expect(rendered.textContent).toContain('Restore the default layout for the current workspace?');

    await act(async () => {
      findExactButton('Reset').click();
      await Promise.resolve();
    });

    expect(resetLayout).toHaveBeenCalledOnce();
  });

  it('captures, clears, and resets shortcuts', async () => {
    const rendered = renderModal('shortcuts');

    expect(rendered.textContent).toContain('Shortcuts');
    expect(rendered.textContent).toContain('Save');

    const saveRow = shortcutRowFor('Save');
    const capture = saveRow?.querySelector('.settings-shortcuts__capture') as HTMLButtonElement;

    act(() => {
      capture.click();
    });
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 's',
          ctrlKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });

    expect(useShortcutStore.getState().overrides['file.save']).toEqual([
      {
        primary: true,
        alt: true,
        key: 's',
      },
    ]);
    expect(rendered.textContent).toMatch(/(Alt|Option)\+S/u);

    const clear = saveRow?.querySelector('[aria-label="Clear Save shortcut"]') as HTMLButtonElement;
    act(() => {
      clear.click();
    });

    expect(useShortcutStore.getState().overrides['file.save']).toBeNull();
    expect(rendered.textContent).toContain('Unassigned');

    const reset = saveRow?.querySelector('[aria-label="Reset Save shortcut"]') as HTMLButtonElement;
    expect(reset.getAttribute('title')).toBeNull();
    await act(async () => {
      reset.focus();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('Reset Save shortcut');

    act(() => {
      reset.click();
    });

    expect(useShortcutStore.getState().overrides['file.save']).toBeUndefined();
  });

  it('blocks conflicting shortcut captures', () => {
    const rendered = renderModal('shortcuts');
    const saveRow = shortcutRowFor('Save');
    const capture = saveRow?.querySelector('.settings-shortcuts__capture') as HTMLButtonElement;

    act(() => {
      capture.click();
    });
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'o',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });

    expect(useShortcutStore.getState().overrides['file.save']).toBeUndefined();
    expect(rendered.textContent).toContain('already assigned to Open');
  });

  it('closes on Escape', () => {
    renderModal();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
  });
});
