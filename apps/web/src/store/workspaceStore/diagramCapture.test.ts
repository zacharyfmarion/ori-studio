import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import {
  cpDocument,
  fakeCaptureRuntime,
  twoSquaresSegmentation,
} from '../../diagram/capture/capture.fixtures';
import type { CpCaptureRuntime } from '../../diagram/capture/captureFolded';
import { linkStatus } from '../../diagram/capture/linkStatus';
import type { DiagramCpScope } from '../../diagram/document/diagramDocument';
import { useWorkspaceStore } from '../workspaceStore';
import { DEFAULT_DIAGRAM_STYLE, setLinkedPicture, createDiagram, insertSteps } from '../../diagram/document/diagramDocument';
import { cpStep, stepsIn } from '../../diagram/document/diagramSteps.fixtures';
import { sheetWithCrease } from '../../lib/paper/paperScene.fixtures';
import { keptPicture, type DiagramCaptureRequest } from './diagramCapture';

const bindings = vi.hoisted(() => ({
  runtime: null as CpCaptureRuntime | null,
  createCpCaptureRuntime: vi.fn(),
}));
vi.mock('./cpFoldRuntimeBindings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cpFoldRuntimeBindings')>()),
  createCpCaptureRuntime: bindings.createCpCaptureRuntime,
}));
const segmentationModule = vi.hoisted(() => ({ ensureCpSegmentationArtifacts: vi.fn() }));
vi.mock('../../cp-workspace/cpSegmentationArtifacts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/cpSegmentationArtifacts')>()),
  ...segmentationModule,
}));
const cancellation = vi.hoisted(() => ({ foldCancellationAvailable: vi.fn(() => true), cancelFoldRun: vi.fn() }));
vi.mock('../../lib/foldCancellation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/foldCancellation')>()),
  ...cancellation,
}));

// No canvas here: a bitmap of the page is a few fixed bytes.
vi.mock('../../lib/paper/paperPng', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/paper/paperPng')>()),
  paperSvgToPng: vi.fn(async () => new Uint8Array([137, 80, 78, 71])),
}));

const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();

const segmentation = twoSquaresSegmentation();
const [left] = resolveCpSegments(segmentation);
const scope: DiagramCpScope = { kind: 'segment', region: regionReferenceFor(left!) };
const document = cpDocument();

const linkRequest: DiagramCaptureRequest = {
  scope,
  render: { mode: 'crease-pattern', rotationDeg: 0 },
  kind: 'diagram-capture',
  label: 'Link pattern',
};
const flatRequest: DiagramCaptureRequest = {
  scope,
  render: { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 },
  kind: 'diagram-refresh',
  label: 'Refresh picture',
};

/** A fold the test lets finish. */
function deferredFold() {
  let finish!: () => void;
  const started = new Promise<void>((resolve) => {
    bindings.runtime = fakeCaptureRuntime({
      fold: vi.fn(async () => {
        resolve();
        await new Promise<void>((done) => {
          finish = done;
        });
        return { handle: 7, discoveredCases: 1, displayStyle: 'Paper5' as const, outcome: 'Solved' as const };
      }),
    });
  });
  return { started, finish: () => finish() };
}

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(initialState, true);
  useWorkspaceStore.setState({
    oristudioCpDocument: { handle: 1, document, geometry: null } as unknown as OristudioCpDocumentState,
  });
  bindings.runtime = fakeCaptureRuntime();
  bindings.createCpCaptureRuntime.mockImplementation(() => bindings.runtime);
  segmentationModule.ensureCpSegmentationArtifacts.mockResolvedValue(segmentation);
});

