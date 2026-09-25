import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearReferencesResults } from '../../cp-workspace/references/referencesResults';
import { registerReferencesShortcutExecutor } from '../../keyboard/shortcutRuntime';
import { DEFAULT_REFERENCES_SETTINGS } from '../../store/workspaceStore/slices/referencesSlice';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { usePaperExportUiStore } from '../../store/paperExportUiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { ReferencesViewControlsPanel } from './ReferencesViewControlsPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** Only the fields the References bindings read. */
const DOCUMENT = {
  handle: 1,
  loadSerial: 1,
  document: { crease_pattern: { line_segments: [] }, metadata: {} },
  geometry: null,
  summary: {},
  source: { format: 'cp', filename: 'x.cp', path: null },
  operationDescriptors: [],
  lastCommandResult: null,
};

function render(): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider>
        <ReferencesViewControlsPanel />
      </TooltipProvider>
    );
  });
  return container;
}

function toggle(rendered: HTMLDivElement, label: string): HTMLButtonElement {
  const found = rendered.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`no toggle labelled ${label}`);
  return found;
}

function press(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function buttonNamed(rendered: HTMLDivElement, name: string): HTMLButtonElement {
  const found = [...rendered.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent?.trim() === name
  );
  if (!found) throw new Error(`no button named ${name}`);
  return found;
}

const settings = () => useWorkspaceStore.getState().referencesSettings;

beforeEach(() => {
  clearReferencesResults();
  useWorkspaceStore.setState({ oristudioCpDocument: DOCUMENT } as never);
});

afterEach(() => {
  useSettingsStore.getState().setReferencesShowAuxCreases(null);
  useSettingsStore.getState().setPaperStyleFields('display', {
    'auxCreases.visible': DEFAULT_PAPER_STYLE.auxCreases.visible,
  });
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  clearReferencesResults();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('ReferencesViewControlsPanel', () => {
  it('shows every setting the popover used to hold, as visible controls', () => {
    const rendered = render();

    expect(rendered.textContent).toContain('Candidates');
    expect(rendered.textContent).toContain('Precreasing sequence');
    expect(
      [...rendered.querySelectorAll('button[role="switch"]')].map((button) =>
        button.getAttribute('aria-label')
      )
    ).toEqual([
      'Include approximate solutions',
      'Landmarks first',
      'Precrease grid',
      'Only where needed',
      'Allow dangling folds',
      'Merge symmetric steps',
      'Auto-play folds',
      'Show auxiliary creases',
    ]);
    // The candidate count is the one setting that is not a switch.
    expect(rendered.querySelector('button[aria-label="Solutions"]')?.textContent).toContain(
      String(DEFAULT_REFERENCES_SETTINGS.candidateCount)
    );
  });

  it('asks for a crease pattern before offering anything', () => {
    useWorkspaceStore.setState({ oristudioCpDocument: null } as never);

    const rendered = render();

    expect(rendered.querySelector('.empty-note')).not.toBeNull();
    expect(rendered.querySelector('button[role="switch"]')).toBeNull();
  });

  it('writes a setting through to the store', () => {
    const rendered = render();
    expect(settings().includeApproximate).toBe(false);

    press(toggle(rendered, 'Include approximate solutions'));

    expect(settings().includeApproximate).toBe(true);
    expect(toggle(rendered, 'Include approximate solutions').getAttribute('aria-checked')).toBe(
      'true'
    );
  });

  it('flips landmarks first through the same toggle the chord uses', () => {
    // View state rather than a setting: the store's toggle is what the
    // `references.toggleLandmarksFirst` chord and the context menu call, and it
    // also resets the step, so the pane must not write the flag on its own.
    const rendered = render();
    useWorkspaceStore.getState().setReferencesView({ activeStep: 3 });

    press(toggle(rendered, 'Landmarks first'));

    expect(useWorkspaceStore.getState().referencesView).toMatchObject({
      landmarksFirst: true,
      activeStep: 0,
    });
    expect(toggle(rendered, 'Landmarks first').getAttribute('aria-checked')).toBe('true');
  });

  it('follows the candidate count from the store', () => {
    const rendered = render();

    act(() => useWorkspaceStore.getState().setReferencesSettings({ candidateCount: 10 }));

    expect(rendered.querySelector('button[aria-label="Solutions"]')?.textContent).toContain('10');
  });

  it('nests "only where needed" under the grid and disables it while the grid is off', () => {
    const rendered = render();
    const row = toggle(rendered, 'Only where needed').closest('.control-row');
    expect(row?.classList.contains('control-row--nested')).toBe(true);
    expect(toggle(rendered, 'Only where needed').disabled).toBe(false);

    press(toggle(rendered, 'Precrease grid'));

    expect(settings().precreaseGrid).toBe(false);
    expect(toggle(rendered, 'Only where needed').disabled).toBe(true);
    expect(row?.getAttribute('data-disabled')).toBe('true');
  });

  it('explains "allow dangling folds" from an info mark beside its label', () => {
    const rendered = render();
    const help = rendered.querySelector<HTMLButtonElement>('.control-row__help');
    expect(help).not.toBeNull();
    expect(help?.closest('.control-row')?.textContent).toContain('Allow dangling folds');
    // The explanation is the mark's accessible name, so it reads without the
    // hover as well.
    expect(help?.getAttribute('aria-label')).toContain('A dangling fold is a crease');
    // Only the rows whose names do not say what they do carry one.
    expect(rendered.querySelectorAll('.control-row__help')).toHaveLength(4);

    expect(settings().allowDanglingFolds).toBe(true);
    press(toggle(rendered, 'Allow dangling folds'));
    expect(settings().allowDanglingFolds).toBe(false);
  });

  // Two folds that mirror each other are one card, as a diagram folds them;
  // the setting is on by default and turns that off.
  it('merges symmetric steps by default, and the toggle turns it off', () => {
    const rendered = render();
    const help = [...rendered.querySelectorAll<HTMLButtonElement>('.control-row__help')].find(
      (mark) => mark.closest('.control-row')?.textContent?.includes('Merge symmetric steps')
    );
    expect(help?.getAttribute('aria-label')).toContain('mirror each other');
    expect(settings().mergeSymmetricSteps).toBe(true);
    press(toggle(rendered, 'Merge symmetric steps'));
    expect(settings().mergeSymmetricSteps).toBe(false);
  });

  // A view option like a folded figure's in Properties: the paper style's own
  // switch until it is set here, with a reset that hands it back.
  it('shows auxiliary creases as the paper style says until set, and resets to it', () => {
    const style = (visible: boolean) =>
      act(() =>
        useSettingsStore.getState().setPaperStyleFields('display', { 'auxCreases.visible': visible })
      );
    style(true);
    const rendered = render();
    const aux = () => toggle(rendered, 'Show auxiliary creases');
    const reset = () =>
      rendered.querySelector<HTMLButtonElement>(
        'button[aria-label="Reset Show auxiliary creases to default"]'
      );
    expect(aux().getAttribute('aria-checked')).toBe('true');
    expect(reset()).toBeNull();

    style(false);
    expect(aux().getAttribute('aria-checked')).toBe('false');

    press(aux());
    expect(useSettingsStore.getState().referencesShowAuxCreases).toBe(true);
    expect(aux().getAttribute('aria-checked')).toBe('true');
    // Set here, it holds whatever the style says.
    style(true);
    style(false);
    expect(aux().getAttribute('aria-checked')).toBe('true');

    press(reset()!);
    expect(useSettingsStore.getState().referencesShowAuxCreases).toBeNull();
    expect(aux().getAttribute('aria-checked')).toBe('false');
    expect(reset()).toBeNull();
  });
});

describe('ReferencesViewControlsPanel export section', () => {
  let unregister: (() => void) | null = null;

  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  it('runs the References view’s export-all-steps command', () => {
    const references = vi.fn();
    unregister = registerReferencesShortcutExecutor(references);
    const rendered = render();

    press(buttonNamed(rendered, 'Export all steps…'));

    expect(references).toHaveBeenCalledTimes(1);
    expect(references).toHaveBeenCalledWith('references.exportAllSteps');
  });

  it('does nothing while no References view is mounted', () => {
    const rendered = render();
    const exportAll = buttonNamed(rendered, 'Export all steps…');

    expect(() => press(exportAll)).not.toThrow();
    expect(usePaperExportUiStore.getState().request).toBeNull();
  });

  it('offers no export before a crease pattern is open', () => {
    useWorkspaceStore.setState({ oristudioCpDocument: null } as never);

    const rendered = render();

    expect(rendered.textContent).not.toContain('Export all steps…');
  });
});
