/**
 * The Diagram's ‹ › within a constrained step's layer constraints (layer
 * order H9), through the Diagram panel's step detail and the Step pane, over
 * the capture fixtures' kernel and the Layer order engine's fake backend (the
 * global `Worker` replaced by a spy that runs the real worker shell):
 *
 * - **The gate** (plan "Risks", the Fold engine's first load): opening a
 *   diagram with constrained steps, switching between them in Pose and
 *   drawing the Step pane spawns no worker; the first press of the pane's ›
 *   spawns one, the host engine's solutions cursor, and every later press —
 *   the pane's or Pose's toolbar's, one session — steps on it.
 * - The pane's pager reads nothing at rest (D11) and where it stands once
 *   pressed; each press is one undo entry.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import { resetFoldedFigureHandles, setFoldedFigureHandleFree } from '../../cp-workspace/folded/foldedFigureHandles';
import { cpDocument, fakeCaptureRuntime, stepLayerOrderJson, twoSquaresIndex } from '../../diagram/capture/capture.fixtures';
import type { CpCaptureRuntime } from '../../diagram/capture/captureFolded';
import { dropStepSolutionCursor } from '../../diagram/capture/stepSolutionCursor';
import { setLinkedLayerOrder, stepById, type DiagramCpRender, type DiagramCpSource } from '../../diagram/document/diagramDocument';
import { readDiagram, writeDiagram } from '../../diagram/document/diagramFile';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import {
  FAKE_LAYER_ORDER_FIGURE,
  FakeLayerOrderWorker,
  createFakeLayerOrderBackend,
} from '../../layer-order/engine/layerOrderEngine.fixtures';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { byRole } from '../../test/roleQueries';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramPanel } from './DiagramPanel';
import { DiagramStepPanel } from './DiagramStepPanel';

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

/** Every `new Worker(…)`, with what it was asked to run. */
const spawned: { url: string; worker: FakeLayerOrderWorker }[] = [];

class SpyWorker extends FakeLayerOrderWorker {
  constructor(url: URL | string) {
    super(createFakeLayerOrderBackend());
    spawned.push({ url: String(url), worker: this });
  }
}

const sheets = twoSquaresIndex();
const [left, right] = sheetRegions(sheets);
const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();
const FLAT: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 };

/**
 * A record the fake engine restores: two of its faces, by their points about
 * the step's paper frame (the fake fold source's box, centred on (50, 50)),
 * one in front of the other. On the toy figure it leaves three pictures from
 * the front, and restores onto the first.
 */
const face = (k: number) => {
  const [x, y] = FAKE_LAYER_ORDER_FIGURE.facePoints[k]!;
  return { at: [x - 50, y - 50] as const, area: 100 };
};
const RECORD: LayerOrderRecord = { faces: [face(1), face(3)], constraints: [[0, 1, 1]], order: [] };

let root: Root | null = null;
let paneRoot: Root | null = null;
let host: HTMLDivElement | null = null;
let pane: HTMLDivElement | null = null;

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
  // The step detail, and beside it the Step pane, each in a root of its own where a test can look for it.
  host = document.createElement('div');
  pane = document.createElement('div');
  document.body.append(host, pane);
  root = createRoot(host);
  paneRoot = createRoot(pane);
  act(() => {
    root?.render(
      <TooltipProvider>
        <DiagramPanel />
      </TooltipProvider>
    );
    paneRoot?.render(
      <TooltipProvider>
        <DiagramStepPanel />
      </TooltipProvider>
    );
  });
});

