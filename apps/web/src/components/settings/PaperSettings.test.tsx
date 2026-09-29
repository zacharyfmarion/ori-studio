import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { builtInPaperPreset } from '../../lib/paper/paperPresets';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { useSettingsStore } from '../../store/settingsStore';
import { TooltipProvider } from '../ui/Tooltip';
import { PaperSettings } from './PaperSettings';
import { SettingsNestedDialogContext } from './settingsNestedDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tracked: { event: string; properties?: Record<string, unknown> }[] = [];
vi.mock('../../analytics', () => ({
  ANALYTICS_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  track: (event: string, properties?: Record<string, unknown>) => {
    tracked.push(properties ? { event, properties } : { event });
  },
}));

// The unsaved-changes prompt is a command dialog; the host that answers it is
// the app's, so the answer is the test's to give.
const requestChoice = vi.hoisted(() => vi.fn<(options: unknown) => Promise<string | null>>());
vi.mock('../../store/commandDialogStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/commandDialogStore')>()),
  requestChoice,
}));

const initialSettings = useSettingsStore.getInitialState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;
/** What the Settings modal is told about a dialog the tab opened over it. */
const nestedDialog = vi.fn<(open: boolean) => void>();

function render(): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  // The preset cards' verbs are IconButtons, which carry a tooltip; the app
  // mounts one provider at its root.
  act(() =>
    root?.render(
      <SettingsNestedDialogContext.Provider value={nestedDialog}>
        <TooltipProvider delayDuration={0}>
          <PaperSettings />
        </TooltipProvider>
      </SettingsNestedDialogContext.Provider>
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
const styleSwitches = (within: ParentNode) => Array.from(within.querySelectorAll('[role="switch"]'));

beforeEach(() => {
  tracked.length = 0;
  requestChoice.mockReset();
  nestedDialog.mockReset();
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
      'settings-paper-preset-builtin:default',
      'settings-paper-preset-builtin:diagram',
    ]);
    // Two paper swatches and one per pen.
    expect(rendered.querySelectorAll('input[type="color"]')).toHaveLength(9);
    expect(input('Front').value).toBe(DEFAULT_PAPER_STYLE.paper.front);
    expect(input('Mountain folds width').value).toBe('0.825');
    // The dash is picked by name from a menu: the default fold is a crease
    // pattern's, solid, and the default diagram crease a diagram's dash-dot.
    expect(dashTrigger('Mountain folds dash').textContent).toBe('Solid');
    expect(dashTrigger('Mountain diagram creases dash').textContent).toBe('Dash-dot');
    // The light is aimed on the disc, which says where it is aimed.
    expect(
      rendered.querySelector('.settings-paper-light__disc')?.getAttribute('aria-label')
    ).toBe('Light direction: azimuth 322°, elevation 43°');
    // Erode, as a percentage of the sheet.
    expect(input('Erode').value).toBe('0');
    // The aux toggle, the simulations' folds-as-edges switch and the light
    // switch are Radix switches named by their row; the slot's own state is
    // the segmented control and the banner, not a switch of its own. The
    // Default preset shows aux creases and lights the paper, and draws a
    // simulation's folds by direction.
    const switches = styleSwitches(rendered);
    expect(switches).toHaveLength(3);
    expect(switches.map((element) => element.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
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
    ).toEqual(['Presets', 'Paper', 'Lines', 'Steps', 'Folded paper']);
    expect(
      Array.from(rendered.querySelectorAll('.settings-paper__hint')).map(
        (element) => element.textContent
      )
    ).toEqual([
      'Simulations, folded figures, the pattern in References',
      'References only',
      'Simulator, folded figures',
    ]);
    // Two colour cards, one per pen and the folded-paper card; the preset
    // grid is cards of its own rather than one boxed group.
    expect(rendered.querySelectorAll('.settings-paper__card')).toHaveLength(10);
    expect(rendered.querySelector('.settings-section, .settings-section__title')).toBeNull();
  });

  /**
   * A fold is a line of a crease pattern and a diagram crease the instruction
   * on a step, so the fold pens sit with the lines every drawing is made of
   * and the diagram-crease pens with the arrows only a step draws.
   */
  it('puts the fold pens under Lines and the diagram-crease pens under Steps', () => {
    const rendered = render();
    const pensUnder = (eyebrow: string) => {
      const section = Array.from(rendered.querySelectorAll('.settings-paper__section')).find(
        (element) => element.querySelector('.settings-paper__eyebrow')?.textContent === eyebrow
      )!;
      return Array.from(section.querySelectorAll('.settings-paper-pen')).map((card) =>
        card.getAttribute('data-testid')?.replace('settings-paper-pen-', '')
      );
    };
    expect(pensUnder('Lines')).toEqual(['Edges', 'Mountain folds', 'Valley folds', 'Auxiliary creases']);
    expect(pensUnder('Steps')).toEqual(['Mountain diagram creases', 'Valley diagram creases', 'Arrows']);
  });

  it('edits a diagram-crease pen on its own field, leaving the fold pen alone', () => {
    render();
    typeInto(input('Valley diagram creases color'), '#00ff00');
    expect(display().valleyDiagramCreases.color).toBe('#00ff00');
    expect(display().valleyFolds).toEqual(DEFAULT_PAPER_STYLE.valleyFolds);
    typeInto(input('Mountain diagram creases width'), '1.5');
    blur(input('Mountain diagram creases width'));
    expect(display().mountainDiagramCreases.width).toBe(1.5);
    expect(display().mountainFolds).toEqual(DEFAULT_PAPER_STYLE.mountainFolds);
    expect(tracked.map((entry) => entry.properties?.field)).toEqual([
      'valleyDiagramCreases',
      'mountainDiagramCreases',
    ]);
  });

  it('applies a preset to the store and counts it', () => {
    render();
    act(() => presetCard('builtin:diagram').click());
    expect(display()).toEqual(builtInPaperPreset('diagram').style);
    expect(input('Mountain folds width').value).toBe('0.75');
    expect(tracked).toEqual([
      { event: 'paperPresetApplied', properties: { slot: 'display', preset: 'diagram' } },
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
   * really use — pt at 4/3, and the dash multiples against that width — on
   * both sides of the paper the pen draws on: the front on the left, the back
   * on the right, and the one line across the two.
   */
  it('draws each pen’s live sample at the width, dash and cap it will really use', () => {
    const rendered = render();
    const strip = (pen: string) =>
      rendered
        .querySelector(`[data-testid="settings-paper-pen-${pen}"]`)!
        .querySelector('.settings-paper-pen__sample')!;
    const sample = (pen: string) => strip(pen).querySelector('line')!;
    /** Every pen card's two halves, front and back, arrows included. */
    const sides = () =>
      Array.from(rendered.querySelectorAll('.settings-paper-pen')).map((card) =>
        ['front', 'back'].map((side) =>
          card
            .querySelector(`.settings-paper-pen__sample rect[data-side="${side}"]`)
            ?.getAttribute('fill')
        )
      );
    const { front, back } = DEFAULT_PAPER_STYLE.paper;
    expect(sides()).toEqual(Array.from({ length: 7 }, () => [front, back]));
    // The front is the left half, and the line runs from it (11 px in) onto
    // the back (95% across).
    expect(strip('Edges').querySelector('rect[data-side="front"]')?.getAttribute('width')).toBe(
      '50%'
    );
    expect([sample('Edges').getAttribute('x1'), sample('Edges').getAttribute('x2')]).toEqual([
      '11',
      '95%',
    ]);

    // 0.825 pt is 1.1 CSS px, the width every surface draws a fold at.
    expect(sample('Mountain folds').getAttribute('stroke-width')).toBe('1.1');
    expect(sample('Mountain folds').getAttribute('stroke')).toBe(
      DEFAULT_PAPER_STYLE.mountainFolds.color
    );
    // Solid by default; the multiples resolve against the pen's own width:
    // 8 2 1 2 at 1.1 px.
    expect(sample('Mountain folds').getAttribute('stroke-dasharray')).toBeNull();
    expect(sample('Mountain diagram creases').getAttribute('stroke-dasharray')).toBe('8.8 2.2 1.1 2.2');
    // A step's diagram creases, drawn at their own pens the same way.
    expect(sample('Valley diagram creases').getAttribute('stroke')).toBe(
      DEFAULT_PAPER_STYLE.valleyDiagramCreases.color
    );
    expect(sample('Valley diagram creases').getAttribute('stroke-dasharray')).toBe('4.4 2.2');
    expect(sample('Arrows').getAttribute('stroke-linecap')).toBe('round');

    act(() => dashTrigger('Mountain folds dash').click());
    act(() => findButton('Dash-dot', document.querySelector('[role="menu"]')!).click());
    expect(sample('Mountain folds').getAttribute('stroke-dasharray')).toBe('8.8 2.2 1.1 2.2');

    // Live: a paper colour picked is the ground every sample shows on that side.
    typeInto(input('Back'), '#123456');
    expect(sides()).toEqual(Array.from({ length: 7 }, () => [front, '#123456']));
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
      true,
    ]);
    expect(presetCard('builtin:diagram').disabled).toBe(true);
    // The values shown are display's, and the chip says so.
    expect(input('Front').value).toBe(DEFAULT_PAPER_STYLE.paper.front);
    expect(chip().textContent).toBe('Default, from display');

    act(() => findButton('Detach').click());
    expect(exported()).toEqual(DEFAULT_PAPER_STYLE);
    expect(rendered.querySelector('.settings-paper__style')?.hasAttribute('inert')).toBe(false);
    expect(input('Front').disabled).toBe(false);
    expect(banner().textContent).toContain('no longer follow the display style');

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
    expect(chip().textContent).toBe('Default');
    expect(chip().getAttribute('data-state')).toBe('preset');
    expect(rendered.querySelector('button.settings-paper__slot-action')).toBeNull();

    act(() => presetCard('builtin:diagram').click());
    expect(chip().textContent).toBe('Diagram');
    expect(presetCard('builtin:diagram').getAttribute('aria-pressed')).toBe('true');
    expect(presetCard('builtin:default').getAttribute('aria-pressed')).toBe('false');

    typeInto(input('Erode'), '2.5');
    expect(chip().textContent).toBe('Diagram · modified');
    expect(chip().getAttribute('data-state')).toBe('modified');

    act(() => findButton('Revert').click());
    expect(display()).toEqual(builtInPaperPreset('diagram').style);
    expect(chip().textContent).toBe('Diagram');
  });

  it('offers Update beside Revert for a changed saved preset, and not for a built-in', () => {
    render();
    const buttons = () =>
      Array.from(container!.querySelectorAll<HTMLButtonElement>('.settings-paper__slot-row button')).map(
        (button) => button.textContent
      );
    act(() => presetCard('builtin:diagram').click());
    typeInto(input('Erode'), '2.5');
    expect(buttons()).toContain('Revert');
    expect(buttons()).not.toContain('Update');

    act(() => useSettingsStore.getState().savePaperPreset('Mine'));
    typeInto(input('Erode'), '1');
    expect(chip().textContent).toBe('Mine · modified');
    expect(buttons()).toEqual(expect.arrayContaining(['Update', 'Revert']));

    act(() => findButton('Update').click());
    expect(chip().textContent).toBe('Mine');
    expect(useSettingsStore.getState().paperStyle.presets[0]!.style.erode).toBeCloseTo(0.01, 9);
    expect(buttons()).not.toContain('Update');
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
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      // The square, its four creases and the two faces of the little figure.
      expect(card.querySelectorAll('.settings-paper-preset__thumb line')).toHaveLength(4);
      expect(card.querySelectorAll('.settings-paper-preset__thumb path')).toHaveLength(2);
    }
    const diagram = builtInPaperPreset('diagram').style;
    expect(
      presetRow('builtin:diagram')
        .querySelector('.settings-paper-preset__thumb line')
        ?.getAttribute('stroke')
    ).toBe(diagram.mountainFolds.color);
    expect(
      presetRow('builtin:default')
        .querySelector('.settings-paper-preset__thumb line')
        ?.getAttribute('stroke')
    ).toBe(DEFAULT_PAPER_STYLE.mountainFolds.color);
  });

  // Re-pinned for X7: the tab had an Export page section editing the one page
  // every export went out on. Each kind of export remembers its own now, and
  // the export dialog is the only place that edits them.
  it('offers no export page, which is the export dialog’s to edit', () => {
    const rendered = render();
    expect(rendered.querySelector('[data-testid="settings-paper-export"]')).toBeNull();
    expect(rendered.textContent).not.toContain('Export page');
    for (const label of ['Background', 'Sheet size', 'Margin', 'PNG density']) {
      expect(rendered.querySelector(`input[aria-label="${label}"]`), label).toBeNull();
    }
    expect(rendered.textContent).not.toContain('Transparent background');
    expect(rendered.textContent).not.toContain('Keep hidden faces');
  });

  it('asks before a preset replaces unsaved edits, and keeps them as a preset first on request', async () => {
    const rendered = render();
    typeInto(input('Erode'), '2.5');
    const edited = display();
    requestChoice.mockResolvedValueOnce('save');
    await act(async () => presetCard('builtin:diagram').click());
    const prompt = requestChoice.mock.calls[0]![0] as { title: string; message: string };
    expect(prompt.title).toBe('Unsaved changes');
    expect(prompt.message).toContain('Applying Diagram');
    // Over Settings, whose Escape is the dialog's while it is up.
    expect(nestedDialog.mock.calls).toEqual([[true], [false]]);
    // Nothing is applied yet: the edits are asked a name first.
    expect(display()).toBe(edited);
    expect(rendered.querySelector('.settings-paper-name__why')?.textContent).toBe(
      'Name a preset for your changes. Diagram is applied once it is saved.'
    );
    typeInto(rendered.querySelector<HTMLInputElement>('.settings-paper-name input')!, 'Mine');
    act(() => findButton('Save').click());
    expect(useSettingsStore.getState().paperStyle.presets).toEqual([
      { version: 1, name: 'Mine', style: edited },
    ]);
    expect(display()).toEqual(builtInPaperPreset('diagram').style);
    expect(chip().textContent).toBe('Diagram');
    expect(rendered.querySelector('.settings-paper-name')).toBeNull();
    expect(tracked).toContainEqual({
      event: 'paperPresetUnsavedChanges',
      properties: { slot: 'display', choice: 'save' },
    });
  });

  it('throws unsaved edits away on Discard, and keeps them on Cancel', async () => {
    render();
    typeInto(input('Erode'), '2.5');
    const edited = display();
    requestChoice.mockResolvedValueOnce(null);
    await act(async () => presetCard('builtin:diagram').click());
    expect(display()).toBe(edited);
    expect(container!.querySelector('.settings-paper-name')).toBeNull();

    requestChoice.mockResolvedValueOnce('discard');
    await act(async () => presetCard('builtin:diagram').click());
    expect(display()).toEqual(builtInPaperPreset('diagram').style);
    expect(
      tracked.filter((entry) => entry.event === 'paperPresetUnsavedChanges').map((entry) => entry.properties)
    ).toEqual([
      { slot: 'display', choice: 'cancel' },
      { slot: 'display', choice: 'discard' },
    ]);
  });

  it('stops asking for a name once another pick throws the edits away', async () => {
    render();
    typeInto(input('Erode'), '2.5');
    requestChoice.mockResolvedValueOnce('save');
    await act(async () => presetCard('builtin:diagram').click());
    expect(container!.querySelector('.settings-paper-name')).not.toBeNull();

    requestChoice.mockResolvedValueOnce('discard');
    await act(async () => presetCard('builtin:default').click());
    expect(display()).toEqual(builtInPaperPreset('default').style);
    expect(container!.querySelector('.settings-paper-name')).toBeNull();
    expect(container!.querySelector('.settings-paper-name__why')).toBeNull();
  });

  it('applies a preset without asking when nothing would be lost', () => {
    render();
    act(() => presetCard('builtin:diagram').click());
    act(() => presetCard('builtin:default').click());
    expect(requestChoice).not.toHaveBeenCalled();
    expect(display()).toEqual(builtInPaperPreset('default').style);
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
    expect(iconButton('Download preset Default')).not.toBeNull();
    expect(container!.querySelector('button[aria-label="Delete Default"]')).toBeNull();
    act(() => iconButton('Delete Mine').click());
    expect(useSettingsStore.getState().paperStyle.presets).toEqual([]);
    expect(rendered.querySelector('[data-testid="settings-paper-preset-user:Mine"]')).toBeNull();
  });
});
