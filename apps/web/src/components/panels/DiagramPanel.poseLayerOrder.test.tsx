/**
 * Pose's way into the Layer order dialog (layer order H8), through the
 * Diagram panel's step detail and the dialog's own mount, over the capture
 * fixtures' kernel and the Layer order engine's fake backend (the global
 * `Worker` replaced by a spy):
 *
 * - the Pose toolbar's ‹ › with no readout, then Edit order…;
 * - Edit order… opens the dialog on the fold Pose holds, with no fold of its
 *   own, and Cancel writes nothing;
 * - Pose's keys stand down while the dialog is open: every key a Diagram
 *   step open in Pose answers goes through the app's one keydown chokepoint,
 *   which the dialog, a shortcut barrier, holds; once it closes they answer
 *   again.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import { resetFoldedFigureHandles, setFoldedFigureHandleFree } from '../../cp-workspace/folded/foldedFigureHandles';
import { cpDocument, fakeCaptureRuntime, twoSquaresIndex } from '../../diagram/capture/capture.fixtures';
import type { CpCaptureRuntime } from '../../diagram/capture/captureFolded';
import { stepById, type DiagramCpRender, type DiagramCpSource } from '../../diagram/document/diagramDocument';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { isShortcutBarrierOpen } from '../../keyboard/shortcutDispatcher';
import { FakeLayerOrderWorker, createFakeLayerOrderBackend } from '../../layer-order/engine/layerOrderEngine.fixtures';
import { resetLayerOrderDialogStoreForTest } from '../../layer-order/dialog/layerOrderDialogStore';
import { handleAppKeyDown } from '../../lib/appKeyboard';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { byRole, queryByRole } from '../../test/roleQueries';
import { LayerOrderDialogMount } from '../layer-order/LayerOrderDialogMount';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramPanel } from './DiagramPanel';

const bindings = vi.hoisted(() => ({ runtime: null as CpCaptureRuntime | null }));
vi.mock('../../store/workspaceStore/cpFoldRuntimeBindings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/workspaceStore/cpFoldRuntimeBindings')>()),
  createCpCaptureRuntime: () => bindings.runtime,
}));
vi.mock('../../cp-workspace/sheets/cpSheetIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/sheets/cpSheetIndex')>()),
  ensureCpSheetIndex: vi.fn(async () => sheets),
  peekCpSheetIndex: vi.fn(() => sheets),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every `new Worker(…)`. */
const spawned: FakeLayerOrderWorker[] = [];

class SpyWorker extends FakeLayerOrderWorker {
  constructor() {
    super(createFakeLayerOrderBackend());
    spawned.push(this);
  }
}

const sheets = twoSquaresIndex();
const [left, right] = sheetRegions(sheets);
const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();
const FLAT: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 };

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(async () => {
  spawned.length = 0;
  vi.stubGlobal('Worker', SpyWorker);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-index') ? 100 : 1000;
  });
  setFoldedFigureHandleFree(() => {});
  await resetFoldedFigureHandles();
  useWorkspaceStore.setState(initialState, true);
  useWorkspaceStore.setState({
    oristudioCpDocument: { handle: 1, document: cpDocument(), geometry: null } as unknown as OristudioCpDocumentState,
  });
  bindings.runtime = fakeCaptureRuntime();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <TooltipProvider>
        <DiagramPanel />
        <LayerOrderDialogMount />
      </TooltipProvider>
    )
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.replaceChildren();
  resetLayerOrderDialogStoreForTest();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Two steps linked to the squares, folded flat; the first open in Pose. */
async function twoFlatSteps(): Promise<[string, string]> {
  const link = async (region: typeof left) => {
    const stepId = state().addDiagramStep()!;
    await state().captureDiagramStep(stepId, {
      scope: { kind: 'segment', region: regionReferenceFor(region!) },
      render: FLAT,
      kind: 'diagram-capture',
      label: 'Link pattern',
    });
    return stepId;
  };
  const first = await link(left);
  const second = await link(right);
  act(() => state().selectDiagramStep(first));
  act(() => state().openDiagramStep(first));
  return [first, second];
}

