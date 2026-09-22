import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { builtInPaperPreset } from '../../lib/paper/paperPresets';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { useSettingsStore } from '../../store/settingsStore';
import { PaperSettings } from './PaperSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tracked: { event: string; properties?: Record<string, unknown> }[] = [];
vi.mock('../../analytics', () => ({
  ANALYTICS_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  track: (event: string, properties?: Record<string, unknown>) => {
    tracked.push(properties ? { event, properties } : { event });
  },
}));

const initialSettings = useSettingsStore.getInitialState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<PaperSettings />));
  return container;
}

function findButton(label: string, within: ParentNode = container!): HTMLButtonElement {
  const button = Array.from(within.querySelectorAll('button')).find(
    (element) => element.textContent === label
  );
  expect(button, label).toBeDefined();
  return button as HTMLButtonElement;
}

function input(label: string): HTMLInputElement {
  const element = container?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  expect(element, label).not.toBeNull();
  return element as HTMLInputElement;
}

/** React listens for the native input event, so the value goes in through the setter. */
function typeInto(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    element.focus();
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function blur(element: HTMLInputElement) {
  act(() => element.blur());
}

const presetRow = (key: string) =>
  container?.querySelector(`[data-testid="settings-paper-preset-${key}"]`) as HTMLElement;
const display = () => useSettingsStore.getState().paperStyle.display;
const exported = () => useSettingsStore.getState().paperStyle.export;
const exportPage = () => useSettingsStore.getState().paperExport;

/** The style's switches: the export-page section below has three of its own. */
const styleSwitches = (within: ParentNode) =>
  Array.from(within.querySelectorAll('[role="switch"]')).filter(
    (element) => !element.closest('[data-testid="settings-paper-export"]')
  );

beforeEach(() => {
  tracked.length = 0;
  useSettingsStore.setState(initialSettings, true);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  useSettingsStore.setState(initialSettings, true);
});

describe('PaperSettings', () => {
  it('renders the slot switch, the presets and an editor for every field', () => {
    const rendered = render();
    expect(rendered.querySelector('[aria-label="Style"] [aria-pressed="true"]')?.textContent).toBe(
      'Display'
    );
    expect(
      Array.from(rendered.querySelectorAll('[data-testid^="settings-paper-preset-"]')).map(
        (row) => row.getAttribute('data-testid')
      )
    ).toEqual([
      'settings-paper-preset-builtin:ori-default',
      'settings-paper-preset-builtin:oriedita',
      'settings-paper-preset-builtin:black-and-white',
      'settings-paper-preset-builtin:origami-house',
    ]);
    // Two paper swatches and one per pen.
    expect(rendered.querySelectorAll('input[type="color"]')).toHaveLength(7);
    expect(input('Front').value).toBe(DEFAULT_PAPER_STYLE.paper.front);
    expect(input('Mountain folds width').value).toBe('0.825');
    expect(input('Mountain folds dash').value).toBe('');
    expect(input('Azimuth').value).toBe('322.1935');
    expect(input('Elevation').value).toBe('42.8092');
    // Erode, as a percentage of the sheet.
    expect(input('Erode').value).toBe('0');
    // The aux toggle and both light switches are Radix switches named by their row.
    const switches = styleSwitches(rendered);
    expect(switches).toHaveLength(3);
    expect(switches.map((element) => element.getAttribute('aria-checked'))).toEqual([
      'true',
      'true',
      'true',
    ]);
  });

  it('applies a preset to the store and counts it', () => {
    render();
    act(() => findButton('Apply', presetRow('builtin:oriedita')).click());
    expect(display()).toEqual(builtInPaperPreset('oriedita').style);
    expect(input('Mountain folds width').value).toBe('0.75');
    expect(tracked).toEqual([
      { event: 'paperPresetApplied', properties: { slot: 'display', preset: 'oriedita' } },
    ]);
  });

  it('edits a pen through its row, pt width and dash as multiples', () => {
    render();
    typeInto(input('Valley folds width'), '1.5');
    blur(input('Valley folds width'));
    expect(display().valleyFolds.width).toBe(1.5);

    typeInto(input('Valley folds dash'), '4 2');
    blur(input('Valley folds dash'));
    expect(display().valleyFolds.dash).toEqual([4, 2]);

    // A dash that is not one is put back rather than written.
    typeInto(input('Valley folds dash'), '4 x');
    blur(input('Valley folds dash'));
    expect(display().valleyFolds.dash).toEqual([4, 2]);
    expect(input('Valley folds dash').value).toBe('4 2');

    // Clearing the field is a solid pen.
    typeInto(input('Valley folds dash'), '');
    blur(input('Valley folds dash'));
    expect(display().valleyFolds.dash).toBeNull();

    typeInto(input('Valley folds color'), '#00ff00');
    expect(display().valleyFolds.color).toBe('#00ff00');
    expect(tracked.map((entry) => entry.properties?.field)).toEqual([
      'valleyFolds',
      'valleyFolds',
      'valleyFolds',
      'valleyFolds',
    ]);
  });

  it('edits erode as a percentage of the sheet', () => {
    render();
    typeInto(input('Erode'), '2.5');
    blur(input('Erode'));
    expect(display().erode).toBe(0.025);
    expect(tracked.map((entry) => entry.properties?.field)).toEqual(['erode']);
  });

  it('disables the export editors while export uses the display style', () => {
    const rendered = render();
    act(() => findButton('Export').click());
    expect(rendered.querySelector('[aria-label="Style"] [aria-pressed="true"]')?.textContent).toBe(
      'Export'
    );
    expect(input('Front').disabled).toBe(true);
    expect(input('Edges width').disabled).toBe(true);
    expect(input('Azimuth').disabled).toBe(true);
    // The aux and light switches too; the follows switch itself stays live.
    expect(styleSwitches(rendered).map((element) => element.hasAttribute('disabled'))).toEqual([
      false,
      true,
      true,
    ]);
    expect((findButton('Apply', presetRow('builtin:oriedita')) as HTMLButtonElement).disabled).toBe(
      true
    );
    // The values shown are display's.
    expect(input('Front').value).toBe(DEFAULT_PAPER_STYLE.paper.front);

    const follows = rendered.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(follows.getAttribute('aria-checked')).toBe('true');
    act(() => follows.click());
    expect(exported()).toEqual(DEFAULT_PAPER_STYLE);
    expect(input('Front').disabled).toBe(false);

    typeInto(input('Front'), '#123456');
    expect(exported()?.paper.front).toBe('#123456');
    expect(display().paper.front).toBe(DEFAULT_PAPER_STYLE.paper.front);
    expect(tracked).toEqual([
      { event: 'paperStyleChanged', properties: { slot: 'export', field: 'paper.front' } },
    ]);
  });

  it('edits the export page: background, hidden faces, sheet size, margin and density', () => {
    const rendered = render();
    const section = rendered.querySelector('[data-testid="settings-paper-export"]')!;
    const switches = () => Array.from(section.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
    // Transparent, keep hidden faces, sheet as shown: all on by default, and
    // neither the background swatch nor the sheet size field shows.
    expect(switches().map((element) => element.getAttribute('aria-checked'))).toEqual([
      'true',
      'true',
      'true',
    ]);
    expect(section.querySelector('input[type="color"]')).toBeNull();
    expect(section.querySelector('input[aria-label="Sheet size"]')).toBeNull();

    act(() => switches()[0]!.click());
    expect(exportPage().background).toBe('#ffffff');
    expect(input('Background').value).toBe('#ffffff');
    act(() => switches()[1]!.click());
    expect(exportPage().keepHiddenFaces).toBe(false);
    act(() => switches()[2]!.click());
    expect(exportPage().sheet).toEqual({ mm: 150 });
    typeInto(input('Sheet size'), '210');
    blur(input('Sheet size'));
    expect(exportPage().sheet).toEqual({ mm: 210 });
    typeInto(input('Margin'), '2');
    blur(input('Margin'));
    expect(exportPage().paddingMm).toBe(2);
    typeInto(input('PNG density'), '300');
    blur(input('PNG density'));
    expect(exportPage().pngDpi).toBe(300);
    // Export page edits are not style edits, and count as none.
    expect(tracked).toEqual([]);
  });

  it('saves the current style under a typed name and can delete it', () => {
    const rendered = render();
    act(() => findButton('Save current as…').click());
    expect(findButton('Save').disabled).toBe(true);
    typeInto(rendered.querySelector<HTMLInputElement>('.settings-paper-name input')!, '  Mine ');
    act(() => findButton('Save').click());
    expect(useSettingsStore.getState().paperStyle.presets.map((preset) => preset.name)).toEqual([
      'Mine',
    ]);
    const row = presetRow('user:Mine');
    expect(row.textContent).toContain('Mine');
    expect(row.textContent).toContain('Saved by you');
    // Built-ins cannot be deleted.
    expect(
      Array.from(presetRow('builtin:ori-default').querySelectorAll('button')).map(
        (button) => button.textContent
      )
    ).not.toContain('Delete');
    act(() => findButton('Delete', row).click());
    expect(useSettingsStore.getState().paperStyle.presets).toEqual([]);
    expect(rendered.querySelector('[data-testid="settings-paper-preset-user:Mine"]')).toBeNull();
  });
});
