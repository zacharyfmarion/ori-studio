/**
 * A Diagram step's layer order in the Step pane (layer order H7), with the
 * global `Worker` replaced by a spy that runs the real worker shell over the
 * Layer order engine's fake backend:
 *
 * - **The gate** (plan "Risks", the Fold engine's first load): opening a
 *   diagram with constrained steps, selecting them and showing their pane —
 *   the Layer order row, its note and the flag — spawns no worker; only a
 *   capture does, through the host engine.
 * - The row's states by role and name: Edit… after the pager, the
 *   constraints on its note line, ‹ › offered with no readout at rest (H9,
 *   D11), held with its reason on a 3D step (D13); the flag with Review…
 *   (D14).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import { buildDiagramLinkedPoseActions } from '../../diagram/actions/diagramLinkedPoseActions';
import { cpDocument, fakeCaptureRuntime, stepLayerOrderJson, twoSquaresIndex } from '../../diagram/capture/capture.fixtures';
import type { CpCaptureRuntime } from '../../diagram/capture/captureFolded';
import { stepLayerOrderOf } from '../../diagram/capture/captureLayerOrder';
import { publishOpenLinkedPose } from '../../diagram/capture/openLinkedPose';
import { refreshDiagramStep } from '../../diagram/capture/stepCaptureActions';
import type { DiagramLinkedPose } from '../../diagram/capture/useDiagramLinkedPose';
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
import { TooltipProvider } from '../ui/Tooltip';
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
 * the step's paper frame (the fake fold source's box, centred on (50, 50)).
 */
const face = (k: number) => {
  const [x, y] = FAKE_LAYER_ORDER_FIGURE.facePoints[k]!;
  return { at: [x - 50, y - 50] as const, area: 100 };
};
const RECORD: LayerOrderRecord = { faces: [face(3), face(0)], constraints: [[0, 1, 1]], order: [] };
const FLAGGED: LayerOrderRecord = { ...RECORD, attention: { reason: 'conflict', count: 1 } };

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** Two linked steps folded flat, each carrying a record — the second's flagged — saved and opened again. */
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
  diagram = setLinkedLayerOrder(diagram, second, stepLayerOrderJson(FLAGGED));
  // As a file opens: written and read back, as the project's load does.
  const read = readDiagram(JSON.parse(JSON.stringify(writeDiagram(diagram))))!;
  act(() => state().installDiagram(read));
  return [first, second];
}

/** The open step's Pose, as its controller would publish it, so the pane shows its Pose section. */
function publishPose(
  stepId: string,
  render: DiagramCpRender,
  constrained: boolean,
  editLayerOrder: () => Promise<boolean> = async () => false
) {
  const t = ((_key: string, fallback: string) => fallback) as never;
  const actions = buildDiagramLinkedPoseActions(
    { render, readOnly: false, busy: false, solutions: null, constrained },
    { t, pose: vi.fn() }
  );
  const pose: DiagramLinkedPose = {
    actions,
    toolbar: actions,
    layerOrder: constrained ? null : { count: '1' },
    layerOrderEdit: null,
    editLayerOrder,
    spatial: null, connected: null, connectedPreparing: false, connectedSpread: null, setPresentation: async () => {}, onReveal: () => {},
    onCamera: () => {},
    registerLiveView: () => () => {},
    rotateTo: () => {},
    turn: render.mode === 'crease-pattern' || render.mode === 'folded-flat' ? render.rotationDeg : null,
    showAs: async () => true,
    setSide: async () => true,
    setFlipCreases: async () => true,
    simulate: async () => {},
    wantsRest: () => false,
    spread: null,
    preview: null,
  };
  act(() => publishOpenLinkedPose(stepId, pose));
}

const button = (name: string) => host!.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
const textButton = (label: string) => [...host!.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
const layerOrderRow = () =>
  [...host!.querySelectorAll<HTMLElement>('[data-field-row]')].find((row) =>
    row.querySelector('[data-field-label]')?.textContent?.startsWith('Layer order')
  );

beforeEach(() => {
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
        <DiagramStepPanel />
      </TooltipProvider>
    )
  );
});

