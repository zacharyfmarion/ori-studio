import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsRuntimeProvider, type PostHogClientLike } from '../analytics';
import {
  formatKeyChord,
  getResolvedShortcuts,
  keyChordId,
  SHORTCUT_DEFINITIONS,
  type KeyChord,
  type ShortcutActionId,
  type ShortcutOverrides,
  type ShortcutScope,
} from '../keyboard/shortcuts';
import { handleShortcutKeyDown } from '../keyboard/shortcutDispatcher';
import { buildOrieditaImportPlan } from '../lib/orieditaImport';
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

/**
 * The keymap as the app resolves it right now, read from the store rather than
 * from either defaults table — so a confirmation's counts can be checked against
 * the transition that actually happened.
 */
function effectiveKeymap(): Map<ShortcutActionId, string> {
  const { overrides, defaultsSource } = useShortcutStore.getState();
  return new Map(
    SHORTCUT_DEFINITIONS.map((definition) => [
      definition.id,
      getResolvedShortcuts(definition.id, { overrides, defaultsSource })
        .map((chord) => keyChordId(chord))
        .join(' '),
    ])
  );
}

function chordListId(chords: KeyChord[]): string {
  return chords.map((chord) => keyChordId(chord)).join(' ');
}

function changedBindings(
  before: Map<ShortcutActionId, string>,
  after: Map<ShortcutActionId, string>
): ShortcutActionId[] {
  return [...after.keys()].filter((id) => before.get(id) !== after.get(id));
}

function toggleRowFor(label: string): HTMLElement {
  const row = Array.from(container?.querySelectorAll('.settings-toggle-row') ?? []).find(
    (element) => element.querySelector('.settings-toggle-row__label')?.textContent === label
  );
  expect(row).toBeDefined();
  return row as HTMLElement;
}

/**
 * A row's switch. It is the shared `Toggle` (a Radix switch), so it renders a
 * `button[role="switch"]` with `aria-checked` rather than a checkbox — reading
 * `.checked` off it would be `undefined`, which is falsy and would let an
 * assertion pass for the wrong reason.
 */
function rowSwitch(label: string): HTMLButtonElement {
  const button = toggleRowFor(label).querySelector<HTMLButtonElement>('[role="switch"]');
  expect(button).not.toBeNull();
  return button as HTMLButtonElement;
}

function rowChecked(label: string): boolean {
  return rowSwitch(label).getAttribute('aria-checked') === 'true';
}

const ORIEDITA_DEFAULTS_LABEL = 'Use Oriedita defaults';
const WELCOME_LABEL = 'Show welcome screen on startup';
const FOLD_WARNING_LABEL = 'Warn before folding a crease pattern with flat-foldability errors';
const ANALYTICS_LABEL =
  'Send anonymous usage analytics and crash reports to help improve Ori Studio';

function defaultsToggle(): HTMLButtonElement {
  return rowSwitch(ORIEDITA_DEFAULTS_LABEL);
}

function defaultsToggleChecked(): boolean {
  return rowChecked(ORIEDITA_DEFAULTS_LABEL);
}

function stubPostHogClient() {
  return {
    init: vi.fn(),
    register: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    identify: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
  } satisfies PostHogClientLike;
}

/**
 * Which action the real dispatcher reaches for a chord, under the store's own
 * state. Asserting on the store alone would pass over a binding that is written
 * but dead, or one that runs somebody else's action.
 */
function dispatch(scopeStack: ShortcutScope[], init: KeyboardEventInit): ShortcutActionId[] {
  const reached: ShortcutActionId[] = [];
  const record = (id: ShortcutActionId) => {
    reached.push(id);
    return true;
  };
  const { overrides, defaultsSource } = useShortcutStore.getState();
  handleShortcutKeyDown(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    {
      scopeStack,
      overrides,
      defaultsSource,
      executors: { menu: record, cpAction: record, viewport: record, simulator: record },
    }
  );
  return reached;
}

function pressChord(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    );
  });
}

