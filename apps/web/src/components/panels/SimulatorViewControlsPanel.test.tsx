import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SIMULATOR_SETTINGS } from '../../lib/simulatorSettings';
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
});

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

  it('disables hidden lines while crease lines are off', () => {
    const rendered = render();
    expect(
      rendered.querySelector<HTMLButtonElement>('[aria-label="Hidden lines"]')?.disabled
    ).toBe(false);

    act(() => {
      useWorkspaceStore.getState().setSimulatorSetting('showEdges', false);
    });

    expect(
      rendered.querySelector<HTMLButtonElement>('[aria-label="Hidden lines"]')?.disabled
    ).toBe(true);
  });

  it('commits a material slider to the store', () => {
    const rendered = render();
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
    act(() => {
      const store = useWorkspaceStore.getState();
      store.setSimulatorSetting('creaseStiffness', 3);
      store.setSimulatorSetting('lighting', false);
    });

    act(() => {
      rendered.querySelector<HTMLButtonElement>('[aria-label="Reset material"]')?.click();
    });

    const settings = useWorkspaceStore.getState().simulatorSettings;
    expect(settings.creaseStiffness).toBe(DEFAULT_SIMULATOR_SETTINGS.creaseStiffness);
    // Render options are not material, so the reset leaves them alone.
    expect(settings.lighting).toBe(false);
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

describe('style sections', () => {
  /** A collapsible section by its visible title. */
  function section(rendered: HTMLDivElement, title: string): HTMLElement {
    const found = [
      ...rendered.querySelectorAll<HTMLElement>('.simulator-view-controls-panel__section'),
    ].find(
      (element) =>
        element.querySelector('.simulator-view-controls-panel__section-title')?.textContent ===
        title
    );
    if (!found) throw new Error(`no section titled ${title}`);
    return found;
  }

  function toggle(rendered: HTMLDivElement, title: string): void {
    const button = section(rendered, title).querySelector<HTMLButtonElement>(
      '.simulator-view-controls-panel__section-toggle'
    );
    if (!button) throw new Error(`section ${title} is not collapsible`);
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  it('starts the style sections collapsed, rendering none of their controls', () => {
    // Styling is secondary; open by default it pushed Material and Solver below
    // the fold. Follows GridSettingsSection in the Edit workspace's view pane.
    const rendered = render();
    for (const title of ['Paper', 'Creases', 'Export']) {
      const element = section(rendered, title);
      expect(element.hasAttribute('data-open')).toBe(false);
      expect(element.querySelectorAll('.control-row')).toHaveLength(0);
    }
    // Render stays open: it is the one people came for. Asserted on the toggle
    // class rather than aria-expanded, which the Radix selects inside it carry.
    expect(
      section(rendered, 'Render').querySelector('.simulator-view-controls-panel__section-toggle')
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

  it('offers a colour reset only once the colour is overridden', () => {
    // Absence of the affordance is the signal that the value still follows the
    // theme, so it must not be there by default.
    const rendered = render();
    toggle(rendered, 'Paper');
    expect(rendered.querySelector('.color-field__clear')).toBeNull();

    act(() => {
      useWorkspaceStore.getState().setSimulatorSetting('paperFront', '#ff8800');
    });
    expect(rendered.querySelector('.color-field__clear')).not.toBeNull();
    expect(
      rendered.querySelector<HTMLInputElement>('[aria-label="Front"]')?.value
    ).toBe('#ff8800');
  });

  it('disables the per-kind swatches under a mono crease style', () => {
    // They no longer affect anything there, and a live control that does nothing
    // promises an effect it cannot deliver.
    const rendered = render();
    toggle(rendered, 'Creases');
    const mountain = () => rendered.querySelector<HTMLInputElement>('[aria-label="Mountain"]');
    expect(mountain()?.disabled).toBe(false);

    act(() => {
      useWorkspaceStore.getState().setSimulatorSetting('creaseStyle', 'mono');
    });
    expect(mountain()?.disabled).toBe(true);
    // The edge ink is what mono paints with, so it stays editable.
    expect(rendered.querySelector<HTMLInputElement>('[aria-label="Edge"]')?.disabled).toBe(false);
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
