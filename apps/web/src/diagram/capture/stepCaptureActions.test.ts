import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramCaptureOutcome } from '../../store/workspaceStore/diagramCapture';
import { twoSquaresSegmentation } from './capture.fixtures';
import { cpStep, stepsIn } from '../document/diagramSteps.fixtures';
import { insertSteps, createDiagram } from '../document/diagramDocument';
import { takeCpRegionFocus } from '../../cp-workspace/regions/regionFocusRequest';
import { useLayoutStore } from '../../store/layoutStore';
import {
  duplicateLinkedStepAs,
  linkDiagramStep,
  openDiagramStepInEdit,
  refreshDiagramStep,
  showLinkedStepAs,
} from './stepCaptureActions';
import { publishOpenLinkedPose } from './openLinkedPose';
import type { DiagramLinkedPose } from './useDiagramLinkedPose';

const analytics = vi.hoisted(() => ({
  trackDiagramPictureCaptured: vi.fn(),
  trackDiagramSourceOpened: vi.fn(),
  trackDiagramStepShownAs: vi.fn(),
}));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));
const toasts = vi.hoisted(() => ({ error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();
const [left] = resolveCpSegments(twoSquaresSegmentation());

function withSteps() {
  const diagram = insertSteps(createDiagram({ title: 'Linked' }), [
    { ...cpStep('step-empty', undefined, null), source: null },
    cpStep('step-flat', { mode: 'folded-flat', side: 'back', rotationDeg: 0, foldCase: 1 }),
  ], 0);
  useWorkspaceStore.setState({ diagram });
}

function answer(outcome: DiagramCaptureOutcome) {
  const capture = vi.fn(async () => outcome);
  useWorkspaceStore.setState({ captureDiagramStep: capture });
  return capture;
}

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(initialState, true);
  withSteps();
});

const CAPTURED: DiagramCaptureOutcome = {
  status: 'captured',
  changed: true,
  render: { mode: 'crease-pattern', rotationDeg: 0 },
  noLayerOrder: false,
  tooDetailed: false,
};

describe('linkDiagramStep', () => {
  it('links an empty step as a crease pattern, and closes the picker when it is in', async () => {
    const capture = answer(CAPTURED);
    useWorkspaceStore.setState({ diagramPatternPicker: 'step-empty' });
    expect(await linkDiagramStep('step-empty', left!)).toBe(true);
    expect(capture).toHaveBeenCalledWith('step-empty', expect.objectContaining({
      render: { mode: 'crease-pattern', rotationDeg: 0 },
      kind: 'diagram-capture',
      label: 'Link pattern',
      scope: expect.objectContaining({ kind: 'segment' }),
    }));
    expect(state().diagramPatternPicker).toBeNull();
    expect(analytics.trackDiagramPictureCaptured).toHaveBeenCalledWith('crease_pattern', 'ok', 'link');
  });

  it('relinks a linked step keeping how it shows its pattern', async () => {
    const capture = answer({ ...CAPTURED, render: { mode: 'folded-flat', side: 'back', rotationDeg: 0, foldCase: 1 } });
    await linkDiagramStep('step-flat', left!);
    expect(capture).toHaveBeenCalledWith('step-flat', expect.objectContaining({
      render: { mode: 'folded-flat', side: 'back', rotationDeg: 0, foldCase: 1 },
      label: 'Relink pattern',
    }));
    expect(analytics.trackDiagramPictureCaptured).toHaveBeenCalledWith('flat', 'ok', 'relink');
  });

  it('relinks a step folded part way in the simulator at 0%, from the camera it had', async () => {
    const view = { yaw: 0.4, pitch: -0.7, zoom: 1.6 };
    useWorkspaceStore.setState({
      diagram: insertSteps(createDiagram({ title: 'Simulated' }), [cpStep('step-sim', { mode: 'simulated', foldPercent: 40, view })], 0),
    });
    const capture = answer({ ...CAPTURED, render: { mode: 'simulated', foldPercent: 0, view } });
    expect(await linkDiagramStep('step-sim', left!, 'simulated')).toBe(true);
    expect(capture).toHaveBeenCalledWith(
      'step-sim',
      expect.objectContaining({ render: { mode: 'simulated', foldPercent: 0, view }, label: 'Relink pattern' })
    );
    expect(toasts.message).not.toHaveBeenCalled();
  });

  it('keeps the picker open, and says why, when the link fails', async () => {
    answer({ status: 'failed', message: 'kernel says no' });
    useWorkspaceStore.setState({ diagramPatternPicker: 'step-empty' });
    expect(await linkDiagramStep('step-empty', left!)).toBe(false);
    expect(state().diagramPatternPicker).toBe('step-empty');
    expect(toasts.error).toHaveBeenCalledWith('The picture couldn’t be captured', { description: 'kernel says no' });
    expect(analytics.trackDiagramPictureCaptured).toHaveBeenCalledWith('crease_pattern', 'failed', 'link');
  });
});

describe('showLinkedStepAs', () => {
  const openPose = (landed: boolean): DiagramLinkedPose => ({
    actions: [],
    layerOrder: null,
    spatial: null,
    onCamera: () => {},
    rotateTo: () => {},
    showAs: vi.fn(async () => landed),
    setSide: vi.fn(async () => landed),
    simulate: async () => {},
    wantsRest: () => false,
    spread: null,
    preview: null,
  });

  it('goes through the open step’s Pose, and counts it only when the step now shows that way', async () => {
    const refused = openPose(false);
    publishOpenLinkedPose('step-flat', refused);
    expect(await showLinkedStepAs('step-flat', 'crease-pattern', 'pane')).toBe(false);
    expect(refused.showAs).toHaveBeenCalledWith('crease-pattern');
    expect(analytics.trackDiagramStepShownAs).not.toHaveBeenCalled();

    const shown = openPose(true);
    publishOpenLinkedPose('step-flat', shown);
    expect(await showLinkedStepAs('step-flat', 'crease-pattern', 'pane')).toBe(true);
    expect(analytics.trackDiagramStepShownAs).toHaveBeenCalledExactlyOnceWith('crease_pattern', 'pane');
    publishOpenLinkedPose(null, null);
  });
});

describe('duplicateLinkedStepAs', () => {
  const ids = () => stepsIn(state().diagram!).map((step) => step.id);

  it('keeps the copy shown the other way, as one undo step, and counts it', async () => {
    answer({ ...CAPTURED, render: { mode: 'crease-pattern', rotationDeg: 0 } });
    const past = state().diagramHistory.past.length;
    const copy = await duplicateLinkedStepAs('step-flat', 'crease-pattern');
    expect(copy).not.toBeNull();
    expect(ids()).toEqual(['step-empty', 'step-flat', copy]);
    expect(state().diagramHistory.past.length).toBe(past + 1);
    expect(analytics.trackDiagramStepShownAs).toHaveBeenCalledExactlyOnceWith('crease_pattern', 'duplicate');
  });

  it('takes the copy away again when its picture cannot be shown that way, and counts nothing', async () => {
    answer({ status: 'unavailable' });
    const past = state().diagramHistory.past.length;
    expect(await duplicateLinkedStepAs('step-flat', 'simulated')).toBeNull();
    expect(ids()).toEqual(['step-empty', 'step-flat']);
    expect(state().diagramHistory.past.length).toBe(past);
    expect(toasts.error).toHaveBeenCalled();
    expect(analytics.trackDiagramStepShownAs).not.toHaveBeenCalled();
  });

  it('is a plain duplicate shown the same way: nothing captured or counted as a way', async () => {
    const capture = answer(CAPTURED);
    const copy = await duplicateLinkedStepAs('step-flat', 'folded');
    expect(ids()).toEqual(['step-empty', 'step-flat', copy]);
    expect(capture).not.toHaveBeenCalled();
    expect(analytics.trackDiagramStepShownAs).not.toHaveBeenCalled();
  });
});

describe('refreshDiagramStep', () => {
  it('captures a linked step again as it is shown, and says when its layers have no order', async () => {
    const capture = answer({ ...CAPTURED, noLayerOrder: true, render: { mode: 'folded-flat', side: 'back', rotationDeg: 0, foldCase: 1 } });
    expect(await refreshDiagramStep('step-flat')).toBe(true);
    expect(capture).toHaveBeenCalledWith('step-flat', expect.objectContaining({ kind: 'diagram-refresh', label: 'Refresh picture' }));
    expect(toasts.message).toHaveBeenCalledOnce();
    expect(analytics.trackDiagramPictureCaptured).toHaveBeenCalledWith('flat', 'no_layer_order', 'refresh');
  });

  it('does nothing for a step that is not linked, and counts nothing it did not try', async () => {
    const capture = answer(CAPTURED);
    expect(await refreshDiagramStep('step-empty')).toBe(false);
    expect(capture).not.toHaveBeenCalled();
    answer({ status: 'discarded' });
    await refreshDiagramStep('step-flat');
    expect(analytics.trackDiagramPictureCaptured).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('counts a Stop, and says nothing about it', async () => {
    answer({ status: 'stopped' });
    await refreshDiagramStep('step-flat');
    expect(analytics.trackDiagramPictureCaptured).toHaveBeenCalledWith('flat', 'stopped', 'refresh');
    expect(toasts.error).not.toHaveBeenCalled();
  });
});

describe('openDiagramStepInEdit', () => {
  it('frames the step’s pattern in Edit, and counts the way back', () => {
    useLayoutStore.setState({ activeWorkspace: 'diagram' });
    takeCpRegionFocus();
    openDiagramStepInEdit('step-flat');
    expect(useLayoutStore.getState().activeWorkspace).toBe('edit');
    const step = stepsIn(state().diagram!)[1]!;
    expect(takeCpRegionFocus()).toEqual(
      step.source?.kind === 'cp' && step.source.scope.kind === 'segment' ? step.source.scope.region.bounds : null
    );
    expect(analytics.trackDiagramSourceOpened).toHaveBeenCalledWith('edit');
  });

  it('does nothing for a step with no pattern', () => {
    useLayoutStore.setState({ activeWorkspace: 'diagram' });
    openDiagramStepInEdit('step-empty');
    expect(useLayoutStore.getState().activeWorkspace).toBe('diagram');
    expect(analytics.trackDiagramSourceOpened).not.toHaveBeenCalled();
  });
});
