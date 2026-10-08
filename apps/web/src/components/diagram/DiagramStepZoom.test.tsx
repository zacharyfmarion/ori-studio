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
          annotateTool={null}
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
  /** The switch's row, which carries what it does, or why it cannot, as its tooltip. */
  const switchRow = () => enlargedSwitch()!.closest<HTMLElement>('[data-field-row]')!;

  it('turns the step enlarged from the area before it, and back, each one undo step', async () => {
    install();
    annotate();
    expect(enlargedSwitch()!.getAttribute('aria-checked')).toBe('false');
    expect(switchRow().title).toBe('Enlarge from step 1’s area');
    // The switch alone, until the step is enlarged.
    expect(host!.querySelector('[data-step-enlarged]')!.textContent).toBe('Enlarged');
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
      'Refresh step 2, then Update Enlarged Steps on step 1’s area, to anchor the frame to its paper.'
    );
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

describe('the Step pane on an enlarged step, out of the step detail', () => {
  function status() {
    act(() => root!.render(<DiagramStepZoomStatus step={step()} />));
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

  it('names the steps a Refresh would anchor, where a capture is older than its faces, and what to do then', async () => {
    install({ faces: false });
    await enlarge();
    status();
    expect(host!.textContent).toContain(
      'Refresh step 2, then Update Enlarged Steps on step 1’s area, to anchor the frame to its paper.'
    );
    expect(host!.textContent).toContain(
      'Refresh step 1, then Update Enlarged Steps on step 1’s area, to anchor the frame to its paper.'
    );
  });
});
