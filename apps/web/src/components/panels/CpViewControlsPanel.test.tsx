import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { CpViewControlsPanel } from './CpViewControlsPanel';
import { CP_TOOL_OPTIONS_PANE_SLOT_ID } from './cpToolOptionsPortal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

function editableCpState(): OristudioCpDocumentState {
  return {
    handle: 1,
    loadSerial: 1,
    source: { format: 'cp', filename: 'editable.cp', path: null },
    operationDescriptors: [],
    lastCommandResult: null,
    summary: {
      title: 'editable',
      line_segments: 4,
      circles: 0,
      points: 0,
      aux_line_segments: 0,
      texts: 0,
      can_save_as_cp: true,
      is_empty: false,
    },
    document: createStarterOristudioCpDocument('editable'),
  };
}

function renderPanel(state: Partial<ReturnType<typeof useWorkspaceStore.getState>>) {
  useWorkspaceStore.setState(
    { ...useWorkspaceStore.getInitialState(), ...state },
    true
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<CpViewControlsPanel />);
  });
  return container;
}

function setNumberInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function commitNumberInput(input: HTMLInputElement, value: string) {
  act(() => {
    input.focus();
  });
  setNumberInputValue(input, value);
  act(() => {
    input.blur();
  });
}

describe('CpViewControlsPanel', () => {
  it('prompts to open a crease pattern when none is editable', () => {
    const view = renderPanel({ oristudioCpDocument: null });
    expect(view.textContent).toContain('Open an editable crease pattern');
    expect(view.querySelector('input[aria-label="Grid size"]')).toBeNull();
  });

  it('toggles grid, snapping, and CAMV visibility and edits grid size', () => {
    const setOristudioCpGridSize = vi.fn(async () => true);
    const view = renderPanel({
      oristudioCpDocument: editableCpState(),
      setOristudioCpGridSize,
    });

    const toolOptionsSlot = view.querySelector<HTMLElement>(`#${CP_TOOL_OPTIONS_PANE_SLOT_ID}`);
    expect(toolOptionsSlot).not.toBeNull();
    expect(toolOptionsSlot?.previousElementSibling?.className).toContain(
      'cp-view-controls-panel__view-options'
    );

    const gridToggle = view.querySelector<HTMLButtonElement>('button[aria-label="Grid"]');
    act(() => gridToggle?.click());
    expect(useWorkspaceStore.getState().oristudioCpViewport.gridVisible).toBe(false);

    const snapToggle = view.querySelector<HTMLButtonElement>('button[aria-label="Snapping"]');
    act(() => snapToggle?.click());
    expect(useWorkspaceStore.getState().oristudioCpViewport.snapToGrid).toBe(false);
    expect(useWorkspaceStore.getState().oristudioCpViewport.snapToVertices).toBe(false);
    expect(useWorkspaceStore.getState().oristudioCpViewport.snapToLines).toBe(false);

    const camvToggle = view.querySelector<HTMLButtonElement>('button[aria-label="CAMV issues"]');
    act(() => camvToggle?.click());
    expect(useWorkspaceStore.getState().oristudioCpViewport.camvIssuesVisible).toBe(false);

    const gridSizeInput = view.querySelector<HTMLInputElement>('input[aria-label="Grid size"]');
    expect(gridSizeInput?.value).toBe('8');
    if (!gridSizeInput) throw new Error('Grid size input did not render');

    commitNumberInput(gridSizeInput, '16');
    expect(setOristudioCpGridSize).toHaveBeenLastCalledWith(16);

    commitNumberInput(gridSizeInput, '0');
    expect(setOristudioCpGridSize).toHaveBeenLastCalledWith(1);
  });

  it('adjusts line style, line width, and point size render options', () => {
    const view = renderPanel({ oristudioCpDocument: editableCpState() });

    expect(view.querySelector('button[aria-label="Line style"]')).not.toBeNull();

    const widthInput = view.querySelector<HTMLInputElement>('input[aria-label="Line width"]');
    expect(widthInput?.value).toBe('1');
    if (!widthInput) throw new Error('Line width input did not render');
    commitNumberInput(widthInput, '3');
    expect(useWorkspaceStore.getState().oristudioCpViewport.lineWidth).toBe(3);
    // Out-of-range widths clamp to the Oriedita [1, 8] range.
    commitNumberInput(widthInput, '99');
    expect(useWorkspaceStore.getState().oristudioCpViewport.lineWidth).toBe(8);

    const pointInput = view.querySelector<HTMLInputElement>('input[aria-label="Point size"]');
    if (!pointInput) throw new Error('Point size input did not render');
    commitNumberInput(pointInput, '4');
    expect(useWorkspaceStore.getState().oristudioCpViewport.pointSize).toBe(4);
  });

  it('edits advanced grid options through the expandable settings section', () => {
    const updateOristudioCpGrid = vi.fn(async () => true);
    const view = renderPanel({
      oristudioCpDocument: editableCpState(),
      updateOristudioCpGrid,
    });

    // The section expands inline within the panel rather than as a popover.
    expect(view.querySelector('.grid-settings__body')).toBeNull();
    const toggle = view.querySelector<HTMLButtonElement>('.grid-settings__toggle');
    act(() => toggle?.click());
    expect(view.querySelector('.grid-settings__body')).not.toBeNull();

    const angleInput = view.querySelector<HTMLInputElement>('input[aria-label="Angle"]');
    expect(angleInput?.value).toBe('90');
    if (!angleInput) throw new Error('Angle input did not render');
    commitNumberInput(angleInput, '30');
    expect(updateOristudioCpGrid).toHaveBeenLastCalledWith(
      { grid_angle: 30 },
      'Set grid angle to 30°'
    );

    // Out-of-range angle is clamped to Oriedita's [1, 179] window.
    commitNumberInput(angleInput, '400');
    expect(updateOristudioCpGrid).toHaveBeenLastCalledWith(
      { grid_angle: 179 },
      'Set grid angle to 179°'
    );

    const xConstant = view.querySelector<HTMLInputElement>(
      'input[aria-label="X scale constant term"]'
    );
    if (!xConstant) throw new Error('X scale input did not render');
    commitNumberInput(xConstant, '2');
    expect(updateOristudioCpGrid).toHaveBeenLastCalledWith(
      { grid_xa: 2, grid_xb: 0, grid_xc: 1 },
      'Set grid X scale'
    );

    const diagonalToggle = view.querySelector<HTMLButtonElement>(
      'button[aria-label="Diagonal gridlines"]'
    );
    act(() => diagonalToggle?.click());
    expect(updateOristudioCpGrid).toHaveBeenLastCalledWith(
      { draw_diagonal_gridlines: true },
      'Show diagonal gridlines'
    );

    const reset = view.querySelector<HTMLButtonElement>('.grid-settings__reset');
    act(() => reset?.click());
    expect(updateOristudioCpGrid).toHaveBeenLastCalledWith(
      {
        grid_xa: 1,
        grid_xb: 0,
        grid_xc: 1,
        grid_ya: 1,
        grid_yb: 0,
        grid_yc: 1,
        grid_angle: 90,
      },
      'Reset grid shape'
    );
  });
});
