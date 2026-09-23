import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { builtInPaperPreset } from '../../lib/paper/paperPresets';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { useSettingsStore } from '../../store/settingsStore';
import { TooltipProvider } from '../ui/Tooltip';
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
  // The preset cards' verbs are IconButtons, which carry a tooltip; the app
  // mounts one provider at its root.
  act(() =>
    root?.render(
      <TooltipProvider delayDuration={0}>
        <PaperSettings />
      </TooltipProvider>
    )
  );
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
/** A preset card is one button; pressing it applies that preset. */
const presetCard = (key: string) =>
  presetRow(key).querySelector('.settings-paper-preset__apply') as HTMLButtonElement;
const chip = () => container?.querySelector('.settings-paper__chip') as HTMLElement;
/** A pen's dash is a menu, not a field: the trigger says which dash it is on. */
const dashTrigger = (label: string) =>
  container?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) as HTMLButtonElement;
const iconButton = (label: string) =>
  container?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) as HTMLButtonElement;
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
    // The dash is picked by name from a menu, and the default pen is solid.
    expect(dashTrigger('Mountain folds dash').textContent).toBe('Solid');
    // The light is aimed on the disc, which says where it is aimed.
    expect(
      rendered.querySelector('.settings-paper-light__disc')?.getAttribute('aria-label')
    ).toBe('Light direction: azimuth 322°, elevation 43°');
    // Erode, as a percentage of the sheet.
    expect(input('Erode').value).toBe('0');
    // The aux toggle and the light switch are Radix switches named by their
    // row; the slot's own state is the segmented control and the banner, not a
    // switch of its own.
    const switches = styleSwitches(rendered);
    expect(switches).toHaveLength(2);
    expect(switches.map((element) => element.getAttribute('aria-checked'))).toEqual([
      'true',
      'true',
    ]);
  });

  /**
   * The tab's own furniture, which the rest of the paper work builds on: every
   * group is an eyebrow — with an optional line naming the surfaces it reaches —
   * over its fields, and a group of fields sits on a card. None of it may come
   * from `.settings-section*`, which the other Settings tabs share.
   */
  it('dresses every group as a paper eyebrow, with the field groups on cards', () => {
    const rendered = render();
    expect(
      Array.from(rendered.querySelectorAll('.settings-paper__eyebrow')).map(
        (element) => element.textContent
      )
      // The slot switch is above the groups, in a header of its own, so the
      // first eyebrow is the first group.
    ).toEqual(['Presets', 'Paper', 'Lines', 'Steps', 'Folded paper', 'Export page']);
    expect(
      Array.from(rendered.querySelectorAll('.settings-paper__hint')).map(
        (element) => element.textContent
      )
    ).toEqual([
      'Crease pattern, folded figures, steps',
      'References only',
      'Simulator, folded figures',
    ]);
    // Two colour cards, one per pen, the folded-paper card and the export
    // page; the preset grid is cards of its own rather than one boxed group.
    expect(rendered.querySelectorAll('.settings-paper__card')).toHaveLength(9);
    expect(rendered.querySelector('.settings-section, .settings-section__title')).toBeNull();
  });

  it('applies a preset to the store and counts it', () => {
    render();
    act(() => presetCard('builtin:oriedita').click());
    expect(display()).toEqual(builtInPaperPreset('oriedita').style);
    expect(input('Mountain folds width').value).toBe('0.75');
    expect(tracked).toEqual([
      { event: 'paperPresetApplied', properties: { slot: 'display', preset: 'oriedita' } },
    ]);
  });

  it('edits a pen through its card: width in pt, cap, dash by name, colour', () => {
    const rendered = render();
    typeInto(input('Valley folds width'), '1.5');
    blur(input('Valley folds width'));
    expect(display().valleyFolds.width).toBe(1.5);

    act(() => findButton('Round', rendered.querySelector('[aria-label="Valley folds cap"]')!).click());
    expect(display().valleyFolds.cap).toBe('round');

    act(() => dashTrigger('Valley folds dash').click());
    act(() => findButton('Dashed', document.querySelector('[role="menu"]')!).click());
    expect(display().valleyFolds.dash).toEqual([4, 2]);
    // The menu closes on a pick, and the trigger names what was picked.
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(dashTrigger('Valley folds dash').textContent).toBe('Dashed');

    typeInto(input('Valley folds color'), '#00ff00');
    expect(display().valleyFolds.color).toBe('#00ff00');
    expect(tracked.map((entry) => entry.properties?.field)).toEqual([
      'valleyFolds',
      'valleyFolds',
      'valleyFolds',
      'valleyFolds',
    ]);
  });

  /**
   * The strip under a pen's colour is the only thing on the card that says
   * what the pen looks like, so it is drawn at the width and dash the app will
   * really use — pt at 4/3, and the dash multiples against that width — on the
   * paper the pen draws on.
   */
  it('draws each pen’s live sample at the width, dash and cap it will really use', () => {
    const rendered = render();
    const sample = (pen: string) =>
      rendered
        .querySelector(`[data-testid="settings-paper-pen-${pen}"]`)!
        .querySelector('.settings-paper-pen__sample line')!;

    // 0.825 pt is 1.1 CSS px, the width every surface draws a fold at.
    expect(sample('Mountain folds').getAttribute('stroke-width')).toBe('1.1');
    expect(sample('Mountain folds').getAttribute('stroke')).toBe(
      DEFAULT_PAPER_STYLE.mountainFolds.color
    );
    expect(sample('Mountain folds').getAttribute('stroke-dasharray')).toBeNull();
    expect(sample('Arrows').getAttribute('stroke-linecap')).toBe('round');

    act(() => dashTrigger('Mountain folds dash').click());
    act(() => findButton('Dash-dot', document.querySelector('[role="menu"]')!).click());
    // The multiples resolve against the pen's own width: 8 2 1 2 at 1.1 px.
    expect(sample('Mountain folds').getAttribute('stroke-dasharray')).toBe('8.8 2.2 1.1 2.2');
  });

  it('edits erode as a percentage of the sheet', () => {
    render();
    typeInto(input('Erode'), '2.5');
    expect(display().erode).toBe(0.025);
    expect(tracked.map((entry) => entry.properties?.field)).toEqual(['erode']);
  });

  /**
   * Replaces the "Export uses display style" switch this tab used to carry:
   * the state is now the segmented control's own label and a banner stating
   * what exports will use, with the one press that changes it.
   */
  it('takes the export fields out of the page while they are the display style, and detaches on a press', () => {
    const rendered = render();
    act(() => findButton('Export · linked').click());
    expect(rendered.querySelector('[aria-label="Style"] [aria-pressed="true"]')?.textContent).toBe(
      'Export · linked'
    );
    const banner = () => rendered.querySelector('.settings-paper__banner')!;
    expect(banner().textContent).toContain('Exports use the display style');
    expect(banner().hasAttribute('data-linked')).toBe(true);
    // Inert, not merely disabled: nothing below can be tabbed into or typed at.
    expect(rendered.querySelector('.settings-paper__style')?.hasAttribute('inert')).toBe(true);
    expect(input('Front').disabled).toBe(true);
    expect(input('Edges width').disabled).toBe(true);
    expect(dashTrigger('Edges dash').disabled).toBe(true);
    expect(input('Erode').disabled).toBe(true);
    expect(
      rendered.querySelector<HTMLButtonElement>('.settings-paper-light__disc')?.disabled
    ).toBe(true);
    expect(styleSwitches(rendered).map((element) => element.hasAttribute('disabled'))).toEqual([
      true,
      true,
    ]);
    expect(presetCard('builtin:oriedita').disabled).toBe(true);
    // The values shown are display's, and the chip says so.
    expect(input('Front').value).toBe(DEFAULT_PAPER_STYLE.paper.front);
    expect(chip().textContent).toBe('Ori default, from display');
    // The export page below is not part of the style, and stays live.
    expect(
      rendered
        .querySelector('[data-testid="settings-paper-export"]')
        ?.closest('.settings-paper__style')
    ).toBeNull();

    act(() => findButton('Detach').click());
    expect(exported()).toEqual(DEFAULT_PAPER_STYLE);
    expect(rendered.querySelector('.settings-paper__style')?.hasAttribute('inert')).toBe(false);
    expect(input('Front').disabled).toBe(false);
    expect(banner().textContent).toContain('no longer track the display style');

    typeInto(input('Front'), '#123456');
    expect(exported()?.paper.front).toBe('#123456');
    expect(display().paper.front).toBe(DEFAULT_PAPER_STYLE.paper.front);
    expect(tracked).toEqual([
      { event: 'paperStyleChanged', properties: { slot: 'export', field: 'paper.front' } },
    ]);

    act(() => findButton('Follow display').click());
    expect(exported()).toBeNull();
    expect(banner().hasAttribute('data-linked')).toBe(true);
  });

  /** The display slot has no banner at all: it is nobody's copy. */
  it('shows no link banner on the display slot', () => {
    const rendered = render();
    expect(rendered.querySelector('.settings-paper__banner')).toBeNull();
  });

  it('names the preset on show, marks it modified, and puts it back on Revert', () => {
    const rendered = render();
    // The default style is the first built-in, with nothing recorded yet.
    expect(chip().textContent).toBe('Ori default');
    expect(chip().getAttribute('data-state')).toBe('preset');
    expect(rendered.querySelector('button.settings-paper__revert')).toBeNull();

    act(() => presetCard('builtin:oriedita').click());
    expect(chip().textContent).toBe('Oriedita');
    expect(presetCard('builtin:oriedita').getAttribute('aria-pressed')).toBe('true');
    expect(presetCard('builtin:ori-default').getAttribute('aria-pressed')).toBe('false');

    typeInto(input('Erode'), '2.5');
    expect(chip().textContent).toBe('Oriedita · modified');
    expect(chip().getAttribute('data-state')).toBe('modified');

    act(() => findButton('Revert').click());
    expect(display()).toEqual(builtInPaperPreset('oriedita').style);
    expect(chip().textContent).toBe('Oriedita');
  });

  it('says a style that is no preset’s is nobody’s', () => {
    render();
    typeInto(input('Front'), '#123456');
    expect(chip().textContent).toBe('Custom');
    expect(chip().getAttribute('data-state')).toBe('custom');
    expect(
      Array.from(container!.querySelectorAll('[aria-pressed="true"].settings-paper-preset__apply'))
    ).toEqual([]);
  });

  it('draws a thumbnail of each preset’s own style on its card', () => {
    const rendered = render();
    const cards = Array.from(
      rendered.querySelectorAll('[data-testid^="settings-paper-preset-"]')
    );
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      // The square, its four creases and the two faces of the little figure.
      expect(card.querySelectorAll('.settings-paper-preset__thumb line')).toHaveLength(4);
      expect(card.querySelectorAll('.settings-paper-preset__thumb path')).toHaveLength(2);
    }
    const oriedita = builtInPaperPreset('oriedita').style;
    expect(
      presetRow('builtin:oriedita')
        .querySelector('.settings-paper-preset__thumb line')
        ?.getAttribute('stroke')
    ).toBe(oriedita.mountainFolds.color);
    expect(
      presetRow('builtin:ori-default')
        .querySelector('.settings-paper-preset__thumb line')
        ?.getAttribute('stroke')
    ).toBe(DEFAULT_PAPER_STYLE.mountainFolds.color);
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
    // Saving is applying: the slot is showing the preset it was just named as.
    expect(chip().textContent).toBe('Mine');
    // Built-ins cannot be deleted; every preset can be written to a file.
    expect(iconButton('Download preset Ori default')).not.toBeNull();
    expect(container!.querySelector('button[aria-label="Delete Ori default"]')).toBeNull();
    act(() => iconButton('Delete Mine').click());
    expect(useSettingsStore.getState().paperStyle.presets).toEqual([]);
    expect(rendered.querySelector('[data-testid="settings-paper-preset-user:Mine"]')).toBeNull();
  });
});
