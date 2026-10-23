import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagramTurnKind, SentDiagramEntry, SentFoldStep } from '../document/diagramDocument';
import { foldStepSource, scenePicture } from '../document/diagramSteps.fixtures';

/**
 * A pull from Fold counted in the Diagram's own funnels (`diagram step
 * added`, `diagram turn added`), as a References pull is. The captures are
 * stubbed: what Fold's replay would send is given, so no engine runs.
 */
const sent = vi.hoisted(() => ({ entries: [] as SentDiagramEntry[] }));
vi.mock('./foldPull', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./foldPull')>()),
  pullFoldTargets: vi.fn(async () => ({ sent: sent.entries, failed: 0 })),
}));
vi.mock('../../store/workspaceStore/foldSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/workspaceStore/foldSession')>()),
  foldSession: () => ({}),
}));
const analytics = vi.hoisted(() => ({ trackDiagramStepAdded: vi.fn(), trackDiagramTurnAdded: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));
const foldIo = vi.hoisted(() => ({ trackFoldStepSentToDiagram: vi.fn() }));
vi.mock('../../analytics/trackFoldIo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics/trackFoldIo')>()),
  ...foldIo,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const { useWorkspaceStore } = await import('../../store/workspaceStore');
const { useSettingsStore } = await import('../../store/settingsStore');
const { pullFromFold } = await import('./foldBrowserActions');

const state = () => useWorkspaceStore.getState();

function foldStep(step: string): SentFoldStep {
  const picture = scenePicture(`scene-${step}`);
  return { source: foldStepSource({ step }), picture, lifted: { picture, annotations: [] }, text: `Fold ${step}.` };
}
const TURN_OVER: DiagramTurnKind = { kind: 'turn-over', axis: 'vertical' };
const ROTATE: DiagramTurnKind = { kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } };

/** Targets only say how many: the stubbed replay sends `entries` whatever is asked. */
const TARGETS = [{ kind: 'step', step: 'fstep-1', moment: 'before' }] as const;

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useWorkspaceStore.setState({ foldSequences: [{ document: { id: 'fold-1', steps: [] } }] as never });
});

describe('a pull from Fold, counted (plan D17)', () => {
  it('counts each step and each turn it adds, as a References pull does, the turn by its kind', async () => {
    sent.entries = [foldStep('fstep-1'), TURN_OVER, foldStep('fstep-2'), ROTATE];
    expect(await pullFromFold(TARGETS, { kind: 'end' }, { via: 'fold' })).toBe(4);
    // Merge symmetric precreases is on by default; these steps are not runs.
    expect(foldIo.trackFoldStepSentToDiagram).toHaveBeenCalledWith('fold', 'many', { option: 'on', merged: 'none' });
    expect(analytics.trackDiagramStepAdded.mock.calls).toEqual([
      ['fold', 'fold'],
      ['fold', 'fold'],
    ]);
    expect(analytics.trackDiagramTurnAdded.mock.calls).toEqual([
      ['turn-over', 'fold'],
      ['rotate', 'fold'],
    ]);
  });

  it('does not count the empty step it fills: that step was there already', async () => {
    const empty = state().addDiagramStep()!;
    analytics.trackDiagramStepAdded.mockClear();
    sent.entries = [TURN_OVER, foldStep('fstep-1'), foldStep('fstep-2')];
    expect(await pullFromFold(TARGETS, { kind: 'fill', stepId: empty }, { via: 'diagram_browser' })).toBe(3);
    expect(state().diagram!.steps.map((entry) => entry.id)).toContain(empty);
    expect(analytics.trackDiagramStepAdded).toHaveBeenCalledTimes(1);
    expect(analytics.trackDiagramTurnAdded).toHaveBeenCalledWith('turn-over', 'fold');
  });

  it('says whether the option was on and whether a run of precreases became one step', async () => {
    useSettingsStore.getState().setDiagramFoldMergePrecreases(false);
    sent.entries = [foldStep('fstep-1')];
    await pullFromFold(TARGETS, { kind: 'end' }, { via: 'diagram_browser' });
    expect(foldIo.trackFoldStepSentToDiagram).toHaveBeenLastCalledWith('diagram_browser', 'one', { option: 'off', merged: 'none' });
    useSettingsStore.getState().setDiagramFoldMergePrecreases(true);
    const picture = scenePicture('scene-run');
    sent.entries = [
      { source: foldStepSource({ step: 'fstep-1', through: 'fstep-2' }), picture, lifted: { picture, annotations: [] }, text: 'Both.' },
    ];
    await pullFromFold(TARGETS, { kind: 'end' }, { via: 'diagram_browser' });
    expect(foldIo.trackFoldStepSentToDiagram).toHaveBeenLastCalledWith('diagram_browser', 'one', { option: 'on', merged: 'some' });
  });

  it('counts nothing when nothing lands', async () => {
    sent.entries = [];
    expect(await pullFromFold(TARGETS, { kind: 'end' }, { via: 'fold' })).toBe(0);
    expect(analytics.trackDiagramStepAdded).not.toHaveBeenCalled();
    expect(analytics.trackDiagramTurnAdded).not.toHaveBeenCalled();
    expect(foldIo.trackFoldStepSentToDiagram).not.toHaveBeenCalled();
  });
});
