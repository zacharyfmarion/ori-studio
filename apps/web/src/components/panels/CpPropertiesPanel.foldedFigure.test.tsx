import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIGURE } from '../../cp-workspace/canvasObjects/canvasObjectKinds.fixtures';
import { foldedFigureGesture } from '../../cp-workspace/folded/foldedFigureGesture';
import type {
  OristudioCpDocumentState,
  OristudioCpFoldedFigureEntry,
} from '../../engine/oristudioCpTypes';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { foldedFigureLayerOrder } from '../../lib/layerOrder/foldedFigureLayerOrder';
import { twoConstraintRecord } from '../../lib/layerOrder/layerOrderRecord.fixtures';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { dropFoldedSolutionCursor } from '../../cp-workspace/folded/foldedSolutionCursor';
import { TooltipProvider } from '../ui/Tooltip';

const exporter = vi.hoisted(() => ({ open: vi.fn(async () => {}) }));
vi.mock('../../cp-workspace/folded/openFoldedFigureExport', () => ({
  openFoldedFigureExport: exporter.open,
}));

/** The CP kernel's answer for what a figure was folded from, read on a constrained figure's first press (H6). */
const cpRuntime = vi.hoisted(() => ({
  getOristudioCpFoldedFigureSource: vi.fn(async () => ({
    segments: [],
    starting_face_id: 1,
    aux_segments: [],
    digest: '00000000c0ffee01',
  })),
}));
vi.mock('../../store/workspaceStore/oristudioCpRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/workspaceStore/oristudioCpRuntime')>()),
  getOristudioCpFoldedFigureSource: cpRuntime.getOristudioCpFoldedFigureSource,
}));

const { CpPropertiesPanel } = await import('./CpPropertiesPanel');

/**
 * Edit's Properties pane for a selected folded figure, laid out as the
 * Diagram's Step pane (the approved Properties board, A4), read by role and
 * name: A, a flat figure; D, a 3D figure with no layer constraints; E, a flat
 * figure whose fold found no layer order. Each control is pressed through to
 * the store action it called before the pane took this layout, or, for the
 * toolbar's verbs in its header and the Layer order row, the one the toolbar
 * calls.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialState = useWorkspaceStore.getInitialState();

const DOCUMENT = {
  handle: 4,
  loadSerial: 1,
  document: createStarterOristudioCpDocument(),
  geometry: null,
  summary: null,
  source: { format: 'cp', filename: 'Untitled.cp', path: null },
} as unknown as OristudioCpDocumentState;

const MODEL = {
  state: 'Front0',
  front_color: { red: 255, green: 255, blue: 50 },
  back_color: { red: 233, green: 233, blue: 233 },
  line_color: { red: 0, green: 0, blue: 0 },
  display_shadows: false,
  anti_alias: true,
};

/** A: Kabuto on the second of three solutions found, with more to search for. */
const FLAT = {
  ...FIGURE,
  title: 'Kabuto',
  status: 'ready',
  handle: 3,
  snapshot: {
    model: MODEL,
    display_style: 'Paper5',
    find_another_overlap_valid: true,
    discovered_fold_cases: 3,
    current_fold_case: 2,
  },
  renderSnapshot: { primitives: [] },
} as unknown as OristudioCpFoldedFigureEntry;

/** D: folded in 3D, with no layer constraints, on the second solution found. */
const SPATIAL = {
  ...FLAT,
  id: 'figure-3d',
  snapshot: null,
  folded3d: {
    model: MODEL,
    verdict: { verdict: 'folded' },
    find_another_overlap_valid: true,
    discovered_fold_cases: 2,
    current_fold_case: 2,
  },
  camera: { yaw: 0, pitch: 0, zoom: 1 },
} as unknown as OristudioCpFoldedFigureEntry;

