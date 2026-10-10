import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDiagram,
  insertSteps,
  stepById,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../../diagram/document/diagramDocument';
import { craneStep, imprintCase } from '../../diagram/zoom/zoom.fixtures';
import { watchFrames } from '../../diagram/zoom/zoomInvariant.fixtures';
import { paperFacesOf, toPicture } from '../../diagram/zoom/zoomImprint';
import { ZOOM_FRAME_ID } from '../../diagram/zoom/zoomModel';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { DiagramLayersPanel } from '../panels/DiagramLayersPanel';
import { TooltipProvider } from '../ui/Tooltip';

const tracked = vi.hoisted(() => ({ trackDiagramEnlargementChanged: vi.fn(), trackDiagramStepEnlarged: vi.fn() }));
/** What the pages lay each enlarged step out at, as the Diagram panel publishes it. */
const printed = vi.hoisted(() => ({ zoom: null as { asked: number | null; printed: number; reduced: boolean } | null }));
vi.mock('../../diagram/pages/printedFrames', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../diagram/pages/printedFrames')>()),
  usePrintedZoom: (stepId: string | null) => (stepId === null ? null : printed.zoom),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...tracked,
}));

/**
 * An enlargement's rows in the Layers pane, through the store (Revision 2,
 * 16e): an area's row and controls on its step, an enlarged step's frame as
 * its first row, each change one undo step.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const state = () => useWorkspaceStore.getState();
let frames: ReturnType<typeof watchFrames> | null = null;

beforeEach(() => {
  printed.zoom = null;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  // Every enlarged step's frame where its imprint lands, after every verb a control runs (Revision 2).
  frames = watchFrames(useWorkspaceStore.subscribe);
  Object.values(tracked).forEach((spy) => spy.mockClear());
  Object.values(toasts).forEach((spy) => spy.mockClear());
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <TooltipProvider>
        <DiagramLayersPanel />
      </TooltipProvider>
    )
  );
});

afterEach(() => {
  frames?.stop();
  expect(frames?.problems).toEqual([]);
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

function headArea(s: DiagramStep): KnownDiagramAnnotation {
  const { centre, radius } = toPicture(paperFacesOf(s)!, imprintCase('C.none').frame);
  return { id: 'area-head', kind: 'zoom', from: centre, to: centre, radius };
}

/** The crane's step 1 with the head's area, and step 2, open in Annotate on step 1, the area selected. */
function crane({ readOnly = false } = {}) {
  const s = craneStep('S.none');
  const document = insertSteps(
    createDiagram({ title: 'Crane' }),
    [{ ...s, annotations: [headArea(s)], annotatedPictureKey: s.picture!.key }, { ...craneStep('C.none'), id: 'step-2' }],
    0
  );
  act(() => {
    state().installDiagram({ document, readOnly, raw: readOnly ? {} : null } as never);
    state().openDiagramStep(s.id, 'annotate');
    state().selectDiagramAnnotation('area-head');
  });
  return s.id;
}

