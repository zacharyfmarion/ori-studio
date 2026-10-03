import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fileServiceModule from '../platform/fileService';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { DiagramPoseAction } from './actions/diagramPoseActions';
import { diagramStepChoice, diagramStepCommand, type DiagramStepAction } from './actions/diagramActions';
import { createDiagram, insertSteps } from './document/diagramDocument';
import { cpStep } from './document/diagramSteps.fixtures';
import {
  appendDiagramStep,
  diagramStepActions,
  insertDiagramStepBeside,
  openDiagramStep,
  useDiagramPoseActions,
  useDiagramStepActions,
} from './useDiagramActions';

/** What the Diagram's bindings report, and when. */
const analytics = vi.hoisted(() => ({
  trackDiagramStepOpened: vi.fn(),
  trackDiagramPicturePosed: vi.fn(),
  trackDiagramPictureRemoved: vi.fn(),
  trackDiagramPictureExported: vi.fn(),
  trackDiagramStepAdded: vi.fn(),
}));
vi.mock('../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../analytics')>()),
  ...analytics,
}));
const capture = vi.hoisted(() => ({ showLinkedStepAs: vi.fn(async () => true) }));
vi.mock('./capture/stepCaptureActions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./capture/stepCaptureActions')>()),
  ...capture,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;
const state = () => useWorkspaceStore.getState();
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" viewBox="0 0 4 4"/>';

function pictureStep(): string {
  const stepId = state().addDiagramStep()!;
  state().setDiagramStepPicture(stepId, {
    id: 'asset-a',
    kind: 'svg',
    svg,
    widthPx: 4,
    heightPx: 4,
    bytes: svg.length,
  });
  return stepId;
}

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  vi.clearAllMocks();
});

describe('appendDiagramStep', () => {
  it('adds an empty step after the last one, whichever is selected, selects it and counts it', () => {
    const first = state().addDiagramStep()!;
    const second = state().addDiagramStep()!;
    state().selectDiagramStep(first);
    vi.clearAllMocks();
    const added = appendDiagramStep()!;
    expect(state().diagram!.steps.map((step) => step.id)).toEqual([first, second, added]);
    expect(state().diagramSelectedStepId).toBe(added);
    expect(analytics.trackDiagramStepAdded).toHaveBeenCalledExactlyOnceWith('empty', 'grid');
  });
});

describe('insertDiagramStepBeside', () => {
  it('adds an empty step just after or before one, selects it and counts it', () => {
    const first = state().addDiagramStep()!;
    const second = state().addDiagramStep()!;
    vi.clearAllMocks();
    const between = insertDiagramStepBeside(first, 'after')!;
    expect(state().diagram!.steps.map((step) => step.id)).toEqual([first, between, second]);
    expect(state().diagramSelectedStepId).toBe(between);
    const before = insertDiagramStepBeside(first, 'before')!;
    expect(state().diagram!.steps.map((step) => step.id)).toEqual([before, first, between, second]);
    expect(analytics.trackDiagramStepAdded).toHaveBeenCalledTimes(2);
    expect(analytics.trackDiagramStepAdded).toHaveBeenCalledWith('empty', 'grid');
  });
});

describe('Show as, by the surface it is chosen on', () => {
  it('says the card’s menu for the menu’s verbs and the Step pane for the pane’s', () => {
    useWorkspaceStore.setState({
      diagram: insertSteps(createDiagram({ title: 'Ways' }), [cpStep('step-l', { mode: 'crease-pattern', rotationDeg: 0 })], 0),
    });
    const choose = (actions: readonly DiagramStepAction[]) =>
      diagramStepChoice(actions, 'show-as')!.options.find((option) => option.id === 'folded')!.run();
    choose(diagramStepActions('step-l', t));
    expect(capture.showLinkedStepAs).toHaveBeenLastCalledWith('step-l', 'folded', 'card');

    const seen: { actions: DiagramStepAction[] } = { actions: [] };
    function Pane() {
      const actions = useDiagramStepActions('step-l');
      seen.actions = actions;
      return null;
    }
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    act(() => root.render(<Pane />));
    choose(seen.actions);
    expect(capture.showLinkedStepAs).toHaveBeenLastCalledWith('step-l', 'folded', 'pane');
    act(() => root.unmount());
    host.remove();
  });
});

describe('the Diagram’s analytics', () => {
  it('counts a step opened in detail, by how, and not one that does not open', () => {
    const stepId = pictureStep();
    expect(openDiagramStep(stepId, 'double_click')).toBe(true);
    expect(analytics.trackDiagramStepOpened).toHaveBeenCalledWith('double_click', 'pose');
    expect(openDiagramStep('missing', 'keyboard')).toBe(false);
    expect(analytics.trackDiagramStepOpened).toHaveBeenCalledOnce();
  });

  it('counts a step opened from a verb by its half, with Select in hand', () => {
    const stepId = pictureStep();
    act(() => state().setDiagramAnnotateTool('valley-arrow'));
    diagramStepCommand(diagramStepActions(stepId, t), 'annotate')?.run();
    expect(analytics.trackDiagramStepOpened).toHaveBeenCalledWith('command', 'annotate');
    expect(state().diagramDetail).toBe('annotate');
    expect(state().diagramAnnotateTool).toBeNull();
    // Switching halves while open keeps the tool, as walking the steps does.
    act(() => state().setDiagramAnnotateTool('valley-arrow'));
    expect(openDiagramStep(stepId, 'command')).toBe(true);
    expect(state().diagramDetail).toBe('pose');
    expect(state().diagramAnnotateTool).toBe('valley-arrow');
  });

  it('counts a removed picture by its kind', () => {
    const stepId = pictureStep();
    diagramStepCommand(diagramStepActions(stepId, t), 'remove-picture')?.run();
    expect(analytics.trackDiagramPictureRemoved).toHaveBeenCalledWith('svg');
  });

  it('counts an export once a file is written, by its format', async () => {
    const stepId = pictureStep();
    const saved = vi.fn(async (options: { suggestedName: string }) => ({ name: options.suggestedName, path: null }));
    vi.spyOn(fileServiceModule, 'getFileService').mockReturnValue({
      saveTextFile: saved,
    } as unknown as ReturnType<typeof fileServiceModule.getFileService>);
    diagramStepCommand(diagramStepActions(stepId, t), 'export-picture')?.run();
    await vi.waitFor(() => expect(analytics.trackDiagramPictureExported).toHaveBeenCalledWith('svg'));
  });

  it('counts a pose verb by its action and the picture’s kind', () => {
    const stepId = pictureStep();
    let actions: DiagramPoseAction[] = [];
    function Host() {
      actions = useDiagramPoseActions(stepId);
      return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Host />));
    act(() => actions.find((action) => action.id === 'rotate-right')?.run());
    expect(analytics.trackDiagramPicturePosed).toHaveBeenCalledWith('rotate_right', 'svg');
    act(() => root.unmount());
  });
});