afterEach(() => {
  act(() => {
    paneRoot?.unmount();
    root?.unmount();
  });
  root = null;
  paneRoot = null;
  host = null;
  pane = null;
  document.body.replaceChildren();
  dropStepSolutionCursor();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Two linked steps folded flat, each carrying a record, saved and opened again as a file is. */
async function openConstrainedDiagram(): Promise<[string, string]> {
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
  let diagram = setLinkedLayerOrder(state().diagram!, first, stepLayerOrderJson(RECORD));
  diagram = setLinkedLayerOrder(diagram, second, stepLayerOrderJson(RECORD));
  const read = readDiagram(JSON.parse(JSON.stringify(writeDiagram(diagram))))!;
  act(() => state().installDiagram(read));
  return [first, second];
}

/** Let the fake worker's messages, a task each, and the renders they cause land. */
async function flush(turns = 10) {
  await act(async () => {
    for (let i = 0; i < turns; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function until(check: () => boolean, what: string) {
  const deadline = Date.now() + 5_000;
  while (!check() && Date.now() < deadline) await flush(5);
  if (!check()) throw new Error(`never: ${what}`);
}

const openInPose = (stepId: string) =>
  act(() => {
    state().selectDiagramStep(stepId);
    state().openDiagramStep(stepId);
  });
/** The Step pane's Layer order pager: its group, named by the row's label. */
const pager = () => byRole(pane!, 'group', 'Layer order');
const pagerButton = (name: string) => byRole(pager(), 'button', name);
/** What the pager reads out between ‹ and ›: nothing at rest, its width kept hidden. */
const readout = () => {
  const live = pager().querySelector<HTMLElement>('[aria-live]')!;
  const shown = live.cloneNode(true) as HTMLElement;
  for (const hidden of shown.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return shown.textContent?.trim() ?? '';
};
const toolbarButton = (name: string) => byRole(byRole(host!, 'toolbar', 'Pose'), 'button', name);
const click = (element: Element) => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const layerOrderOf = (stepId: string) => (stepById(state().diagram!, stepId)!.source as DiagramCpSource).layerOrder;
const idle = () => Object.keys(state().diagramCaptures).length === 0;

describe('a constrained step’s ‹ › in the Step pane and Pose (H9)', () => {
  it('spawns no worker as the diagram opens and its steps are switched and drawn; the first press spawns one, and every press steps on it', async () => {
    const [first, second] = await openConstrainedDiagram();
    for (const stepId of [first, second, first]) {
      openInPose(stepId);
      await flush();
      // The pager, from saved data: both verbs offered, nothing read out.
      expect(pagerButton('Next Layer Order').hasAttribute('aria-disabled')).toBe(false);
      expect(pagerButton('Previous Layer Order').hasAttribute('aria-disabled')).toBe(false);
      expect(readout()).toBe('');
    }
    expect(spawned).toHaveLength(0);

    const entries = state().diagramHistory.past.length;
    const before = layerOrderOf(first);
    click(pagerButton('Next Layer Order'));
    await until(() => idle() && layerOrderOf(first) !== before, 'the step landed');
    expect(spawned).toHaveLength(1);
    expect(new URL(spawned[0]!.url).pathname).toMatch(/\/src\/workers\/layerOrderWorker\.ts$/);
    // Restored once, then stepped; the order it moved to read back and saved for the fold.
    expect(spawned[0]!.worker.backend.calls.slice(0, 2)).toEqual(['restore', 'step']);
    expect(spawned[0]!.worker.terminated).toBe(false);
    await until(() => readout() !== '', 'the pager read out where it stands');
    expect(readout()).toBe('2 of 3');
    expect(state().diagramHistory.past.slice(entries).map((entry) => entry.label)).toEqual(['Show another solution']);

    // Pose's toolbar's ›: the same session, the same worker. At the last, both pagers' › wait; neither wraps.
    const landed = layerOrderOf(first);
    click(toolbarButton('Next Layer Order'));
    await until(() => idle() && layerOrderOf(first) !== landed, 'the toolbar’s step landed');
    expect(spawned).toHaveLength(1);
    await until(() => readout() === '3 of 3', 'the pager counted on');
    expect(pagerButton('Next Layer Order').getAttribute('aria-disabled')).toBe('true');
    expect(toolbarButton('Next Layer Order').getAttribute('aria-disabled')).toBe('true');
    // The toolbar never reads out a place (Round 4).
    expect(byRole(host!, 'toolbar', 'Pose').textContent).not.toMatch(/\d of \d/);

    // ‹ back, from the pane, to the first: there it waits.
    click(pagerButton('Previous Layer Order'));
    await until(() => idle() && readout() === '2 of 3', 'back one');
    click(pagerButton('Previous Layer Order'));
    await until(() => idle() && readout() === '1 of 3', 'back to the first');
    expect(pagerButton('Previous Layer Order').getAttribute('aria-disabled')).toBe('true');
    expect(spawned).toHaveLength(1);
    expect(state().diagramHistory.past.slice(entries).map((entry) => entry.label)).toEqual([
      'Show another solution',
      'Show another solution',
      'Show previous solution',
      'Show previous solution',
    ]);

    // Another step: the cursor goes with its worker, and nothing reads out there.
    openInPose(second);
    await flush();
    expect(spawned[0]!.worker.terminated).toBe(true);
    expect(readout()).toBe('');
  }, 30_000);
});