/** E: a flat figure whose fold found no layer order, drawn see-through. */
const UNORDERED = {
  ...FLAT,
  id: 'figure-unordered',
  displayStyle: 'Transparent3',
  snapshot: {
    model: MODEL,
    display_style: 'Transparent3',
    find_another_overlap_valid: false,
    discovered_fold_cases: 0,
    current_fold_case: 0,
    outcome: 'Contradiction',
  },
} as unknown as OristudioCpFoldedFigureEntry;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** The store actions the pane's controls reach, replaced so a press can be read back. */
function stubbedActions() {
  const actions = {
    setOristudioCpFoldedFigureDisplayStyle: vi.fn(async () => true),
    updateOristudioCpFoldedFigureModel: vi.fn(async () => true),
    setOristudioCpFoldedFigurePlacement: vi.fn(),
    foldAnotherOristudioCpFigure: vi.fn(async () => true),
    foldOristudioCpFigureToCase: vi.fn(async () => true),
    duplicateOristudioCpFoldedFigure: vi.fn(async () => true),
    deleteOristudioCpFoldedFigure: vi.fn(async () => {}),
  };
  useWorkspaceStore.setState(actions as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
  return actions;
}

function mount(figure: OristudioCpFoldedFigureEntry) {
  useWorkspaceStore.setState({
    oristudioCpDocument: DOCUMENT,
    oristudioCpFoldedFigures: [figure],
    oristudioCpActiveFoldedFigureId: figure.id,
  });
  act(() =>
    root?.render(
      <TooltipProvider>
        <CpPropertiesPanel />
      </TooltipProvider>
    )
  );
}

const sheet = () => host!.querySelector<HTMLElement>('[data-property-sheet]')!;
/** A group by its accessible name: its own label, or the visible one that names it. */
const group = (name: string) =>
  [...sheet().querySelectorAll<HTMLElement>('[role="group"]')].find(
    (candidate) =>
      candidate.getAttribute('aria-label') === name ||
      document.getElementById(candidate.getAttribute('aria-labelledby') ?? '')?.textContent === name
  ) ?? null;
const button = (scope: Element | null, name: string) =>
  [...(scope?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (candidate) => (candidate.getAttribute('aria-label') ?? candidate.textContent) === name
  ) ?? null;
const rowOf = (label: string) =>
  [...sheet().querySelectorAll('[data-field-label]')]
    .find((candidate) => candidate.textContent === label)
    ?.closest<HTMLElement>('[data-field-row]') ?? null;
const sectionLabels = (name: string) =>
  [...(group(name)?.querySelectorAll('[data-field-label]') ?? [])].map((label) => label.textContent);

async function press(target: HTMLButtonElement | null) {
  expect(target).not.toBeNull();
  await act(async () => target!.click());
}

beforeEach(() => {
  useWorkspaceStore.setState(initialState, true);
  foldedFigureGesture.abortAll();
  exporter.open.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  foldedFigureGesture.abortAll();
  useWorkspaceStore.setState(initialState, true);
});

describe('A, a flat figure', () => {
  it('is laid out as the Step pane: the verbs in the header, Render as, Pose, Appearance, Placement', () => {
    mount(FLAT);
    const header = sheet().querySelector('header')!;
    expect(header.querySelector('h2')?.textContent).toBe('Kabuto');
    // Which solution it shows is the Layer order row's (D11), so no subtitle.
    expect(sheet().querySelector('[data-property-sheet-subtitle]')).toBeNull();
    expect([...header.querySelectorAll('button')].map((verb) => verb.getAttribute('aria-label'))).toEqual([
      'Export…',
      'Duplicate',
      'Delete',
    ]);

    const renderAs = group('Render as');
    expect([...(renderAs?.querySelectorAll('button') ?? [])].map((option) => option.textContent)).toEqual([
      'Paper',
      'Wireframe',
      'X-ray',
    ]);
    expect(button(renderAs, 'Paper')?.getAttribute('aria-pressed')).toBe('true');

    expect(sectionLabels('Pose')).toEqual(['Rotation', 'Side', 'Layer order']);
    expect(sectionLabels('Appearance')).toEqual(
      expect.arrayContaining(['Front color', 'Back color', 'Line color', 'Shadow', 'Auxiliary creases'])
    );
    expect(sectionLabels('Placement')).toEqual(['Scale']);
    expect(group('Camera')).toBeNull();

    const layerOrder = rowOf('Layer order')!;
    expect(layerOrder.textContent).toContain('2 of 3+');
    // The pager is a group named by its row's label, said once, and its readout is announced.
    const pager = group('Layer order');
    expect(pager?.hasAttribute('aria-label')).toBe(false);
    expect(layerOrder.contains(pager)).toBe(true);
    expect(pager?.querySelector('[aria-live="polite"]')?.textContent).toBe('2 of 3+');
    expect(button(layerOrder, 'Previous solution')?.getAttribute('aria-disabled')).toBeNull();
    expect(button(layerOrder, 'Another solution')?.getAttribute('aria-disabled')).toBeNull();
  });

  it('runs each moved control through the store action it called before', async () => {
    mount(FLAT);
    const store = stubbedActions();

    await press(button(group('Render as'), 'Wireframe'));
    expect(store.setOristudioCpFoldedFigureDisplayStyle).toHaveBeenCalledWith(FLAT.id, 'Wire2');

    await press(button(group('Side'), 'Back'));
    expect(store.updateOristudioCpFoldedFigureModel).toHaveBeenCalledWith(FLAT.id, { state: 'Back1' });

    await press(button(rowOf('Rotation'), 'Increase Rotation'));
    expect(store.setOristudioCpFoldedFigurePlacement).toHaveBeenCalledWith(FLAT.id, {
      rotation: expect.closeTo(Math.PI / 180, 6),
    });
  });

  it('runs the header verbs and the layer order’s › as the toolbar runs them, and ‹ back one fold case', async () => {
    mount(FLAT);
    const store = stubbedActions();
    const header = sheet().querySelector('header');

    await press(button(header, 'Duplicate'));
    expect(store.duplicateOristudioCpFoldedFigure).toHaveBeenCalledWith(FLAT.id);
    await press(button(header, 'Export…'));
    expect(exporter.open).toHaveBeenCalledWith(FLAT.id, expect.any(Function));

    await press(button(rowOf('Layer order'), 'Another solution'));
    expect(store.foldAnotherOristudioCpFigure).toHaveBeenCalledWith(FLAT.id);
    await press(button(rowOf('Layer order'), 'Previous solution'));
    expect(store.foldOristudioCpFigureToCase).toHaveBeenCalledWith(FLAT.id, 1);

    await press(button(header, 'Delete'));
    expect(store.deleteOristudioCpFoldedFigure).toHaveBeenCalledWith(FLAT.id);
  });

  it('waits while a step folds, keeping its place and the pressed button', async () => {
    mount({ ...FLAT, status: 'loading' } as OristudioCpFoldedFigureEntry);
    const store = stubbedActions();
    const layerOrder = rowOf('Layer order')!;
    // Not held as a figure that cannot be used: the step it started is running.
    expect(layerOrder.hasAttribute('data-disabled')).toBe(false);
    expect(layerOrder.textContent).toContain('2 of 3+');
    for (const name of ['Previous solution', 'Another solution']) {
      const verb = button(layerOrder, name);
      expect(verb?.getAttribute('aria-disabled'), name).toBe('true');
      expect(verb?.disabled, name).toBe(false);
      await press(verb);
    }
    expect(store.foldAnotherOristudioCpFigure).not.toHaveBeenCalled();
    expect(store.foldOristudioCpFigureToCase).not.toHaveBeenCalled();
  });

  it('goes no further back than the first solution', async () => {
    mount({ ...FLAT, snapshot: { ...FLAT.snapshot!, current_fold_case: 1 } });
    const store = stubbedActions();
    const previous = button(rowOf('Layer order'), 'Previous solution');
    expect(previous?.getAttribute('aria-disabled')).toBe('true');
    await press(previous);
    expect(store.foldOristudioCpFigureToCase).not.toHaveBeenCalled();
  });
});

describe('D, a 3D figure', () => {
  it('holds Side with its reason, steps on as its toolbar does, and adds the Camera', async () => {
    mount(SPATIAL);
    const store = stubbedActions();

    // Its pose is its camera; its turn on the page stays with Placement.
    expect(sectionLabels('Pose')).toEqual(['Side', 'Layer order']);
    expect(sectionLabels('Camera')).toEqual(['Turn', 'Tilt', 'Zoom']);
    expect(sectionLabels('Placement')).toEqual(['Scale', 'Rotation']);
    expect(rowOf('Side')?.getAttribute('title')).toBe('Turn a 3D model with Other side');
    expect(button(group('Side'), 'Back')?.disabled).toBe(true);

    const layerOrder = rowOf('Layer order')!;
    expect(layerOrder.textContent).toContain('2 of 2+');
    // No numbered solutions to go back to in 3D.
    const previous = button(layerOrder, 'Previous solution');
    expect(previous?.getAttribute('aria-disabled')).toBe('true');
    await press(previous);
    expect(store.foldOristudioCpFigureToCase).not.toHaveBeenCalled();
    await press(button(layerOrder, 'Another solution'));
    expect(store.foldAnotherOristudioCpFigure).toHaveBeenCalledWith(SPATIAL.id);
  });
});

describe('E, a figure with no layer order', () => {
  it('keeps the row in its place, says why under its label, and steps nowhere', async () => {
    mount(UNORDERED);
    const store = stubbedActions();
    expect(button(group('Render as'), 'X-ray')?.getAttribute('aria-pressed')).toBe('true');

    const layerOrder = rowOf('Layer order')!;
    expect(layerOrder.getAttribute('data-disabled')).toBe('true');
    expect(layerOrder.querySelector('[data-field-note="reason"]')?.textContent).toBe(
      'Layer order couldn’t be determined for this figure.'
    );
    expect(layerOrder.textContent).toContain('None');
    for (const name of ['Previous solution', 'Another solution']) {
      const verb = button(layerOrder, name);
      expect(verb?.getAttribute('aria-disabled'), name).toBe('true');
      await press(verb);
    }
    expect(store.foldAnotherOristudioCpFigure).not.toHaveBeenCalled();
    expect(store.foldOristudioCpFigureToCase).not.toHaveBeenCalled();
  });
});

/**
 * The Fold engine never loads at rest (approach 5, row H6): selecting a
 * constrained figure and drawing its pane — its Layer order row's ‹ › live,
 * from saved data — starts no worker; the first press of › does, the host
 * engine's, through the cursor it makes. (That worker never comes here, so
 * the press writes nothing and says the engine stopped.)
 */
describe('a constrained figure (H6)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    dropFoldedSolutionCursor();
  });

  it('starts no worker when it is selected and its pane drawn; the first press of › does', async () => {
    const spawned: string[] = [];
    class WorkerSpy {
      constructor(url: URL | string) {
        spawned.push(String(url));
        throw new Error('no worker in this test');
      }
    }
    vi.stubGlobal('Worker', WorkerSpy);
    const record = foldedFigureLayerOrder(twoConstraintRecord());
    if (!record.ok) throw new Error('the fixture record encodes');
    const constrained = {
      ...FLAT,
      snapshot: { ...FLAT.snapshot!, outcome: 'Solved', shown_order: 'given' },
      sourceBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      layerOrder: record.layerOrder,
    } as unknown as OristudioCpFoldedFigureEntry;

    mount(constrained);
    const layerOrder = rowOf('Layer order')!;
    expect(layerOrder.querySelector('[data-field-note="status"]')?.textContent).toBe('2 constraints');
    const next = button(layerOrder, 'Another solution');
    expect(next?.getAttribute('aria-disabled')).toBeNull();
    expect(button(layerOrder, 'Previous solution')?.getAttribute('aria-disabled')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(spawned).toEqual([]);
    expect(cpRuntime.getOristudioCpFoldedFigureSource).not.toHaveBeenCalled();

    await press(next);
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    expect(spawned[0]).toMatch(/layerOrderWorker/);
    expect(cpRuntime.getOristudioCpFoldedFigureSource).toHaveBeenCalledWith(constrained.handle);
    await vi.waitFor(() => expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.status).toBe('ready'));
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]).toMatchObject({
      handle: constrained.handle,
      layerOrder: record.layerOrder,
    });
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toEqual([]);
  });
});