/** React listens for the native input event, so the value goes in through the setter. */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    input.focus();
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function renderModal(tab?: SettingsTab, analyticsClient: PostHogClientLike | null = null) {
  useSettingsStore.getState().openSettings(tab);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <AnalyticsRuntimeProvider client={analyticsClient}>
        <TooltipProvider delayDuration={0}>
          <SettingsModal />
          <CommandDialogModal />
        </TooltipProvider>
      </AnalyticsRuntimeProvider>
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
  it('opens on whichever tab is first in the list', () => {
    // Both production callers pass no tab, so this fallback is every real open.
    // Asserted off the content header, not `textContent`: the sidebar puts every
    // tab's name on the page regardless of which one is showing.
    const rendered = renderModal();
    expect(rendered.querySelector('.settings-modal__header h2')?.textContent).toBe('General');
  });

  it('renders Cascade themes and applies a selected theme', () => {
    const rendered = renderModal('appearance');

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

  /**
   * Named by the row copy rather than wrapped in a `<label>`, which is what
   * keeps a click on the copy from also reaching the switch directly. All of
   * these default to on, so the pane must open showing that.
   */
  function expectSwitchRow(rendered: HTMLElement, label: string) {
    const labelId = toggleRowFor(label).querySelector('.settings-toggle-row__label')?.id;
    expect(labelId).toBeTruthy();
    expect(rowSwitch(label).getAttribute('aria-labelledby')).toBe(labelId);
    expect(rowChecked(label)).toBe(true);
    expect(rendered.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  }

  it('presents the general booleans as switches, each naming its own row copy', () => {
    const rendered = renderModal('general');

    // Startup and Privacy. Updates sits between them but renders nothing off
    // the desktop build, so it contributes no control here.
    expect(rendered.querySelectorAll('.settings-toggle-row [role="switch"]')).toHaveLength(2);
    for (const label of [WELCOME_LABEL, ANALYTICS_LABEL]) {
      expectSwitchRow(rendered, label);
    }
  });

  it('presents the workspace booleans as switches, each naming its own row copy', () => {
    const rendered = renderModal('workspace');

    // Only Folding is left here now that Startup and Privacy moved to General.
    // The scroll gesture below it is a two-way *named* choice, so it stays a
    // radio group — a switch would have to drop one of the two labels.
    expect(rendered.querySelectorAll('.settings-toggle-row [role="switch"]')).toHaveLength(1);
    expect(rendered.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expectSwitchRow(rendered, FOLD_WARNING_LABEL);
  });

  it('keeps the moved preferences off the tab they came from', () => {
    // A section can be rendered twice as easily as zero times, and both tabs
    // would look right in isolation.
    const rendered = renderModal('workspace');
    expect(rendered.textContent).not.toContain(WELCOME_LABEL);
    expect(rendered.textContent).not.toContain(ANALYTICS_LABEL);
  });

  it('flips a workspace preference from the switch and from the row copy', () => {
    renderModal('workspace');

    act(() => {
      rowSwitch(FOLD_WARNING_LABEL).click();
    });

    // Once, not twice. The row forwards its own clicks, so a hit on the switch
    // that also reached the row handler would toggle back to true and this
    // assertion is the guard on that.
    expect(useSettingsStore.getState().foldWarningEnabled).toBe(false);
    expect(rowChecked(FOLD_WARNING_LABEL)).toBe(false);

    // And the copy is still a hit target, which is what the `<label>` checkbox
    // this replaced gave for free.
    act(() => {
      (
        toggleRowFor(FOLD_WARNING_LABEL).querySelector(
          '.settings-toggle-row__label'
        ) as HTMLElement
      ).click();
    });

    expect(useSettingsStore.getState().foldWarningEnabled).toBe(true);
    expect(rowChecked(FOLD_WARNING_LABEL)).toBe(true);
  });

  it('still drives the analytics client when the privacy switch is flipped', () => {
    // The one preference whose switch does more than write the store, so the
    // control swap had to carry the side effect across with it.
    const client = stubPostHogClient();
    renderModal('general', client);
    client.capture.mockClear();

    act(() => {
      rowSwitch(ANALYTICS_LABEL).click();
    });

    expect(useSettingsStore.getState().analyticsEnabled).toBe(false);
    // The preference-change event belongs to this switch alone — the provider's
    // reactive sync calls `setAnalyticsEnabled` without the option — so seeing
    // it is what proves the client was reached from here.
    expect(client.capture).toHaveBeenCalledWith('analytics preference changed', {
      analytics_enabled: true,
      enabled: false,
    });
    expect(client.opt_out_capturing).toHaveBeenCalled();
  });

  it('reflects and updates the crease-pattern scroll preference', () => {
    const rendered = renderModal('workspace');

    const radios = Array.from(
      rendered.querySelectorAll<HTMLInputElement>('input[name="cp-wheel-gesture"]')
    );
    expect(radios).toHaveLength(2);
    const zoomRadio = radios.find((radio) => radio.value === 'zoom');
    const panRadio = radios.find((radio) => radio.value === 'pan');
    // Scroll-zooms is the default, and the pane must open showing that.
    expect(zoomRadio?.checked).toBe(true);
    expect(panRadio?.checked).toBe(false);
    // The default leads the list rather than sitting under the alternative.
    expect(radios[0]).toBe(zoomRadio);

    act(() => {
      panRadio?.click();
    });

    expect(useSettingsStore.getState().cpWheelGesture).toBe('pan');
    expect(panRadio?.checked).toBe(true);

    act(() => {
      zoomRadio?.click();
    });

    expect(useSettingsStore.getState().cpWheelGesture).toBe('zoom');
  });

  it('dresses the snap radius as a settings row, not as an inspector-panel row', () => {
    // `.control-row` is the panel idiom — indented, with a bottom divider and a
    // smaller secondary label — and it reads as foreign inside this modal, which
    // deliberately keeps its rows unboxed and flush with the section title.
    const rendered = renderModal('workspace');
    const input = rendered.querySelector<HTMLInputElement>('input[aria-label="Snap radius"]');
    const row = input?.closest('.settings-toggle-row');

    expect(row).toBeTruthy();
    expect(input?.closest('.control-row')).toBeNull();
    expect(row?.querySelector('.settings-toggle-row__label')?.textContent).toBe('Snap radius');
    // The description belongs to the control, so it lives in the row rather than
    // trailing after it where it reads as the next section's preamble.
    expect(row?.querySelector('.settings-toggle-row__desc')?.textContent).toContain('400 across');
  });

  it('edits the crease-pattern snap radius and persists it', () => {
    const rendered = renderModal('workspace');

    const input = rendered.querySelector<HTMLInputElement>('input[aria-label="Snap radius"]');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('10');
    // The unit is the reason the number is not pixels, so the row has to say it.
    expect(rendered.textContent).toContain('the paper is 400 across');

    typeInto(input as HTMLInputElement, '24');
    act(() => (input as HTMLInputElement).blur());

    expect(useSettingsStore.getState().cpSnapRadius).toBe(24);
    expect(localStorage.getItem('oristudio:cp-snap-radius')).toBe('24');

    // Upstream's slider stops at 100, and so does a typed value.
    typeInto(input as HTMLInputElement, '900');
    act(() => (input as HTMLInputElement).blur());

    expect(useSettingsStore.getState().cpSnapRadius).toBe(100);
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

  it('offers to unbind the holder of a hard-taken chord, then does it', async () => {
    const rendered = renderModal('shortcuts');
    const saveRow = shortcutRowFor('Save');
    const capture = saveRow?.querySelector('.settings-shortcuts__capture') as HTMLButtonElement;

    act(() => {
      capture.click();
    });
    pressChord({ key: 'o', ctrlKey: true });

    // Nothing is written until the displaced binding is accounted for.
    expect(useShortcutStore.getState().overrides['file.save']).toBeUndefined();
    expect(rendered.textContent).not.toContain('already assigned to');
    expect(document.body.textContent).toContain('Unbind Open...?');
    expect(document.body.textContent).toContain('leaves Open... unassigned');

    await act(async () => {
      findExactButton('Unbind and assign').click();
      await Promise.resolve();
    });

    const { overrides } = useShortcutStore.getState();
    expect(overrides['file.save']).toEqual([{ primary: true, key: 'o' }]);
    expect(overrides['file.open']).toBeNull();
    expect(shortcutRowFor('Open...').textContent).toContain('Unassigned');
    // The chord has to reach Save through the real dispatcher, not merely be
    // written next to Save in the store.
    expect(dispatch(['global'], { key: 'o', ctrlKey: true })).toEqual(['file.save']);
  });

  it('leaves both bindings alone when the unbind is cancelled', async () => {
    renderModal('shortcuts');
    const saveRow = shortcutRowFor('Save');
    const capture = saveRow?.querySelector('.settings-shortcuts__capture') as HTMLButtonElement;

    act(() => {
      capture.click();
    });
    pressChord({ key: 'o', ctrlKey: true });

    await act(async () => {
      findExactButton('Cancel').click();
      await Promise.resolve();
    });

    const { overrides } = useShortcutStore.getState();
    expect(overrides['file.save']).toBeUndefined();
    expect(overrides['file.open']).toBeUndefined();
  });

  it('binds a chord only the simulator also holds, with no prompt', () => {
    // `L` is Toggle Lighting, which is in the scope stack only while a simulation
    // owns the keyboard. Those coexist by design, so offering to unbind one would
    // be offering to break something that works.
    renderModal('shortcuts');
    const saveRow = shortcutRowFor('Save');
    const capture = saveRow?.querySelector('.settings-shortcuts__capture') as HTMLButtonElement;

    act(() => {
      capture.click();
    });
    pressChord({ key: 'l' });

    expect(useShortcutStore.getState().overrides['file.save']).toEqual([{ key: 'l' }]);
    expect(useShortcutStore.getState().overrides['simulator.toggleLighting']).toBeUndefined();
    expect(document.body.textContent).not.toContain('Unbind');
  });

  it('asks before a capture kills the holder it outranks, and agrees with an import', async () => {
    // The plan's own example: "I want to bind mountain line to M but M is mirror
    // by default." Mountain sits ahead of Mirror Line in the registry, so nothing
    // shadows the capture — `findShortcutShadowing` answers `conditional`, and
    // reading that as "no collision" bound M silently and left Mirror Line
    // holding a key it could never answer, still shown as M in this very list.
    // The direction the collision points in is not the user's business; the
    // question is who ends up owning the chord.
    const rendered = renderModal('shortcuts');
    const mountainRow = shortcutRowFor('Mountain');

    act(() => {
      (mountainRow.querySelector('.settings-shortcuts__capture') as HTMLButtonElement).click();
    });
    pressChord({ key: 'm' });

    expect(useShortcutStore.getState().overrides['cp.action.line-type.mountain']).toBeUndefined();
    expect(document.body.textContent).toContain('Unbind Mirror Line?');
    // The import reaches the same decision about the same chord: not applied on
    // its own, and offering to displace the same action. Import and manual
    // capture are the two ways a key gets assigned, and a user who does it one
    // way then the other must not meet two different answers.
    const imported = buildOrieditaImportPlan({
      hotkeys: new Map([['colRedAction', { kind: 'value', value: 'pressed M' }]]),
      currentOverrides: {},
      defaultsSource: 'ori-studio',
    });
    const importedRow = imported.rows[0];
    expect(importedRow.outcome).toEqual({ kind: 'skip', reason: 'shadowed' });
    expect(importedRow.detail.evictionOffer?.evictedId).toBe('cp.action.symmetric-draw');

    await act(async () => {
      findExactButton('Unbind and assign').click();
      await Promise.resolve();
    });

    expect(shortcutRowFor('Mirror Line').textContent).toContain('Unassigned');
    expect(rendered.textContent).not.toContain('already assigned');
    // And the chord reaches Mountain through the real dispatcher, rather than
    // the tool that used to answer it.
    expect(dispatch(['crease-pattern', 'global'], { key: 'm' })).toEqual([
      'cp.action.line-type.mountain',
    ]);
  });

  it('asks when a crease-pattern capture would swallow a global chord', async () => {
    // Scope precedence, not registry order, and across the boundary
    // `findShortcutConflict` is blind to: a crease-pattern binding on Mod+S does
    // not coexist with Save, it answers first whenever the canvas is the editing
    // context. Nothing outranks the capture, so this is the same `conditional`
    // reading, and it has to ask all the same.
    renderModal('shortcuts');
    const mountainRow = shortcutRowFor('Mountain');

    act(() => {
      (mountainRow.querySelector('.settings-shortcuts__capture') as HTMLButtonElement).click();
    });
    pressChord({ key: 's', ctrlKey: true });

    expect(document.body.textContent).toContain('Unbind Save?');
    expect(useShortcutStore.getState().overrides['cp.action.line-type.mountain']).toBeUndefined();

    await act(async () => {
      findExactButton('Cancel').click();
      await Promise.resolve();
    });

    // Cancelling leaves both exactly as they were: Save still answers Mod+S on
    // the canvas, and Mountain is still on its default.
    expect(useShortcutStore.getState().overrides['file.save']).toBeUndefined();
    expect(dispatch(['crease-pattern', 'global'], { key: 's', ctrlKey: true })).toEqual([
      'file.save',
    ]);
  });

  it('names the tool, not the simulator, when both hold the captured chord', async () => {
    // `C` is Flip Mountain/Valley *and* the simulator's Toggle Crease Lines. The
    // simulator claimant sits on top and hides the tool underneath, which is why
    // the top claimant alone cannot settle the question: silencing the tool is
    // the change that matters, and the simulator binding is neither named nor
    // touched.
    renderModal('shortcuts');
    const mountainRow = shortcutRowFor('Mountain');

    act(() => {
      (mountainRow.querySelector('.settings-shortcuts__capture') as HTMLButtonElement).click();
    });
    pressChord({ key: 'c' });

    expect(document.body.textContent).toContain('Unbind Flip Mountain/Valley?');

    await act(async () => {
      findExactButton('Unbind and assign').click();
      await Promise.resolve();
    });

    expect(useShortcutStore.getState().overrides['simulator.toggleCreases']).toBeUndefined();
    // Still the simulator's while a simulation owns the keyboard, and Mountain's
    // the rest of the time — the coexistence the `conditional` reading protects.
    expect(dispatch(['simulator', 'crease-pattern', 'global'], { key: 'c' })).toEqual([
      'simulator.toggleCreases',
    ]);
    expect(dispatch(['crease-pattern', 'global'], { key: 'c' })).toEqual([
      'cp.action.line-type.mountain',
    ]);
  });

  it('displaces nothing when the capture is on a binding that declines', () => {
    // The mirror direction, and the half that is genuinely safe. Delete Selected
    // Object answers `false` when nothing is selected and dispatch carries on to
    // the next scope, so putting it on a key a tool already answers costs that
    // tool nothing — it is how `viewport.delete` and `edit.delete` both work on
    // Delete. Offering to unbind Mountain here would be breaking a working
    // feature to settle a collision that never fires.
    renderModal('shortcuts');
    const deleteRow = shortcutRowFor('Delete Selected Object');

    act(() => {
      (deleteRow.querySelector('.settings-shortcuts__capture') as HTMLButtonElement).click();
    });
    pressChord({ key: 'a' });

    expect(useShortcutStore.getState().overrides['viewport.delete']).toEqual([{ key: 'a' }]);
    expect(useShortcutStore.getState().overrides['cp.action.line-type.mountain']).toBeUndefined();
    expect(document.body.textContent).not.toContain('Unbind Mountain?');
  });

  it('asks when the capture is on a viewport binding that never declines', () => {
    // Same shape, opposite answer, and the reason the rule cannot be "is it
    // viewport?". Fit To View claims its chord unconditionally, so moving it onto
    // Mountain's key would leave Mountain holding a chord it can never answer —
    // silently, until the user noticed the tool had stopped working. This capture
    // used to be waved through on the strength of a decline that never happens.
    renderModal('shortcuts');
    const fitRow = shortcutRowFor('Fit To View');

    act(() => {
      (fitRow.querySelector('.settings-shortcuts__capture') as HTMLButtonElement).click();
    });
    pressChord({ key: 'a' });

    expect(useShortcutStore.getState().overrides['viewport.fit']).toBeUndefined();
    expect(document.body.textContent).toContain('Unbind Mountain?');
  });

  it('lets a CP tool take 5 from Zoom Out, and agrees with an import', async () => {
    // The reported bug. `5` is a default second chord on Zoom Out, which claims
    // it every time, so a CP tool bound there is simply dead — but every
    // `viewport` blocker was exempt from eviction, so the capture answered "5 is
    // already assigned to Zoom Out" and stopped, and the import skipped the row
    // with no "Use anyway" button. Neither path had a way through.
    const rendered = renderModal('shortcuts');

    act(() => {
      (
        shortcutRowFor('Foldable Line').querySelector(
          '.settings-shortcuts__capture'
        ) as HTMLButtonElement
      ).click();
    });
    pressChord({ key: '5' });

    expect(rendered.textContent).not.toContain('already assigned');
    expect(document.body.textContent).toContain('Unbind Zoom Out?');

    // The import reaches the same decision about the same chord, and now offers
    // the removal that rescues the row.
    const imported = buildOrieditaImportPlan({
      hotkeys: new Map([['makeFlatFoldableAction', { kind: 'value', value: 'pressed 5' }]]),
      currentOverrides: {},
      defaultsSource: 'ori-studio',
    });
    expect(imported.rows[0].detail.evictionOffer?.evictedId).toBe('viewport.zoomOut');

    await act(async () => {
      findExactButton('Unbind and assign').click();
      await Promise.resolve();
    });

    // Through the real dispatcher, with `viewport` ahead of `crease-pattern` in
    // the stack exactly as the app builds it — asserting the store alone would
    // pass for a binding that is written and dead.
    expect(dispatch(['viewport', 'crease-pattern', 'global'], { key: '5' })).toEqual([
      'cp.action.vertex-make-angularly-flat-foldable',
    ]);
    // An eviction unbinds the whole action, not just the colliding chord
    // (`shortcutStore.assignShortcut` writes `null`), so Zoom Out loses `Mod+-`
    // as well. The confirmation says so in as many words — "leaves Zoom Out
    // unassigned" — and a user who wants to keep the accelerator has the cheaper
    // route of moving Zoom Out to `Mod+-` alone, which frees the digit with
    // nothing evicted. Asserted so a future change to per-chord eviction is a
    // deliberate one.
    expect(useShortcutStore.getState().overrides['viewport.zoomOut']).toBeNull();
    expect(
      dispatch(['viewport', 'crease-pattern', 'global'], { key: '-', ctrlKey: true, metaKey: true })
    ).toEqual([]);
  });

  it('names the binding a Delete capture really costs', () => {
    // `viewport.delete` holds Delete and outranks crease-pattern, but it declines
    // when nothing is selected, so it is not what a CP tool on Delete would cost.
    // `edit.delete` is — it sits at global scope, underneath, and would stop
    // being reached. A declining blocker is transparent, not exempt.
    renderModal('shortcuts');

    act(() => {
      (
        shortcutRowFor('Foldable Line').querySelector(
          '.settings-shortcuts__capture'
        ) as HTMLButtonElement
      ).click();
    });
    pressChord({ key: 'delete' });

    expect(document.body.textContent).toContain('Unbind Delete');
    expect(document.body.textContent).not.toContain('Unbind Delete Selected Object?');
  });

  it('never offers to unbind Undo, because the unbind would not take', () => {
    // `edit.undo` merges its override with the defaults instead of replacing
    // them, so a null would leave Mod+Z bound and the dialog would have promised
    // a change that cannot happen. Refusing is the honest answer.
    const rendered = renderModal('shortcuts');
    const cutRow = shortcutRowFor('Cut');
    const capture = cutRow?.querySelector('.settings-shortcuts__capture') as HTMLButtonElement;

    act(() => {
      capture.click();
    });
    pressChord({ key: 'z', ctrlKey: true });

    expect(useShortcutStore.getState().overrides['edit.cut']).toBeUndefined();
    expect(useShortcutStore.getState().overrides['edit.undo']).toBeUndefined();
    expect(document.body.textContent).not.toContain('Unbind and assign');
    expect(rendered.textContent).toContain('already assigned to Undo');
  });

  it('refuses Undo’s chord for a crease-pattern tool, which outranks it', () => {
    // The same rule from the side that has no shadow to report. A crease-pattern
    // binding beats a global one whenever the canvas is the editing context, so
    // nothing shadows this capture — and reading that as "free" wrote Mod+Z onto
    // a tool and took Undo off the canvas without a word. Undo cannot be unbound
    // and must not be quietly overwritten either.
    const rendered = renderModal('shortcuts');
    const foldRow = shortcutRowFor('Fold estimate');

    act(() => {
      (foldRow.querySelector('.settings-shortcuts__capture') as HTMLButtonElement).click();
    });
    pressChord({ key: 'z', ctrlKey: true });

    expect(useShortcutStore.getState().overrides).toEqual({});
    expect(rendered.textContent).toContain('already assigned to Undo');
    expect(dispatch(['crease-pattern', 'global'], { key: 'z', ctrlKey: true })).toEqual([
      'edit.undo',
    ]);
  });

  it("confirms the defaults switch with counts that match what changes", async () => {
    const rendered = renderModal('shortcuts');
    expect(defaultsToggleChecked()).toBe(false);
    expect(rendered.textContent).toContain('Use Oriedita defaults');

    const before = effectiveKeymap();
    act(() => {
      defaultsToggle().click();
    });

    const prompt = document.body.textContent ?? '';
    expect(prompt).toContain('Use Oriedita defaults?');

    await act(async () => {
      findExactButton('Use Oriedita defaults').click();
      await Promise.resolve();
    });

    expect(useShortcutStore.getState().defaultsSource).toBe('oriedita');

    // The dialog's numbers are checked against the transition the store actually
    // performed, not against a second copy of the diff.
    const changed = changedBindings(before, effectiveKeymap());
    expect(changed.length).toBeGreaterThan(3);
    expect(prompt).toContain(`This changes ${changed.length} shortcuts.`);
    expect(prompt).toContain(`and ${changed.length - 3} others.`);
    for (const id of changed.slice(0, 3)) {
      const chords = getResolvedShortcuts(id, useShortcutStore.getState());
      expect(prompt).toContain(
        chords.length > 0 ? `moves to ${formatKeyChord(chords[0])}` : 'becomes unassigned'
      );
    }

    // The list follows the source: Mountain is on M, and its Default column says so.
    const mountainRow = shortcutRowFor('Mountain');
    expect(mountainRow.querySelector('.settings-shortcuts__capture')?.textContent).toBe('M');
    expect(mountainRow.querySelector('.settings-shortcuts__default')?.textContent).toBe('M');
    expect(defaultsToggleChecked()).toBe(true);
    // And so does the dispatcher, which is the half a Settings-only toggle misses.
    expect(dispatch(['crease-pattern', 'global'], { key: 'm' })).toEqual([
      'cp.action.line-type.mountain',
    ]);

    // Switching back asks in its own words, and lands exactly where it started.
    act(() => {
      defaultsToggle().click();
    });
    expect(document.body.textContent).toContain('Use Ori Studio defaults?');
    await act(async () => {
      findExactButton('Use Ori Studio defaults').click();
      await Promise.resolve();
    });
    expect(useShortcutStore.getState().defaultsSource).toBe('ori-studio');
    expect(changedBindings(before, effectiveKeymap())).toEqual([]);
  });

  it('names a customization that the new layout would clash with', async () => {
    // Overrides survive the switch, so a key set by hand can end up on a base
    // that now claims it. P is free under the shipped layout and is Oriedita's
    // Perpendicular Line, which outranks a global binding on the CP canvas.
    // Q is free under both, so it is the control: it must not be named.
    useShortcutStore.setState({
      overrides: { 'file.save': [{ key: 'p' }], 'file.open': [{ key: 'q' }] },
    });
    renderModal('shortcuts');

    act(() => {
      defaultsToggle().click();
    });

    const prompt = document.body.textContent ?? '';
    expect(prompt).toContain('1 shortcut you customized now clashes');
    expect(prompt).toContain('your Save is on P, which Perpendicular Line also uses');
    expect(prompt).not.toContain('your Open... is on Q');
    // Two customizations, and exactly one of them survives the switch intact —
    // counting the clashing one as unaffected as well would report one shortcut
    // as two, and would tell the user the key it just broke is fine.
    expect(prompt).toContain('1 shortcut you customized is unaffected.');
    // Named, not resolved: the override is still exactly where the user put it.
    expect(useShortcutStore.getState().overrides['file.save']).toEqual([{ key: 'p' }]);
  });

  it('names the clash when the customization is the one that wins it', async () => {
    // The other direction of the same collision, and the one the shadowing
    // helper is silent about: Mountain is registered before Perpendicular Line,
    // so a hand-set Mountain on P swallows the P that Oriedita's layout is about
    // to hand Perpendicular Line. The switch still counts Perpendicular Line
    // among the shortcuts that move, so leaving this unsaid promises a binding
    // that is dead the moment it lands.
    useShortcutStore.setState({
      overrides: { 'cp.action.line-type.mountain': [{ key: 'p' }] },
    });
    renderModal('shortcuts');

    act(() => {
      defaultsToggle().click();
    });

    const prompt = document.body.textContent ?? '';
    expect(prompt).toContain('1 shortcut you customized now clashes');
    expect(prompt).toContain('your Mountain is on P, which Perpendicular Line also uses');

    await act(async () => {
      findExactButton('Use Oriedita defaults').click();
      await Promise.resolve();
    });

    // And the warning was earned: P reaches the customization, not the default
    // the confirmation counted as moving.
    expect(getResolvedShortcuts('cp.action.perpendicular-draw', useShortcutStore.getState())).toEqual([
      { key: 'p' },
    ]);
    expect(dispatch(['crease-pattern', 'global'], { key: 'p' })).toEqual([
      'cp.action.line-type.mountain',
    ]);
  });

  it('flips without asking when the switch would move nothing', () => {
    // Pin every action the switch would move onto the chord it already has, so
    // the diff is empty. Nothing moves, so there is nothing to warn about.
    const overrides: ShortcutOverrides = {};
    for (const definition of SHORTCUT_DEFINITIONS) {
      const here = getResolvedShortcuts(definition.id, { defaultsSource: 'ori-studio' });
      const there = getResolvedShortcuts(definition.id, { defaultsSource: 'oriedita' });
      if (chordListId(here) === chordListId(there)) continue;
      overrides[definition.id] = here.length > 0 ? here : null;
    }
    expect(Object.keys(overrides).length).toBeGreaterThan(0);
    useShortcutStore.setState({ overrides });
    renderModal('shortcuts');
    const before = effectiveKeymap();

    act(() => {
      defaultsToggle().click();
    });

    expect(document.querySelector('.simple-modal')).toBeNull();
    expect(useShortcutStore.getState().defaultsSource).toBe('oriedita');
    expect(changedBindings(before, effectiveKeymap())).toEqual([]);
  });

  it('leaves the preference and the keymap untouched when the switch is cancelled', async () => {
    const rendered = renderModal('shortcuts');
    const before = effectiveKeymap();

    act(() => {
      defaultsToggle().click();
    });
    await act(async () => {
      findExactButton('Cancel').click();
      await Promise.resolve();
    });

    expect(useShortcutStore.getState().defaultsSource).toBe('ori-studio');
    expect(changedBindings(before, effectiveKeymap())).toEqual([]);
    expect(defaultsToggleChecked()).toBe(false);
    expect(rendered.textContent).toContain('Shortcuts');
  });

  it('resets a row to the active source rather than the shipped one', async () => {
    useShortcutStore.setState({ defaultsSource: 'oriedita' });
    renderModal('shortcuts');

    const mountainRow = shortcutRowFor('Mountain');
    const capture = mountainRow.querySelector('.settings-shortcuts__capture') as HTMLButtonElement;
    act(() => {
      capture.click();
    });
    pressChord({ key: 'j' });
    expect(shortcutRowFor('Mountain').querySelector('.settings-shortcuts__capture')?.textContent).toBe('J');

    const reset = shortcutRowFor('Mountain').querySelector(
      '[aria-label="Reset Mountain shortcut"]'
    ) as HTMLButtonElement;
    act(() => {
      reset.click();
    });

    // Back onto M, not onto the A the Ori Studio table ships.
    expect(shortcutRowFor('Mountain').querySelector('.settings-shortcuts__capture')?.textContent).toBe('M');
  });

  it('closes on Escape', () => {
    renderModal();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
  });

  it('lets the Oriedita import dialog own Escape, instead of closing Settings', () => {
    // Both this modal and the import dialog listen for Escape on `window` in the
    // capture phase, and the modal registers first — so the inner dialog cannot
    // suppress it with stopPropagation. Before NestedDialogContext, Escape while
    // reviewing an import tore down the whole Settings modal and dumped the user
    // back into the app rather than back to the Shortcuts list.
    const rendered = renderModal('shortcuts');

    act(() => {
      findButton('Import from Oriedita').click();
    });
    expect(rendered.textContent).toContain('Import Oriedita Shortcuts');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
    expect(rendered.textContent).not.toContain('Import Oriedita Shortcuts');

    // And Escape still closes Settings once the nested dialog is gone.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
  });

  it('refuses to bind a not-implemented action, exactly as an import does', () => {
    // The two entry points must answer "can this action hold a chord" the same
    // way; they did not. Capture applied no bindability check at all, so this
    // row would unbind whatever held A and then assign a stub that does nothing.
    const rendered = renderModal('shortcuts');
    const before = { ...useShortcutStore.getState().overrides };

    const stubRow = shortcutRowFor('Move calculated shape');
    const capture = stubRow?.querySelector('.settings-shortcuts__capture') as HTMLButtonElement;
    act(() => {
      capture.click();
    });
    pressChord({ key: 'a' });

    expect(rendered.textContent).toContain('cannot take a shortcut yet');
    expect(useShortcutStore.getState().overrides).toEqual(before);
    // And nothing was taken from the binding that holds A today.
    expect(useShortcutStore.getState().overrides['cp.action.line-type.mountain']).toBeUndefined();
  });
});
