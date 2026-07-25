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