describe('captureDiagramStep', () => {
  it('links a step to the pattern as one undo step, and it reads current against the pattern unedited', async () => {
    const stepId = state().addDiagramStep()!;
    const before = state().diagramHistory.past.length;
    const outcome = await state().captureDiagramStep(stepId, linkRequest);
    expect(outcome).toMatchObject({ status: 'captured', changed: true });
    const step = stepsIn(state().diagram!)[0]!;
    expect(step.source?.kind).toBe('cp');
    expect(step.picture?.kind).toBe('scene');
    expect(state().diagramHistory.past).toHaveLength(before + 1);
    expect(state().dirty).toBe(true);
    if (step.source?.kind !== 'cp') return;
    expect(linkStatus(step.source, document, segmentation)).toBe('current');
    // A crease pattern is drawn, not folded: no run to show.
    expect(bindings.runtime!.fold).not.toHaveBeenCalled();
    expect(state().oristudioCpFoldRuns).toEqual({});
  });

  it('records nothing for a capture that changes nothing', async () => {
    const stepId = state().addDiagramStep()!;
    await state().captureDiagramStep(stepId, linkRequest);
    const entries = state().diagramHistory.past.length;
    expect(await state().captureDiagramStep(stepId, linkRequest)).toMatchObject({ changed: false });
    expect(state().diagramHistory.past).toHaveLength(entries);
  });

  it('folds as a visible run the card can stop, and lets it go when done', async () => {
    const stepId = state().addDiagramStep()!;
    const fold = deferredFold();
    const capturing = state().captureDiagramStep(stepId, flatRequest);
    await fold.started;
    const runs = Object.values(state().oristudioCpFoldRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ kind: 'diagram-refresh', cancellable: true });
    expect(state().diagramCaptures[stepId]).toEqual({ runId: runs[0]!.runId });
    // A second capture of the same step waits its turn.
    expect(await state().captureDiagramStep(stepId, flatRequest)).toEqual({ status: 'busy' });
    expect(state().stopDiagramCapture(stepId)).toBe(true);
    expect(cancellation.cancelFoldRun).toHaveBeenCalledWith(runs[0]!.runId);
    fold.finish();
    await capturing;
    expect(state().oristudioCpFoldRuns).toEqual({});
    expect(state().diagramCaptures).toEqual({});
  });

  it('drops what it captured when the step’s picture changed while it folded', async () => {
    const stepId = state().addDiagramStep()!;
    const fold = deferredFold();
    const capturing = state().captureDiagramStep(stepId, flatRequest);
    await fold.started;
    state().setDiagramStepPicture(stepId, {
      id: 'asset-1',
      kind: 'svg',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>',
      widthPx: 4,
      heightPx: 4,
      bytes: 10,
    });
    fold.finish();
    expect(await capturing).toEqual({ status: 'discarded' });
    expect(stepsIn(state().diagram!)[0]!.source?.kind).toBe('upload');
  });

  it('keeps an instruction typed while it folded, and commits around it', async () => {
    const stepId = state().addDiagramStep()!;
    const fold = deferredFold();
    const capturing = state().captureDiagramStep(stepId, flatRequest);
    await fold.started;
    state().setDiagramStepText(stepId, 'Valley fold in half.');
    fold.finish();
    expect(await capturing).toMatchObject({ status: 'captured' });
    expect(stepsIn(state().diagram!)[0]).toMatchObject({ text: 'Valley fold in half.', source: { kind: 'cp' } });
  });

  it('drops what it captured when the diagram was replaced while it folded', async () => {
    const stepId = state().addDiagramStep()!;
    const fold = deferredFold();
    const capturing = state().captureDiagramStep(stepId, flatRequest);
    await fold.started;
    state().installDiagram(null);
    fold.finish();
    expect(await capturing).toEqual({ status: 'discarded' });
    expect(state().diagram).toBeNull();
  });

  it('says it was stopped when the kernel unwinds a Stop', async () => {
    const stepId = state().addDiagramStep()!;
    bindings.runtime = fakeCaptureRuntime({
      fold: vi.fn(async () => {
        throw { code: 'fold_cancelled', message: 'cancelled' };
      }),
    });
    expect(await state().captureDiagramStep(stepId, flatRequest)).toEqual({ status: 'stopped' });
    expect(stepsIn(state().diagram!)[0]!.source).toBeNull();
    expect(state().oristudioCpFoldRuns).toEqual({});
  });

  it('cannot link with no pattern open, or a step that is not there', async () => {
    const stepId = state().addDiagramStep()!;
    expect(await state().captureDiagramStep('step-gone', linkRequest)).toEqual({ status: 'discarded' });
    useWorkspaceStore.setState({ oristudioCpDocument: null });
    expect(await state().captureDiagramStep(stepId, linkRequest)).toEqual({ status: 'no-pattern' });
  });

  it('changes nothing in a read-only diagram', async () => {
    state().addDiagramStep();
    const stepId = stepsIn(state().diagram!)[0]!.id;
    useWorkspaceStore.setState({ diagramReadOnly: true });
    expect(await state().captureDiagramStep(stepId, linkRequest)).toEqual({ status: 'read-only' });
  });
});

describe('a capture kept as a bitmap', () => {
  const render = { mode: 'crease-pattern', rotationDeg: 0 } as const;
  const overBudget = (scene = sheetWithCrease()) => ({ kind: 'over-budget' as const, scene, paperScale: 1.47 });

  // Each capture minted a random id, so the same capture again was a new
  // picture: another undo step and another multi-megabyte bitmap each time.
  it('is named by what it draws, so the same capture again changes nothing', async () => {
    const first = await keptPicture(overBudget(), render, DEFAULT_DIAGRAM_STYLE);
    const again = await keptPicture(overBudget(), render, DEFAULT_DIAGRAM_STYLE);
    expect(again.picture).toEqual(first.picture);
    expect(again.asset?.id).toBe(first.asset?.id);
    const step = cpStep('step-a', render, first.picture);
    const source = step.source?.kind === 'cp' ? step.source : null;
    if (!source) throw new Error('linked');
    const document = insertSteps(createDiagram({ title: 'Big' }), [step], 0);
    const withAsset = setLinkedPicture(document, 'step-a', { source, picture: first.picture, asset: first.asset });
    expect(setLinkedPicture(withAsset, 'step-a', { source, picture: again.picture, asset: again.asset })).toBe(
      withAsset
    );
  });

  it('is another picture when it draws something else', async () => {
    const first = await keptPicture(overBudget(), render, DEFAULT_DIAGRAM_STYLE);
    const moved = sheetWithCrease();
    const crease = moved.items.find((item) => item.kind === 'line');
    if (crease?.kind === 'line') crease.b = [crease.b[0] + 3, crease.b[1]];
    const other = await keptPicture(overBudget(moved), render, DEFAULT_DIAGRAM_STYLE);
    expect(other.picture.key).not.toBe(first.picture.key);
  });
});
