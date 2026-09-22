import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { applyCreaseStyle, DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { DEFAULT_SIMULATOR_SETTINGS } from '../../lib/simulatorSettings';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { SimulatorViewControlsPanel } from './SimulatorViewControlsPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
});

/** Write the mountain and valley pens of the display style for a quick-switch mode. */
function setCreaseStyle(mode: 'color' | 'mono' | 'mono-dashed'): void {
  const { paperStyle, setPaperStyleField } = useSettingsStore.getState();
  const next = applyCreaseStyle(paperStyle.display, mode);
  setPaperStyleField('display', 'mountainFolds', next.mountainFolds);
  setPaperStyleField('display', 'valleyFolds', next.valleyFolds);
}

function render(): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider>
        <SimulatorViewControlsPanel />
      </TooltipProvider>
    );
  });
  return container;
}

function slider(rendered: HTMLDivElement, label: string): HTMLInputElement {
  const found = rendered.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!found) throw new Error(`no slider labelled ${label}`);
  return found;
}

/** A section by its visible title. */
function section(rendered: HTMLDivElement, title: string): HTMLElement {
  const found = [
    ...rendered.querySelectorAll<HTMLElement>('.collapsible-section'),
  ].find(
    (element) =>
      element.querySelector('.collapsible-section__title')?.textContent === title
  );
  if (!found) throw new Error(`no section titled ${title}`);
  return found;
}

