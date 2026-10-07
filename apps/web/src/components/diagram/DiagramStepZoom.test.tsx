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
import { paperFacesOf, toPicture } from '../../diagram/zoom/zoomImprint';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramStepDetail } from './DiagramStepDetail';
import { DiagramStepZoomStatus } from './DiagramStepZoomStatus';
import { DiagramStepPose } from './DiagramStepPose';
import { PHONE_MEDIA_QUERY } from '../../platform/phoneLayout';

/** What the pages lay each enlarged step out at, as the Diagram panel publishes it. */
const printed = vi.hoisted(() => ({ zoom: null as { asked: number | null; printed: number; reduced: boolean } | null }));
vi.mock('../../diagram/pages/printedFrames', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../diagram/pages/printedFrames')>()),
  usePrintedZoom: (stepId: string | null) => (stepId === null ? null : printed.zoom),
}));

/**
 * Pose's Enlarged and the Step pane's word on an enlarged step, through the
 * store (Revision 2, 16e).
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
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
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

const enlargedButton = () => host!.querySelector<HTMLButtonElement>('button[aria-label="Enlarged"]');

describe('Pose’s Enlarged', () => {
  it('is a toggle on a linked step’s toolbar, before Reset Pose, naming the step it captures from', async () => {
    install();
    detail(true);
    const button = enlargedButton()!;
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.nextElementSibling?.getAttribute('aria-label') ?? button.parentElement?.nextElementSibling?.querySelector('button')?.getAttribute('aria-label')).toBe('Reset Pose');
    await act(async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(step().zoom).toMatchObject({ from: 'area-head' });
    detail(true);
    expect(enlargedButton()!.getAttribute('aria-pressed')).toBe('true');
    act(() => enlargedButton()!.click());
    expect(step().zoom).toBeUndefined();
  });

  it('is in the Step drawer’s Pose section on a phone, as Spread Layers is, and not on its toolbar, which wraps', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === PHONE_MEDIA_QUERY,
      addEventListener() {},
      removeEventListener() {},
    }));
    install();
    detail(true);
    expect(enlargedButton()).toBeNull();
    act(() => root!.render(<DiagramStepPose step={step()} actions={[]} />));
    const toggle = host!.querySelector<HTMLElement>('[aria-label="Enlarged"]')!;
    expect(toggle.getAttribute('aria-checked') ?? String((toggle as HTMLInputElement).checked)).toBe('false');
    await act(async () => {
      toggle.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(step().zoom).toMatchObject({ from: 'area-head' });
  });

  it('is held, saying why, where no earlier step has an area — on a step that is not linked too', () => {
    install({ area: false });
    detail(false);
    const button = enlargedButton()!;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    act(() => button.click());
    expect(step().zoom).toBeUndefined();
  });
});

describe('the Step pane on an enlarged step', () => {
  function status() {
    act(() => root!.render(<DiagramStepZoomStatus step={step()} />));
  }

  it('says where its frame came from — a row that goes there — and its Size', async () => {
    const areaStep = install();
    status();
    expect(host!.textContent).toBe('');
    await act(async () => {
      await state().enlargeDiagramStep('step-2');
    });
    status();
    expect(host!.textContent).toContain('FromStep 1’s area');
    expect(host!.textContent).toContain('SizeFill');
    const row = [...host!.querySelectorAll('button')].find((each) => each.textContent?.includes('Step 1’s area'))!;
    act(() => row.click());
    expect(state().diagramSelectedStepId).toBe(areaStep);
  });

  it('says what it prints at once the pages are laid out, amber where its room or its area holds it back (Z4)', async () => {
    install();
    await act(async () => {
      await state().enlargeDiagramStep('step-2');
    });
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
    await act(async () => {
      await state().enlargeDiagramStep('step-2');
    });
    status();
    expect(host!.textContent).toContain(
      'Refresh step 2, then Update Enlarged Steps on step 1’s area, to anchor the frame to its paper.'
    );
    expect(host!.textContent).toContain(
      'Refresh step 1, then Update Enlarged Steps on step 1’s area, to anchor the frame to its paper.'
    );
  });
});
