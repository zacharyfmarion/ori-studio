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

beforeEach(() => {
  printed.zoom = null;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  Object.values(tracked).forEach((spy) => spy.mockClear());
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
    // Update, held, saying why.
    expect(zoomAction('update-enlarged-steps')!.getAttribute('aria-disabled')).toBe('true');
    expect(zoomAction('update-enlarged-steps')!.title).toBe('No step is enlarged from this area');
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

  it('offers Update once a step is enlarged from it, and Go to that step', async () => {
    const stepId = crane();
    await act(async () => {
      await state().enlargeDiagramStep('step-2');
    });
    expect(rows()[0]!.textContent).toBe('Enlarge AreaEnlarged on step 2');
    expect(zoomAction('update-enlarged-steps')!.getAttribute('aria-disabled')).toBeNull();
    const was = past();
    await act(async () => {
      zoomAction('update-enlarged-steps')!.click();
      await Promise.resolve();
    });
    expect(past()).toBe(was + 1);
    act(() => zoomAction('go-to-enlarged-step')!.click());
    expect(state().diagramSelectedStepId).toBe('step-2');
    expect(stepId).not.toBe('step-2');
  });

  it('waits, visibly, while Update folds the faces it needs, and takes no second press', async () => {
    crane();
    await act(async () => {
      await state().enlargeDiagramStep('step-2');
    });
    let finish: (placed: number) => void = () => {};
    const update = vi.fn(() => new Promise<number>((resolve) => (finish = resolve)));
    act(() => useWorkspaceStore.setState({ updateEnlargedDiagramSteps: update }));
    act(() => zoomAction('update-enlarged-steps')!.click());
    expect(zoomAction('update-enlarged-steps')!.getAttribute('aria-busy')).toBe('true');
    expect(zoomAction('update-enlarged-steps')!.title).toBe('Its picture is being captured');
    act(() => zoomAction('update-enlarged-steps')!.click());
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(1);
      await Promise.resolve();
    });
    expect(zoomAction('update-enlarged-steps')!.getAttribute('aria-busy')).toBeNull();
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
    expect(host!.textContent).toContain('Update Enlarged Steps on its area, or turning Enlarged off and on, places this frame again.');
    // No Delete for a frame: Pose's Enlarged turns it off.
    expect(buttonNamed('Delete')).toBeUndefined();
    act(() => zoomAction('go-to-area')!.click());
    expect(state().diagramSelectedStepId).toBe(areaStep);
    expect(state().diagramSelectedAnnotationId).toBe('area-head');
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

  it('badges a mark it keeps but no longer draws, far outside its window', async () => {
    await enlarged();
    act(() =>
      state().editDiagramAnnotations('step-2', 'Add annotation', () => [
        { id: 'near', kind: 'valley-line', from: [0.2, 0.5], to: [0.8, 0.5] },
        { id: 'far', kind: 'valley-line', from: [5, 0.5], to: [5.5, 0.5] },
      ])
    );
    const badged = rows().filter((row) => row.textContent?.includes('Outside the enlarged frame'));
    expect(badged).toHaveLength(1);
    expect(rows()).toHaveLength(3);
  });
});