afterEach(() => {
  act(() => publishOpenLinkedPose(null, null));
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

describe('a constrained step in the Step pane', () => {
  it('spawns no worker as the diagram opens and its steps are selected and shown; a Refresh spawns one', async () => {
    const [first, second] = await openConstrainedDiagram();
    for (const stepId of [first, second, first]) {
      act(() => state().selectDiagramStep(stepId));
      act(() => state().openDiagramStep(stepId));
      publishPose(stepId, FLAT, true);
      expect(layerOrderRow()).toBeDefined();
    }
    // The flagged step's flag, from its saved record.
    act(() => state().selectDiagramStep(second));
    expect(host!.textContent).toContain('1 layer constraint needs attention since the pattern changed.');
    expect(spawned).toHaveLength(0);

    // A Refresh is a user's action: it restores the record through the host engine, on one worker it ends.
    let refreshed = false;
    await act(async () => {
      refreshed = await refreshDiagramStep(first);
    });
    expect(refreshed).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(new URL(spawned[0]!.url).pathname).toMatch(/\/src\/workers\/layerOrderWorker\.ts$/);
    expect(spawned[0]!.worker.terminated).toBe(true);
    expect(spawned[0]!.worker.backend.calls).toEqual(['restore', 'relations', 'save']);
    // The engine's save of the order it shows, on the step's source.
    const source = stepById(state().diagram!, first)!.source as DiagramCpSource;
    expect(stepLayerOrderOf(source.layerOrder)?.record.constraints).toHaveLength(1);
    expect(bindings.runtime!.foldWithOrder).toHaveBeenCalledOnce();
  });

  it('shows Edit… after the held pager, the constraints on its note line, and the flag’s Review…', async () => {
    const [first, second] = await openConstrainedDiagram();
    act(() => state().selectDiagramStep(first));
    act(() => state().openDiagramStep(first));
    publishPose(first, FLAT, true);
    const row = layerOrderRow()!;
    expect(row.querySelector('[data-field-note]')?.textContent).toBe('1 constraint');
    expect(row.querySelector('[data-field-note]')?.getAttribute('data-field-note')).toBe('status');
    const edit = button('Edit Layer Order…')!;
    expect(edit.textContent).toBe('Edit…');
    expect(edit.hasAttribute('aria-disabled')).toBe(false);
    // ‹ › offered at rest, from saved data (H9: they step through the solutions that fit), and Edit… last,
    // so the pager never moves.
    for (const name of ['Previous Layer Order', 'Next Layer Order']) {
      expect(button(name)?.hasAttribute('aria-disabled')).toBe(false);
    }
    // The host never counts at rest (D11): no count read out between them, but its width kept, so the
    // chevrons stand where a count puts them once a press has asked.
    const readable = row.cloneNode(true) as HTMLElement;
    for (const hidden of readable.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
    expect(readable.textContent).not.toMatch(/\d of \d/);
    expect(row.querySelector('[data-reserved]')?.getAttribute('aria-hidden')).toBe('true');
    const controls = [...row.querySelectorAll('button')].map((control) => control.getAttribute('aria-label'));
    expect(controls).toEqual(['Previous Layer Order', 'Next Layer Order', 'Edit Layer Order…']);
    // No flag on a record that needs nothing.
    expect(textButton('Review…')).toBeUndefined();

    act(() => state().selectDiagramStep(second));
    act(() => state().openDiagramStep(second));
    publishPose(second, FLAT, true);
    const notice = [...host!.querySelectorAll('[role="status"]')].find((element) =>
      element.textContent?.includes('need')
    )!;
    expect(notice.textContent).toContain('1 layer constraint needs attention since the pattern changed.');
    expect(notice.querySelector('button')?.textContent).toBe('Review…');
    expect(layerOrderRow()!.querySelector('[data-field-note]')?.textContent).toBe('1 constraint');
    expect(spawned).toHaveLength(0);
  });

  // One session per step, whichever surface asks (H8): the pane's Edit… is the open Pose's own Edit order….
  it('opens the dialog through Pose’s controller on the step open in Pose: Edit… and the flag’s Review…', async () => {
    const [first, second] = await openConstrainedDiagram();
    act(() => state().selectDiagramStep(first));
    act(() => state().openDiagramStep(first));
    const editLayerOrder = vi.fn(async (_via?: 'edit' | 'review', _surface?: 'pose' | 'diagram_step') => false);
    publishPose(first, FLAT, true, editLayerOrder);
    vi.mocked(bindings.runtime!.fold).mockClear();
    act(() => button('Edit Layer Order…')!.click());
    // Through Pose, but asked from the Step pane all the same.
    expect(editLayerOrder).toHaveBeenLastCalledWith('edit', 'diagram_step');
    act(() => state().selectDiagramStep(second));
    act(() => state().openDiagramStep(second));
    publishPose(second, FLAT, true, editLayerOrder);
    act(() => textButton('Review…')!.click());
    expect(editLayerOrder).toHaveBeenLastCalledWith('review', 'diagram_step');
    expect(editLayerOrder).toHaveBeenCalledTimes(2);
    // Nothing of its own: no capture of the pane's, no worker.
    expect(state().diagramCaptures).toEqual({});
    expect(bindings.runtime!.fold).not.toHaveBeenCalled();
    expect(spawned).toHaveLength(0);
  });

  it('holds Edit… on a 3D step, its reason on the note line, with no pager', async () => {
    const [first] = await openConstrainedDiagram();
    const render: DiagramCpRender = { mode: 'folded-3d', side: 'front', camera: { yaw: 0, pitch: 0, zoom: 1 } };
    const diagram = state().diagram!;
    act(() =>
      useWorkspaceStore.setState({
        diagram: {
          ...diagram,
          steps: diagram.steps.map((entry) =>
            entry.id === first && 'source' in entry && entry.source?.kind === 'cp'
              ? { ...entry, source: { ...entry.source, render } }
              : entry
          ),
        },
      })
    );
    act(() => state().selectDiagramStep(first));
    act(() => state().openDiagramStep(first));
    publishPose(first, render, true);
    const row = layerOrderRow()!;
    expect(row.getAttribute('data-disabled')).not.toBeNull();
    const note = row.querySelector('[data-field-note]')!;
    expect(note.textContent).toBe('Layer order works on flat folds. This step folds in 3D.');
    expect(note.getAttribute('data-field-note')).toBe('reason');
    const edit = button('Edit Layer Order…')!;
    expect(edit.getAttribute('aria-disabled')).toBe('true');
    expect(edit.title).toBe('Layer order works on flat folds');
    expect(button('Previous Layer Order')).toBeNull();
  });

  it('offers the flag’s Review… on a flagged step shown as its crease pattern, with no row to reach', async () => {
    const [, second] = await openConstrainedDiagram();
    const render: DiagramCpRender = { mode: 'crease-pattern', rotationDeg: 0 };
    const diagram = state().diagram!;
    act(() =>
      useWorkspaceStore.setState({
        diagram: {
          ...diagram,
          steps: diagram.steps.map((entry) =>
            entry.id === second && 'source' in entry && entry.source?.kind === 'cp'
              ? { ...entry, source: { ...entry.source, render } }
              : entry
          ),
        },
      })
    );
    act(() => state().selectDiagramStep(second));
    act(() => state().openDiagramStep(second));
    publishPose(second, render, true);
    expect(layerOrderRow()).toBeUndefined();
    const notice = [...host!.querySelectorAll('[role="status"]')].find((element) => element.textContent?.includes('need'))!;
    const review = notice.querySelector('button')!;
    expect(review.textContent).toBe('Review…');
    expect(review.getAttribute('aria-disabled')).toBeNull();
    expect(spawned).toHaveLength(0);
  });

  it('has no row while the step is not open in Pose, and none for a step with no source of its own', async () => {
    const [first] = await openConstrainedDiagram();
    act(() => state().selectDiagramStep(first));
    expect(layerOrderRow()).toBeUndefined();
    expect(button('Edit Layer Order…')).toBeNull();
  });
});
