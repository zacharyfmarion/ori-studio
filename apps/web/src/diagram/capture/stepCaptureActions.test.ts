import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramCaptureOutcome } from '../../store/workspaceStore/diagramCapture';
import { twoSquaresSegmentation } from './capture.fixtures';
import { cpStep } from '../document/diagramSteps.fixtures';
import { insertSteps, createDiagram } from '../document/diagramDocument';
import { linkDiagramStep, refreshDiagramStep } from './stepCaptureActions';

const analytics = vi.hoisted(() => ({ trackDiagramPictureCaptured: vi.fn() }));
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

  it('keeps the picker open, and says why, when the link fails', async () => {
    answer({ status: 'failed', message: 'kernel says no' });
    useWorkspaceStore.setState({ diagramPatternPicker: 'step-empty' });
    expect(await linkDiagramStep('step-empty', left!)).toBe(false);
    expect(state().diagramPatternPicker).toBe('step-empty');
    expect(toasts.error).toHaveBeenCalledWith('The picture couldn’t be captured', { description: 'kernel says no' });
    expect(analytics.trackDiagramPictureCaptured).toHaveBeenCalledWith('crease_pattern', 'failed', 'link');
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