const area = (stepId: string) => stepById(state().diagram!, stepId)!.annotations[0] as KnownDiagramAnnotation;
const rows = () => [...(host?.querySelectorAll<HTMLButtonElement>('ul button') ?? [])];
const buttonNamed = (name: string) =>
  [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((candidate) => candidate.textContent?.trim() === name)!;
const labelled = (label: string) => host?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? null;
const zoomAction = (id: string) => host?.querySelector<HTMLButtonElement>(`[data-zoom-action="${id}"]`) ?? null;
const past = () => state().diagramHistory.past.length;

/** The area moved by hand on its step, as a drag in Annotate moves it. */
function moveArea(stepId: string) {
  act(() => {
    state().editDiagramAnnotations(stepId, 'Move annotation', (list) =>
      list.map((mark) => (mark.kind === 'zoom' ? { ...mark, from: [mark.from[0] + 0.03, mark.from[1]], to: [mark.from[0] + 0.03, mark.from[1]] } : mark))
    );
  });
}

describe('an enlarge area’s row and controls', () => {
  it('names the area and the steps enlarged from it, and offers its Shape, Size, Edge and Anchor', () => {
    crane();
    expect(rows()[0]!.textContent).toBe('Enlarge AreaNo step is enlarged from it');
    const text = host!.textContent!;
    for (const words of ['Shape', 'Size', 'Fill', 'Edge', 'Cut', 'Whole', 'Anchor']) {
      expect(text).toContain(words);
    }
    // The shapes are icons, each named.
    expect(labelled('Circle')!.getAttribute('aria-checked') ?? labelled('Circle')!.getAttribute('aria-pressed')).toBe('true');
    expect(labelled('Rounded rectangle')).not.toBeNull();
    expect(text).toContain('Auto');
    expect(host!.querySelector('[title="The backmost face outside the frame"]')!.textContent).toBe('Auto');
    // Update All, held, saying why.
    expect(zoomAction('update-all')!.textContent).toBe('Update All');
    expect(zoomAction('update-all')!.getAttribute('aria-disabled')).toBe('true');
    expect(zoomAction('update-all')!.title).toBe('No step is enlarged from this area');
  });

  it('reshapes, sizes and edges the area, each one undo step, counted', () => {
    const stepId = crane();
    const was = past();
    act(() => labelled('Rounded rectangle')!.click());
    expect(area(stepId).size).toBeDefined();
    act(() => buttonNamed('Fixed').click());
    expect(area(stepId).scale).toBe(1.25);
    act(() => buttonNamed('Whole').click());
    expect(area(stepId).edge).toBe('whole');
    act(() => buttonNamed('Fill').click());
    expect(area(stepId).scale).toBeUndefined();
    expect(past()).toBe(was + 4);
    expect(tracked.trackDiagramEnlargementChanged.mock.calls).toEqual([
      ['area', 'shape', 'rounded'],
      ['area', 'size', 'fixed', 1.25],
      ['area', 'edge', 'whole'],
      ['area', 'size', 'fill', undefined],
    ]);
  });

  it('arms the pick mode with Pick — pressed while it picks — and leaves it with Pick again', () => {
    const stepId = crane();
    act(() => zoomAction('pick-anchor')!.click());
    expect(state().diagramAnchorPick).toEqual({ stepId, target: 'area-head' });
    expect(zoomAction('pick-anchor')!.getAttribute('aria-pressed')).toBe('true');
    act(() => zoomAction('pick-anchor')!.click());
    expect(state().diagramAnchorPick).toBeNull();
    // An anchor picked: Reset, back to the default rule, as one undo step.
    act(() =>
      state().editDiagramAnnotations(stepId, 'Pick anchor', (list) => list.map((each) => ({ ...each, anchor: [0, 0] as [number, number] })))
    );
    expect(host!.textContent).toContain('Picked');
    const was = past();
    act(() => zoomAction('reset-anchor')!.click());
    expect(area(stepId).anchor).toBeUndefined();
    expect(past()).toBe(was + 1);
  });

  it('offers Update All once a step enlarged from it is out of date, and Go to that step (review fix 4)', async () => {
    const stepId = crane();
    await act(async () => {
      await state().enlargeDiagramStep('step-2');
    });
    expect(rows()[0]!.textContent).toBe('Enlarge AreaEnlarged on step 2');
    expect(zoomAction('update-all')!.getAttribute('aria-disabled')).toBe('true');
    expect(zoomAction('update-all')!.title).toBe('Every step enlarged from this area is up to date');
    moveArea(stepId);
    expect(zoomAction('update-all')!.getAttribute('aria-disabled')).toBeNull();
    const was = past();
    await act(async () => {
      zoomAction('update-all')!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(past()).toBe(was + 1);
    expect(zoomAction('update-all')!.getAttribute('aria-disabled')).toBe('true');
    expect(toasts.success).toHaveBeenCalledWith('Updated enlarged step 2');
    act(() => zoomAction('go-to-enlarged-step')!.click());
    expect(state().diagramSelectedStepId).toBe('step-2');
    expect(stepId).not.toBe('step-2');
  });

  it('holds Update All for a file’s steps from before records, as the area’s Step pane does, until the area is moved by hand (review of review fix 4)', async () => {
    const stepId = crane();
    await act(async () => {
      await state().enlargeDiagramStep('step-2');
    });
    act(() => {
      const document = state().diagram!;
      const entry = stepById(document, 'step-2')!;
      const { areaWas: _was, ...zoom } = entry.zoom!;
      state().installDiagram({
        document: { ...document, steps: document.steps.map((each) => (each.id === 'step-2' ? { ...entry, zoom } : each)) },
        readOnly: false,
        raw: null,
      } as never);
      state().openDiagramStep(stepId, 'annotate');
      state().selectDiagramAnnotation('area-head');
    });
    expect(zoomAction('update-all')!.getAttribute('aria-disabled')).toBe('true');
    moveArea(stepId);
    expect(zoomAction('update-all')!.getAttribute('aria-disabled')).toBeNull();
  });

  it('waits, visibly, while Update All folds the faces it needs, and takes no second press', async () => {
    const stepId = crane();
    await act(async () => {
      await state().enlargeDiagramStep('step-2');
    });
    moveArea(stepId);
    let finish: (placed: number) => void = () => {};
    const update = vi.fn(() => new Promise<number>((resolve) => (finish = resolve)));
    act(() => useWorkspaceStore.setState({ updateEnlargedDiagramSteps: update }));
    act(() => zoomAction('update-all')!.click());
    expect(zoomAction('update-all')!.getAttribute('aria-busy')).toBe('true');
    expect(zoomAction('update-all')!.title).toBe('Its picture is being captured');
    act(() => zoomAction('update-all')!.click());
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(['area-head']);
    await act(async () => {
      finish(1);
      await Promise.resolve();
    });
    expect(zoomAction('update-all')!.getAttribute('aria-busy')).toBeNull();
    expect(toasts.success).toHaveBeenCalledWith('Updated enlarged step 2');
  });

  it('says so when Update All places nothing, or stops on an error', async () => {
    const stepId = crane();
    await act(async () => {
      await state().enlargeDiagramStep('step-2');
    });
    // Update All is held while every step is up to date: the area moved by hand puts step 2 out of date.
    moveArea(stepId);
    act(() => useWorkspaceStore.setState({ updateEnlargedDiagramSteps: vi.fn(async () => 0) }));
    await act(async () => {
      zoomAction('update-all')!.click();
      await Promise.resolve();
    });
    expect(toasts.error).toHaveBeenLastCalledWith('The enlarged steps couldn’t be updated', undefined);
    act(() => useWorkspaceStore.setState({ updateEnlargedDiagramSteps: vi.fn(async () => Promise.reject(new Error('folded badly'))) }));
    await act(async () => {
      zoomAction('update-all')!.click();
      await Promise.resolve();
    });
    expect(toasts.error).toHaveBeenLastCalledWith('The enlarged steps couldn’t be updated', { description: 'folded badly' });
    expect(zoomAction('update-all')!.getAttribute('aria-busy')).toBeNull();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('holds every control on a diagram that cannot change', () => {
    crane({ readOnly: true });
    expect(zoomAction('pick-anchor')!.getAttribute('aria-disabled')).toBe('true');
    act(() => labelled('Rounded rectangle')!.click());
    expect(state().diagram!.steps.length).toBe(2);
    expect(area(state().diagramSelectedStepId!).size).toBeUndefined();
  });
});

describe('an enlarged step’s frame in Layers', () => {
  async function enlarged() {
    const areaStep = crane();
    await act(async () => {
      await state().enlargeDiagramStep('step-2');
    });
    act(() => state().openDiagramStep('step-2', 'annotate'));
    return areaStep;
  }

  it('is the first row, saying where it came from; pressed, it selects the frame and shows its controls', async () => {
    const areaStep = await enlarged();
    const [frame] = rows();
    expect(frame!.textContent).toBe('Enlarged frameFrom step 1’s area');
    act(() => frame!.click());
    expect(state().diagramSelectedAnnotationId).toBe(ZOOM_FRAME_ID);
    expect(host!.querySelector('[data-zoom-controls="frame"]')).not.toBeNull();
    // Update is offered only while the step is out of date, which the row's subtitle then says (review of review fix 4).
    expect(host!.textContent).toContain('Turning Enlarged off and on places this frame again.');
    // No Delete for a frame: the Enlarged switch, in Annotate's Step pane, turns it off.
    expect(buttonNamed('Delete')).toBeUndefined();
    act(() => zoomAction('go-to-area')!.click());
    expect(state().diagramSelectedStepId).toBe(areaStep);
    expect(state().diagramSelectedAnnotationId).toBe('area-head');
  });

  it('says its area changed, or was deleted, in the Step pane’s words (review of review fix 4)', async () => {
    const areaStep = await enlarged();
    moveArea(areaStep);
    expect(rows()[0]!.textContent).toBe('Enlarged frameOut of date: Step 1’s area changed');
    act(() => state().editDiagramAnnotations(areaStep, 'Delete annotation', (list) => list.filter((mark) => mark.kind !== 'zoom')));
    expect(rows()[0]!.textContent).toBe('Enlarged frameStep 1’s area was deleted');
  });

  it('reads out what the frame prints at once the pages are laid out, amber where its room holds it back (Z4)', async () => {
    await enlarged();
    act(() => rows()[0]!.click());
    const readout = () => host!.querySelector<HTMLElement>('[data-readout]')!;
    expect(readout().textContent).toBe('Prints as large as its room allows, up to ×6 the area.');
    printed.zoom = { asked: null, printed: 4.43, reduced: false };
    act(() => state().selectDiagramAnnotation(null));
    act(() => rows()[0]!.click());
    expect(readout().textContent).toBe('Prints ×4.4');
    expect(readout().dataset.tone).toBeUndefined();
    printed.zoom = { asked: 3, printed: 2.38, reduced: true };
    act(() => buttonNamed('Fixed').click());
    expect(readout().textContent).toBe('Asked ×3 · prints ×2.4 — the room is too small');
    expect(readout().dataset.tone).toBe('warning');
  });

  it('sizes its frame as one undo step, counted as the frame’s', async () => {
    await enlarged();
    act(() => rows()[0]!.click());
    const was = past();
    act(() => buttonNamed('Fixed').click());
    expect(stepById(state().diagram!, 'step-2')!.zoom!.scale).toBe(1.25);
    expect(past()).toBe(was + 1);
    expect(tracked.trackDiagramEnlargementChanged.mock.calls.at(-1)).toEqual(['frame', 'size', 'fixed', 1.25]);
  });

  it('badges a mark lying wholly outside its window, which sizes nothing, drawn just off it or not drawn far off', async () => {
    await enlarged();
    act(() =>
      state().editDiagramAnnotations('step-2', 'Add annotation', () => [
        { id: 'near', kind: 'valley-line', from: [0.2, 0.5], to: [0.8, 0.5] },
        // Reaching out of the window: in it, so not badged.
        { id: 'across', kind: 'valley-line', from: [0.5, 0.2], to: [0.5, 3] },
        // Off it, within a window of it: still drawn, but badged (Zach, 2026-10-07).
        { id: 'beside', kind: 'valley-line', from: [1.3, 0.5], to: [1.6, 0.5] },
        { id: 'far', kind: 'valley-line', from: [5, 0.5], to: [5.5, 0.5] },
      ])
    );
    const badged = rows().filter((row) => row.textContent?.includes('Outside the enlarged frame'));
    expect(badged).toHaveLength(2);
    expect(rows()).toHaveLength(5);
  });
});
