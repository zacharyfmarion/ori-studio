import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagramLinkedPoseAction } from '../../diagram/actions/diagramLinkedPoseActions';
import type { DiagramLinkedPose } from '../../diagram/capture/useDiagramLinkedPose';
import {
  createDiagram,
  insertSteps,
  stepById,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../../diagram/document/diagramDocument';
import { craneStep, imprintCase } from '../../diagram/zoom/zoom.fixtures';
import { watchFrames } from '../../diagram/zoom/zoomInvariant.fixtures';
import { pickedAnchor } from '../../diagram/zoom/zoomAnchor';
import { setFrameAnchor } from '../../diagram/zoom/zoomFrames';
import { paperFacesOf, toPicture } from '../../diagram/zoom/zoomImprint';
import { ZOOM_FRAME_ID } from '../../diagram/zoom/zoomModel';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { DiagramStepPanel } from '../panels/DiagramStepPanel';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramStepDetail } from './DiagramStepDetail';
import { DiagramStepZoomStatus } from './DiagramStepZoomStatus';
import { useDiagramStepActions } from '../../diagram/useDiagramActions';
import { PHONE_MEDIA_QUERY } from '../../platform/phoneLayout';

const tracked = vi.hoisted(() => ({ trackDiagramEnlargementChanged: vi.fn() }));
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
 * Enlarged through the store (Revision 2, 16e; Zach's review of #436,
 * 2026-10-08): the switch and the frame's Size and Anchor in Annotate's Step
 * pane, none of it in Pose, and the Step pane's read-only word on an
 * enlarged step out of the step detail.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const state = () => useWorkspaceStore.getState();
let frames: ReturnType<typeof watchFrames> | null = null;