/** Let the fake worker's messages, a task each, and the renders they cause land. */
async function flush(turns = 10) {
  await act(async () => {
    for (let i = 0; i < turns; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function until(check: () => boolean, what: string) {
  const deadline = Date.now() + 3_000;
  while (!check() && Date.now() < deadline) await flush(5);
  if (!check()) throw new Error(`never: ${what}`);
}

const toolbar = () => byRole(host!, 'toolbar', 'Pose');
const toolbarButton = (name: string) => byRole(toolbar(), 'button', name);
const dialog = () => queryByRole(document, 'dialog', 'Layer order');
const click = (element: Element) => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));

/** A key as the app's one keydown listener hands it on, aimed at `target`; whether anything took it. */
function press(key: string, target: EventTarget) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  let claimed = false;
  act(() => {
    claimed = handleAppKeyDown(event, {
      getActiveEditingContext: () => 'diagram',
      getSelection: () => ({}) as never,
      handleMenuAction: () => undefined,
      selectNone: () => {},
    });
  });
  return claimed;
}

describe('Pose’s Edit order…', () => {
  it('steps with ‹ › and no readout, then opens the dialog on the fold Pose holds; Cancel writes nothing', async () => {
    const [first] = await twoFlatSteps();
    // Each button's accessible name: its label, or the words it shows.
    const names = [...toolbar().querySelectorAll('button')].map(
      (button) => button.getAttribute('aria-label') ?? button.textContent
    );
    expect(names.slice(names.indexOf('Previous Layer Order'))).toEqual([
      'Previous Layer Order',
      'Next Layer Order',
      'Edit order…',
      'Spread Layers',
      'Reset Pose',
    ]);
    expect(toolbar().textContent).not.toMatch(/\d of \d|Layer order \d/);
    // A Pose verb first, so Pose holds the step's fold.
    await act(async () => {
      toolbarButton('Rotate Right').click();
      await vi.waitFor(() => expect((stepById(state().diagram!, first)!.source as DiagramCpSource).render).toMatchObject({ rotationDeg: 15 }));
    });
    const folds = vi.mocked(bindings.runtime!.fold).mock.calls.length;
    const entries = state().diagramHistory.past.length;
    expect(spawned).toHaveLength(0);

    const edit = toolbarButton('Edit order…');
    expect(edit.title).toBe('Edit layer order…');
    click(edit);
    await until(() => dialog() !== null, 'the dialog opened');
    // On the fold Pose holds: read, never folded again for the dialog; opened on the order the step shows.
    expect(vi.mocked(bindings.runtime!.fold).mock.calls.length).toBe(folds);
    expect(bindings.runtime!.source).toHaveBeenCalledWith(7);
    expect(dialog()!.textContent).toContain('Step 1');
    await until(() => spawned[0]?.backend.calls.length > 0, 'the dialog’s engine opened');
    expect(spawned[0]!.backend.calls[0]).toBe('openShowing');

    // Cancel: nothing written, nothing held but Pose's own fold.
    click(byRole(dialog()!, 'button', 'Cancel'));
    await until(() => dialog() === null, 'the dialog closed');
    expect(state().diagramHistory.past).toHaveLength(entries);
    expect((stepById(state().diagram!, first)!.source as DiagramCpSource).layerOrder).toBeUndefined();
    expect(spawned[0]!.terminated).toBe(true);
  });

  it('stands Pose’s keys down while the dialog is open, and hands them back once it closes', async () => {
    const [first, second] = await twoFlatSteps();
    // With no dialog, a key Pose answers: the next step.
    expect(press(']', document.body)).toBe(true);
    expect(state().diagramSelectedStepId).toBe(second);
    expect(press('[', document.body)).toBe(true);
    expect(state().diagramSelectedStepId).toBe(first);

    click(toolbarButton('Edit order…'));
    await until(() => dialog() !== null, 'the dialog opened');
    expect(isShortcutBarrierOpen()).toBe(true);
    const detail = state().diagramDetail;
    // Aimed at the page behind it, or into the dialog: nothing moves the step, closes the detail or poses it.
    for (const target of [document.body, dialog()!]) {
      for (const key of [']', '[', 'ArrowRight', 'ArrowLeft', 'End', 'Home', 'Enter']) {
        expect(press(key, target)).toBe(false);
      }
    }
    expect(state().diagramSelectedStepId).toBe(first);
    expect(state().diagramDetail).toBe(detail);
    expect(state().diagramCaptures).toEqual({});

    click(byRole(dialog()!, 'button', 'Cancel'));
    await until(() => dialog() === null, 'the dialog closed');
    expect(isShortcutBarrierOpen()).toBe(false);
    expect(press(']', document.body)).toBe(true);
    expect(state().diagramSelectedStepId).toBe(second);
  });
});