function toggle(rendered: HTMLDivElement, title: string): void {
  const button = section(rendered, title).querySelector<HTMLButtonElement>(
    '.collapsible-section__toggle'
  );
  if (!button) throw new Error(`section ${title} is not collapsible`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/**
 * Drive a controlled range input the way React sees it: assign through the native
 * value setter (React tracks the previous value on the node) and dispatch `input`,
 * which is what React's `onChange` for inputs actually listens to.
 */
function dragSlider(input: HTMLInputElement, value: number): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setValue) throw new Error('no native value setter');
  act(() => {
    setValue.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('SimulatorViewControlsPanel', () => {
  it('renders the render, material, and solver sections', () => {
    const rendered = render();
    expect(rendered.textContent).toContain('Render');
    expect(rendered.textContent).toContain('Material');
    expect(rendered.textContent).toContain('Solver');
  });

  it('writes a render toggle through to the store', () => {
    const rendered = render();
    const toggle = rendered.querySelector<HTMLButtonElement>('[aria-label="Faces"]');
    expect(useWorkspaceStore.getState().simulatorSettings.showFaces).toBe(true);

    act(() => {
      toggle?.click();
    });

    expect(useWorkspaceStore.getState().simulatorSettings.showFaces).toBe(false);
  });

  it('offers no hidden-lines toggle', () => {
    // Re-pinned: the row used to disable while crease lines were off. It is
    // gone outright — the GPU renderer never honoured it, so on every WebGL2
    // machine the switch did nothing.
    const rendered = render();
    expect(rendered.querySelector('[aria-label="Hidden lines"]')).toBeNull();
  });

  it('commits a material slider to the store', () => {
    const rendered = render();
    toggle(rendered, 'Material');
    const input = slider(rendered, 'Crease');

    dragSlider(input, 2.5);

    expect(useWorkspaceStore.getState().simulatorSettings.creaseStiffness).toBe(2.5);
  });

  it('clamps a value outside its range', () => {
    render();
    act(() => {
      useWorkspaceStore.getState().setSimulatorSetting('damping', 99);
    });
    expect(useWorkspaceStore.getState().simulatorSettings.damping).toBe(1);
  });

  it('resets only the material settings', () => {
    const rendered = render();
    // The reset lives in the section header and shows only with the controls it
    // resets, so the section has to be open to reach it.
    toggle(rendered, 'Material');
    act(() => {
      useWorkspaceStore.getState().setSimulatorSetting('creaseStiffness', 3);
      const { paperStyle, setPaperStyleField } = useSettingsStore.getState();
      setPaperStyleField('display', 'light', { ...paperStyle.display.light, enabled: false });
    });

    act(() => {
      rendered.querySelector<HTMLButtonElement>('[aria-label="Reset material"]')?.click();
    });

    const settings = useWorkspaceStore.getState().simulatorSettings;
    expect(settings.creaseStiffness).toBe(DEFAULT_SIMULATOR_SETTINGS.creaseStiffness);
    // Render options are not material, so the reset leaves them alone.
    expect(useSettingsStore.getState().paperStyle.display.light.enabled).toBe(false);
  });

  // Re-pinned: the reset used to apply the whole Ori default preset, which also
  // wiped fields this pane never shows.
  it('resets the style rows it shows to the Ori default, and nothing else', () => {
    const rendered = render();
    toggle(rendered, 'Paper');
    const arrows = { ...DEFAULT_PAPER_STYLE.arrows, color: '#ff00ff' };
    act(() => {
      useWorkspaceStore.getState().setSimulatorSetting('creaseStiffness', 3);
      useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#ff8800');
      useSettingsStore.getState().setPaperStyleField('display', 'arrows', arrows);
    });

    act(() => {
      rendered.querySelector<HTMLButtonElement>('[aria-label="Reset style"]')?.click();
    });

    const display = useSettingsStore.getState().paperStyle.display;
    expect(display.paper).toEqual(DEFAULT_PAPER_STYLE.paper);
    expect(display.arrows).toEqual(arrows);
    expect(useWorkspaceStore.getState().simulatorSettings.creaseStiffness).toBe(3);
  });

  it('reveals the strain clip only in strain colour mode', () => {
    const rendered = render();
    expect(rendered.querySelector('input[aria-label="Red at %"]')).toBeNull();

    act(() => {
      useWorkspaceStore.getState().setSimulatorSetting('colorMode', 'strain');
    });

    expect(rendered.querySelector('input[aria-label="Red at %"]')).not.toBeNull();
  });

  it('shows stability inverted, so dragging right is more stable', () => {
    const rendered = render();
    toggle(rendered, 'Solver');
    const input = slider(rendered, 'Stability');
    const settings = useWorkspaceStore.getState().simulatorSettings;

    // Displayed position is mirrored within the range; the stored value is the
    // engine's timestep scale, where smaller is more stable.
    expect(Number(input.value)).toBeCloseTo(
      Number(input.min) + Number(input.max) - settings.timeStepScale,
      5
    );

    dragSlider(input, Number(input.max));

    expect(useWorkspaceStore.getState().simulatorSettings.timeStepScale).toBeCloseTo(
      Number(input.min),
      5
    );
  });
});

describe('collapsible sections', () => {
  it('starts every section but Render collapsed, rendering none of their controls', () => {
    // Render is the one people came for; everything else is secondary and open
    // by default it pushed the rest below the fold. Follows GridSettingsSection
    // in the Edit workspace's view pane.
    const rendered = render();
    for (const title of ['Paper', 'Creases', 'Export', 'Material', 'Solver']) {
      const element = section(rendered, title);
      expect(element.hasAttribute('data-open')).toBe(false);
      expect(element.querySelectorAll('.control-row')).toHaveLength(0);
    }
    // Render stays open: it is the one people came for. Asserted on the toggle
    // class rather than aria-expanded, which the Radix selects inside it carry.
    expect(
      section(rendered, 'Render').querySelector('.collapsible-section__toggle')
    ).toBeNull();
  });

  it('reveals a section’s controls when opened, and hides them again', () => {
    const rendered = render();
    toggle(rendered, 'Creases');
    expect(section(rendered, 'Creases').hasAttribute('data-open')).toBe(true);
    expect(rendered.querySelector('[aria-label="Mountain"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Valley"]')).not.toBeNull();

    toggle(rendered, 'Creases');
    expect(rendered.querySelector('[aria-label="Mountain"]')).toBeNull();
  });

  it('holds each section’s state independently', () => {
    const rendered = render();
    toggle(rendered, 'Paper');
    expect(section(rendered, 'Paper').hasAttribute('data-open')).toBe(true);
    expect(section(rendered, 'Creases').hasAttribute('data-open')).toBe(false);
  });

  it('shows the display style’s paper, and writes a picked colour back to it', () => {
    // Re-pinned: the swatches used to show a theme token until overridden and
    // offer a clear back to it. The paper style is self-contained — every
    // colour is a hex — so a swatch always shows the paper on screen and there
    // is nothing to clear to.
    const rendered = render();
    toggle(rendered, 'Paper');
    const front = () => rendered.querySelector<HTMLInputElement>('[aria-label="Front"]');
    expect(front()?.value).toBe(DEFAULT_PAPER_STYLE.paper.front);
    expect(rendered.querySelector('.color-field__clear')).toBeNull();

    act(() => {
      useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#ff8800');
    });
    expect(front()?.value).toBe('#ff8800');

    act(() => {
      const input = front();
      if (!input) throw new Error('no front swatch');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '#123456');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(useSettingsStore.getState().paperStyle.display.paper.front).toBe('#123456');
  });

  it('offers the fold line weight in pt, and writes both fold pens', () => {
    // Re-pinned: the slider used to be a CSS-px "Weight" on the simulator
    // settings; it is now the mountain and valley pens' width in the style's
    // own unit, and the label says so.
    const rendered = render();
    toggle(rendered, 'Creases');
    expect(rendered.querySelector('input[aria-label="Weight"]')).toBeNull();
    const input = slider(rendered, 'Fold line weight (pt)');
    expect(Number(input.value)).toBe(DEFAULT_PAPER_STYLE.mountainFolds.width);
    expect(Number(input.min)).toBe(0.4);
    expect(Number(input.max)).toBe(4.5);

    dragSlider(input, 2.5);

    const display = useSettingsStore.getState().paperStyle.display;
    expect(display.mountainFolds.width).toBe(2.5);
    expect(display.valleyFolds.width).toBe(2.5);
    expect(display.edges.width).toBe(DEFAULT_PAPER_STYLE.edges.width);
  });

  it('disables the per-kind swatches under a mono crease style', () => {
    // They no longer affect anything there, and a live control that does nothing
    // promises an effect it cannot deliver.
    const rendered = render();
    toggle(rendered, 'Creases');
    const mountain = () => rendered.querySelector<HTMLInputElement>('[aria-label="Mountain"]');
    expect(mountain()?.disabled).toBe(false);

    act(() => {
      setCreaseStyle('mono');
    });
    expect(mountain()?.disabled).toBe(true);
    // The edge ink is what mono paints with, so it stays editable.
    expect(rendered.querySelector<HTMLInputElement>('[aria-label="Edge"]')?.disabled).toBe(false);
  });

  it('binds the Export group to the app-wide export page', () => {
    // The same page Settings ▸ Paper's "Export page" section edits: one store
    // field, two places to reach it.
    const rendered = render();
    toggle(rendered, 'Export');
    const keep = () => rendered.querySelector<HTMLButtonElement>('[aria-label="Keep hidden faces"]');
    expect(keep()?.getAttribute('aria-checked')).toBe('true');
    act(() => keep()?.click());
    expect(useSettingsStore.getState().paperExport.keepHiddenFaces).toBe(false);

    // A transparent page shows no swatch; a coloured one does, and the swatch
    // writes the page's background. The sheet size field appears the same way.
    expect(rendered.querySelector('input[aria-label="Color"]')).toBeNull();
    expect(rendered.querySelector('[aria-label="Sheet (mm)"]')).toBeNull();
    act(() => {
      useSettingsStore.getState().setPaperExportField('background', '#ffffff');
      useSettingsStore.getState().setPaperExportField('sheet', { mm: 210 });
    });
    const swatch = rendered.querySelector<HTMLInputElement>('input[aria-label="Color"]');
    expect(swatch?.value).toBe('#ffffff');
    expect(rendered.querySelector<HTMLInputElement>('[aria-label="Sheet (mm)"]')?.value).toBe('210');
    act(() => {
      if (!swatch) throw new Error('no background swatch');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(swatch, '#123456');
      swatch.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(useSettingsStore.getState().paperExport.background).toBe('#123456');
  });

  it('labels each swatch to its own input', () => {
    const rendered = render();
    toggle(rendered, 'Paper');
    const field = rendered.querySelector('.color-field--row');
    const label = field?.querySelector('label');
    const input = field?.querySelector('input');
    expect(label?.htmlFor).toBeTruthy();
    expect(label?.htmlFor).toBe(input?.id);
  });
});