/** A phone's layout, or not, as the media query answers. */
function phoneLayout(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: phone && query === PHONE_MEDIA_QUERY,
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeEach(() => {
  printed.zoom = null;
  tracked.trackDiagramEnlargementChanged.mockClear();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  // Every enlarged step's frame where its imprint lands, after every verb a control runs (Revision 2).
  frames = watchFrames(useWorkspaceStore.subscribe);
  phoneLayout(false);
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
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

/** The crane's step 1 with the head's area, and step 2 after it; `faces` false for captures older than their faces. */
function install({ area = true, faces = true } = {}) {
  const s = craneStep('S.none', { faces });
  const document = insertSteps(
    createDiagram({ title: 'Crane' }),
    [
      { ...s, annotations: area ? [headArea(craneStep('S.none'))] : [], annotatedPictureKey: s.picture!.key },
      { ...craneStep('C.none', { faces }), id: 'step-2' },
    ],
    0
  );
  act(() => {
    state().installDiagram({ document, readOnly: false, raw: null } as never);
    state().selectDiagramStep('step-2');
  });
  return s.id;
}

const step = (id = 'step-2') => stepById(state().diagram!, id)!;
const past = () => state().diagramHistory.past.length;

async function enlarge() {
  await act(async () => {
    await state().enlargeDiagramStep('step-2');
  });
}

const reset: DiagramLinkedPoseAction = { id: 'reset', label: 'Reset Pose', disabled: false, waiting: false, run: () => {} };

function linkedPose(): DiagramLinkedPose {
  return {
    actions: [reset],
    layerOrder: null,
    spatial: null,
    onCamera: () => {},
    registerLiveView: () => () => {},
    rotateTo: () => {},
    showAs: async () => true,
    setSide: async () => true,
    simulate: async () => {},
    wantsRest: () => false,
    spread: null,
    preview: null,
  };
}

function detail(linked: boolean) {
  act(() =>
    root!.render(
      <TooltipProvider>
        <DiagramStepDetail
          step={step()}
          assets={state().diagram!.assets}
          style={state().diagram!.style}
          number={2}
          count={2}
          readOnly={false}
          mode="pose"
          onMode={() => {}}
          onAnnotateTool={() => {}}
          poseActions={[]}
          linkedPose={linked ? linkedPose() : null}
          onBack={() => {}}
          onStep={() => {}}
          onUpload={() => {}}
          patternOpen
          onLink={() => {}}
          onFromReferences={() => {}}
          onGoToEdit={() => {}}
          dropping={false}
          drawerSlot={createRef()}
        />
      </TooltipProvider>
    )
  );
}

/** The Step pane, through the store, as the Diagram docks it (or the touch drawer shows it). */
function panel() {
  act(() =>
    root!.render(
      <TooltipProvider>
        <DiagramStepPanel />
      </TooltipProvider>
    )
  );
}

const enlargedSwitch = () => host!.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Enlarged"]');
/** The Step pane's Enlarged section, by its group's name. */
const enlargedSection = () => host!.querySelector<HTMLElement>('[role="group"][aria-label="Enlarged"]');
const buttonNamed = (name: string) =>
  [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((candidate) => candidate.textContent?.trim() === name);
const zoomAction = (id: string) => host?.querySelector<HTMLButtonElement>(`[data-zoom-action="${id}"]`) ?? null;
/** One of the Step pane's verbs in a list, by its id: Update, Update All. */
const listAction = (id: string) => host?.querySelector<HTMLButtonElement>(`[data-action="${id}"]`) ?? null;

/** The head's area moved by hand on its step, as a drag in Annotate moves it: one undo step. */
function moveArea(areaStep: string) {
  act(() => {
    state().editDiagramAnnotations(areaStep, 'Move annotation', (list) =>
      list.map((mark) => (mark.kind === 'zoom' ? { ...mark, from: [mark.from[0] + 0.03, mark.from[1]], to: [mark.from[0] + 0.03, mark.from[1]] } : mark))
    );
  });
}

/** A click on a verb whose store action folds faces first, and its edit landed. */
async function clickAndSettle(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('Enlarged is not Pose’s (review of #436)', () => {
  it('is not on Pose’s toolbar, on a linked step or any other', () => {
    install();
    detail(true);
    expect(host!.querySelector('[role="toolbar"]')!.querySelector('button[aria-label="Reset Pose"]')).not.toBeNull();
    expect(host!.querySelector('button[aria-label="Enlarged"]')).toBeNull();
    expect(zoomAction('enlarged')).toBeNull();
    detail(false);
    expect(host!.querySelector('button[aria-label="Enlarged"]')).toBeNull();
  });

  it('is not in the Step pane in Pose, on a phone or not: Pose only draws the frame', async () => {
    install();
    await enlarge();
    for (const phone of [false, true]) {
      phoneLayout(phone);
      act(() => state().openDiagramStep('step-2', 'pose'));
      panel();
      expect(enlargedSwitch()).toBeNull();
      expect(enlargedSection()).toBeNull();
    }
  });
});

describe('Enlarged in Annotate’s Step pane (review of #436)', () => {
  function annotate(id = 'step-2') {
    act(() => state().openDiagramStep(id, 'annotate'));
    panel();
  }
  /** The switch's box on the section's heading, which carries what it does, or why it cannot, as its tooltip. */
  const switchRow = () => enlargedSwitch()!.closest<HTMLElement>('[data-enlarged-switch]')!;

  it('turns the step enlarged from the area before it, and back, each one undo step', async () => {
    install();
    annotate();
    expect(enlargedSwitch()!.getAttribute('aria-checked')).toBe('false');
    expect(switchRow().title).toBe('Enlarge from step 1’s area');
    // The switch alone, on the section's heading, until the step is enlarged (review fix 4): no row of its own
    // under a heading of the same name.
    expect(host!.querySelector('[data-step-enlarged]')!.textContent).toBe('');
    expect(enlargedSection()!.contains(enlargedSwitch())).toBe(false);
    expect(enlargedSection()!.parentElement!.contains(enlargedSwitch())).toBe(true);
    expect(enlargedSection()!.parentElement!.textContent).toBe('Enlarged');
    expect([...host!.querySelectorAll('[data-field-label]')].map((label) => label.textContent)).not.toContain('Enlarged');
    const was = past();
    await act(async () => {
      enlargedSwitch()!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(step().zoom).toMatchObject({ from: 'area-head' });
    expect(past()).toBe(was + 1);
    expect(enlargedSwitch()!.getAttribute('aria-checked')).toBe('true');
    expect(switchRow().title).toBe('Show the whole picture again');
    act(() => enlargedSwitch()!.click());
    expect(step().zoom).toBeUndefined();
    expect(past()).toBe(was + 2);
  });

  it('is held, saying why, where no earlier step has an area', () => {
    install({ area: false });
    annotate();
    expect(enlargedSwitch()!.disabled).toBe(true);
    expect(switchRow().title).toBe('No earlier step has an area to enlarge: draw one with Enlarge');
    act(() => enlargedSwitch()!.click());
    expect(step().zoom).toBeUndefined();
  });

  it('leaves the read-only section on a step Annotate cannot open: one with no picture, made enlarged after an enlarged step', async () => {
    install();
    await enlarge();
    let made = '';
    act(() => {
      made = state().insertDiagramStep('step-2', 'after')!;
    });
    expect(step(made).picture).toBeNull();
    expect(step(made).zoom).toMatchObject({ from: 'area-head' });
    for (const mode of ['annotate', 'pose'] as const) {
      act(() => state().openDiagramStep(made, mode));
      panel();
      expect(state().diagramDetail).not.toBeNull();
      expect(host!.querySelector('[data-step-enlarged]')).toBeNull();
      expect(host!.querySelector('[data-step-zoom-status]')!.textContent).toContain('FromStep 1’s area');
    }
  });

  it('stands in for the read-only section, which the pane keeps out of the step detail', async () => {
    install();
    await enlarge();
    panel();
    expect(state().diagramDetail).toBeNull();
    expect(host!.querySelector('[data-step-zoom-status]')).not.toBeNull();
    expect(enlargedSwitch()).toBeNull();
    annotate();
    expect(host!.querySelector('[data-step-enlarged]')).not.toBeNull();
    expect(host!.querySelector('[data-step-zoom-status]')).toBeNull();
    expect(host!.querySelectorAll('[role="group"][aria-label="Enlarged"]')).toHaveLength(1);
  });

  it('goes from From to the area, selected on its step, as the Layers frame’s Go to does', async () => {
    const areaStep = install();
    await enlarge();
    annotate();
    const from = [...host!.querySelectorAll<HTMLButtonElement>('[data-step-enlarged] button')].find((each) =>
      each.textContent?.includes('Step 1’s area')
    )!;
    expect(from.textContent).toBe('FromStep 1’s area');
    act(() => from.click());
    expect(state().diagramSelectedStepId).toBe(areaStep);
    expect(state().diagramSelectedAnnotationId).toBe('area-head');
  });

  it('sizes the frame, Fill or fixed, each one undo step counted as the frame’s, as Layers does', async () => {
    install();
    await enlarge();
    annotate();
    const was = past();
    act(() => buttonNamed('Fixed')!.click());
    expect(step().zoom!.scale).toBe(1.25);
    expect(past()).toBe(was + 1);
    expect(tracked.trackDiagramEnlargementChanged.mock.calls.at(-1)).toEqual(['frame', 'size', 'fixed', 1.25]);
    expect(host!.textContent).toContain('Times the area');
    expect(host!.querySelector('[data-step-enlarged] [data-readout]')!.textContent).toBe('Prints at 1.25 × the area’s printed size.');
    act(() => buttonNamed('Fill')!.click());
    expect(step().zoom!.scale).toBeUndefined();
    expect(past()).toBe(was + 2);
    expect(tracked.trackDiagramEnlargementChanged.mock.calls.at(-1)).toEqual(['frame', 'size', 'fill', undefined]);
  });

  it('picks the frame’s anchor on the canvas, and resets it to the rule as one undo step', async () => {
    install();
    await enlarge();
    annotate();
    expect(host!.querySelector('[data-step-enlarged] [title="The backmost face outside the frame"]')!.textContent).toBe('Auto');
    expect(state().diagramSelectedAnnotationId).toBeNull();
    act(() => zoomAction('pick-anchor')!.click());
    expect(state().diagramAnchorPick).toEqual({ stepId: 'step-2', target: ZOOM_FRAME_ID });
    // The canvas picks round the frame selected, as Layers' frame row has it: Pick here selects it.
    expect(state().diagramSelectedAnnotationId).toBe(ZOOM_FRAME_ID);
    expect(zoomAction('pick-anchor')!.getAttribute('aria-pressed')).toBe('true');
    // Pick again leaves the mode, and the frame selected.
    act(() => zoomAction('pick-anchor')!.click());
    expect(state().diagramAnchorPick).toBeNull();
    expect(state().diagramSelectedAnnotationId).toBe(ZOOM_FRAME_ID);
    // A face picked, as a click on the canvas in the pick mode picks it.
    const picked = pickedAnchor(step(), step().zoom!.frame!.centre)!;
    act(() => {
      state().editDiagramStepZoom('step-2', 'Pick anchor', (document) => setFrameAnchor(document, 'step-2', picked));
      state().setDiagramAnchorPick(null);
    });
    expect(step().zoom!.imprint!.picked).toBe(true);
    expect(host!.querySelector('[data-step-enlarged]')!.textContent).toContain('Picked');
    const was = past();
    act(() => zoomAction('reset-anchor')!.click());
    expect(step().zoom!.imprint!.picked).toBeUndefined();
    expect(past()).toBe(was + 1);
    expect(tracked.trackDiagramEnlargementChanged.mock.calls.at(-1)).toEqual(['frame', 'anchor', 'auto']);
  });

  it('offers no Pick on a phone, whose Annotate has no canvas to pick on, and still Reset', async () => {
    install();
    await enlarge();
    phoneLayout(true);
    annotate();
    expect(host!.querySelector('[data-step-enlarged] [title="The backmost face outside the frame"]')!.textContent).toBe('Auto');
    expect(zoomAction('pick-anchor')).toBeNull();
    const picked = pickedAnchor(step(), step().zoom!.frame!.centre)!;
    act(() => {
      state().editDiagramStepZoom('step-2', 'Pick anchor', (document) => setFrameAnchor(document, 'step-2', picked));
    });
    expect(zoomAction('pick-anchor')).toBeNull();
    expect(zoomAction('reset-anchor')).not.toBeNull();
  });

  it('reads out what it prints at, amber where its room holds it back, and says its notices', async () => {
    install({ faces: false });
    await enlarge();
    annotate();
    const readout = () => host!.querySelector<HTMLElement>('[data-step-enlarged] [data-readout]')!;
    expect(readout().textContent).toBe('Prints as large as its room allows, up to ×6 the area.');
    printed.zoom = { asked: null, printed: 4.43, reduced: false };
    panel();
    expect(readout().textContent).toBe('Prints ×4.4');
    expect(readout().dataset.tone).toBeUndefined();
    printed.zoom = { asked: null, printed: 1.08, reduced: false };
    panel();
    expect(readout().textContent).toBe('Prints only ×1.1 — draw a smaller area');
    expect(readout().dataset.tone).toBe('warning');
    expect(enlargedSection()!.textContent).toContain(
      'Refresh step 2, then Update from step 1’s area, to anchor the frame to its paper.'
    );
  });

  it('says when its area changed by hand, with Update, which brings it up to date as one undo step (review fix 4)', async () => {
    const areaStep = install();
    await enlarge();
    annotate();
    expect(listAction('update-enlarged')).toBeNull();
    moveArea(areaStep);
    annotate();
    expect(enlargedSection()!.textContent).toContain('Out of date: Step 1’s area changed');
    const update = listAction('update-enlarged')!;
    expect(update.textContent).toBe('Update');
    const was = past();
    await clickAndSettle(update);
    expect(past()).toBe(was + 1);
    expect(state().diagramHistory.past.at(-1)!.label).toBe('Update enlarged step');
    expect(enlargedSection()!.textContent).not.toContain('Out of date');
    expect(listAction('update-enlarged')).toBeNull();
  });

  it('says the area was deleted, naming its step, and offers no Update (review fix 4)', async () => {
    const areaStep = install();
    await enlarge();
    act(() => state().editDiagramAnnotations(areaStep, 'Delete annotation', (list) => list.filter((mark) => mark.kind !== 'zoom')));
    annotate();
    expect(enlargedSection()!.textContent).toContain('FromStep 1’s area was deleted');
    // Nowhere to go: the row is not a button.
    expect([...enlargedSection()!.querySelectorAll('button')].some((each) => each.textContent?.includes('area was deleted'))).toBe(false);
    expect(listAction('update-enlarged')).toBeNull();
    expect(step().zoom!.frame).toBeDefined();
  });

  it('on the area’s own step: held, saying a later step is enlarged from it, where it was, and Update All while one is out of date (review fix 4)', async () => {
    const areaStep = install();
    annotate(areaStep);
    expect(enlargedSwitch()!.disabled).toBe(true);
    expect(switchRow().title).toBe('This step holds the enlarge area: turn Enlarged on in a later step to enlarge it');
    expect(enlargedSection()!.textContent).toBe('No step is enlarged from it');
    await enlarge();
    annotate(areaStep);
    expect(enlargedSection()!.textContent).toBe('Enlarged on step 2');
    expect(listAction('update-all')).toBeNull();
    moveArea(areaStep);
    annotate(areaStep);
    // Which steps are out of date, in their own words, above Update All (review of review fix 4).
    expect(enlargedSection()!.textContent).toBe('Enlarged on step 2Out of date: step 2Update All');
    const updateAll = listAction('update-all')!;
    expect(updateAll.textContent).toBe('Update All');
    expect(updateAll.title).toBe('Place the frame again on each step enlarged from this area that is out of date, from the area as it is now');
    const was = past();
    await clickAndSettle(updateAll);
    expect(past()).toBe(was + 1);
    expect(state().diagramHistory.past.at(-1)!.label).toBe('Update enlarged steps');
    expect(listAction('update-all')).toBeNull();
    // Undone, out of date again, and offered again.
    act(() => state().undoDiagram());
    annotate(areaStep);
    expect(listAction('update-all')).not.toBeNull();
  });

  it('a file’s steps from before records: nothing said, and no Update All, until the area is moved by hand (review of review fix 4)', async () => {
    const areaStep = install();
    await enlarge();
    act(() => {
      const document = state().diagram!;
      const { areaWas: _was, ...zoom } = step().zoom!;
      state().installDiagram({
        document: { ...document, steps: document.steps.map((entry) => (entry.id === 'step-2' ? { ...entry, zoom } : entry)) },
        readOnly: false,
        raw: null,
      } as never);
    });
    annotate(areaStep);
    expect(enlargedSection()!.textContent).toBe('Enlarged on step 2');
    expect(listAction('update-all')).toBeNull();
    annotate();
    expect(enlargedSection()!.textContent).not.toContain('Out of date');
    // Moved by hand, the move records the area as it was on the step: out of date, as any step is.
    moveArea(areaStep);
    annotate(areaStep);
    expect(listAction('update-all')).not.toBeNull();
    annotate();
    expect(enlargedSection()!.textContent).toContain('Out of date: Step 1’s area changed');
    expect(listAction('update-enlarged')).not.toBeNull();
  });

  it('waits, visibly, while its Update folds the faces it needs, and takes no second press (review of review fix 4)', async () => {
    const areaStep = install();
    await enlarge();
    moveArea(areaStep);
    let finish: (placed: number) => void = () => {};
    const update = vi.fn(() => new Promise<number>((resolve) => (finish = resolve)));
    act(() => useWorkspaceStore.setState({ updateEnlargedDiagramStep: update }));
    annotate();
    act(() => listAction('update-enlarged')!.click());
    expect(listAction('update-enlarged')!.getAttribute('aria-disabled')).toBe('true');
    expect(listAction('update-enlarged')!.title).toBe('Its picture is being captured');
    act(() => listAction('update-enlarged')!.click());
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('step-2');
    await act(async () => {
      finish(1);
      await Promise.resolve();
    });
    expect(listAction('update-enlarged')!.getAttribute('aria-disabled')).toBeNull();
    expect(listAction('update-enlarged')!.title).toBe('Place the frame again from step 1’s area as it is now');
  });

  it('holds the switch and the rows on a diagram that cannot change', async () => {
    install();
    await enlarge();
    act(() => useWorkspaceStore.setState({ diagramReadOnly: true }));
    annotate();
    expect(enlargedSwitch()!.disabled).toBe(true);
    act(() => buttonNamed('Fixed')!.click());
    expect(step().zoom!.scale).toBeUndefined();
    expect(zoomAction('pick-anchor')!.getAttribute('aria-disabled')).toBe('true');
  });
});

/** The read-only section with the step's verbs, as the Step pane composes it. */
function StatusOf({ stepId }: { stepId: string }) {
  const actions = useDiagramStepActions(stepId);
  return <DiagramStepZoomStatus step={stepById(useWorkspaceStore.getState().diagram!, stepId)!} actions={actions} />;
}

describe('the Step pane on an enlarged step, out of the step detail', () => {
  function status() {
    act(() => root!.render(<StatusOf stepId="step-2" />));
  }

  it('says where its frame came from — a row that goes there — and its Size', async () => {
    const areaStep = install();
    status();
    expect(host!.textContent).toBe('');
    await enlarge();
    status();
    expect(host!.textContent).toContain('FromStep 1’s area');
    expect(host!.textContent).toContain('SizeFill');
    const row = [...host!.querySelectorAll('button')].find((each) => each.textContent?.includes('Step 1’s area'))!;
    act(() => row.click());
    expect(state().diagramSelectedStepId).toBe(areaStep);
  });

  it('says its area changed, with Update, and once deleted that it was, with none (review fix 4)', async () => {
    const areaStep = install();
    await enlarge();
    moveArea(areaStep);
    status();
    expect(host!.textContent).toContain('Out of date: Step 1’s area changed');
    await clickAndSettle(listAction('update-enlarged')!);
    status();
    expect(host!.textContent).not.toContain('Out of date');
    expect(listAction('update-enlarged')).toBeNull();
    act(() => state().editDiagramAnnotations(areaStep, 'Delete annotation', (list) => list.filter((mark) => mark.kind !== 'zoom')));
    status();
    expect(host!.textContent).toContain('FromStep 1’s area was deleted');
    expect(listAction('update-enlarged')).toBeNull();
  });

  it('says what it prints at once the pages are laid out, amber where its room or its area holds it back (Z4)', async () => {
    install();
    await enlarge();
    printed.zoom = { asked: null, printed: 4.43, reduced: false };
    status();
    expect(host!.textContent).toContain('SizeFill · prints ×4.4');
    expect(host!.querySelector('[role="status"], [data-tone="warning"]')).toBeNull();
    printed.zoom = { asked: 3, printed: 2.38, reduced: true };
    status();
    expect(host!.textContent).toContain('Asked ×3 · prints ×2.4 — the room is too small');
    printed.zoom = { asked: null, printed: 1.08, reduced: false };
    status();
    expect(host!.textContent).toContain('Prints only ×1.1 — draw a smaller area');
  });

  it('on the area’s own step, says which steps enlarged from it are out of date, with Update All; nothing while none is (review of review fix 4)', async () => {
    const areaStep = install();
    await enlarge();
    const own = () => act(() => root!.render(<StatusOf stepId={areaStep} />));
    own();
    expect(host!.textContent).toBe('');
    moveArea(areaStep);
    own();
    expect(enlargedSection()!.textContent).toBe('Enlarged on step 2Out of date: step 2Update All');
    const was = past();
    await clickAndSettle(listAction('update-all')!);
    expect(past()).toBe(was + 1);
    own();
    expect(host!.textContent).toBe('');
  });

  it('names the steps a Refresh would anchor, where a capture is older than its faces, and what to do then', async () => {
    install({ faces: false });
    await enlarge();
    status();
    expect(host!.textContent).toContain('Refresh step 2, then Update from step 1’s area, to anchor the frame to its paper.');
    expect(host!.textContent).toContain('Refresh step 1, then Update from step 1’s area, to anchor the frame to its paper.');
  });
});
