import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureCpSegmentationArtifacts } from '../../cp-workspace/cpSegmentationArtifacts';
import type { ReferencesDiagramCard } from '../../cp-workspace/references/referencesDiagramCards';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { SENT_MODEL } from '../document/diagramSteps.fixtures';
import { STEP_DIAGRAM_MAX_PRIMITIVES } from '../document/stepDiagramModelFile';
import { cpDocument, TWO_SQUARES, twoSquaresSegmentation, type FixtureLine } from './capture.fixtures';
import { linkStatus } from './linkStatus';
import { sendReferencesToDiagram, type ReferencesSend } from './sendReferencesSteps';

vi.mock('../../cp-workspace/cpSegmentationArtifacts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/cpSegmentationArtifacts')>()),
  ensureCpSegmentationArtifacts: vi.fn(async () => segmentation),
}));
const analytics = vi.hoisted(() => ({
  trackDiagramStepAdded: vi.fn(),
  trackReferencesStepSentToDiagram: vi.fn(),
}));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const segmentation = twoSquaresSegmentation();
const [left] = resolveCpSegments(segmentation);
const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();
const steps = () => state().diagram?.steps ?? [];

/** The left square as the planner outlines it: its corners, from another one. */
const LEFT_OUTLINE: [number, number][] = [
  [100, 0],
  [100, 100],
  [0, 100],
  [0, 0],
];

function card(number: number | null, mirrored = false): ReferencesDiagramCard {
  return {
    kind: number === null ? 'turn-over' : 'fold',
    model: SENT_MODEL,
    mirrored,
    sentence: number === null ? 'Turn the paper over.' : `Fold ${number}.`,
    card: number,
    line: number === null ? null : { n: [0, 1], d: 0.5 },
  };
}

function send(patch: Partial<ReferencesSend> = {}): Promise<Awaited<ReturnType<typeof sendReferencesToDiagram>>> {
  return sendReferencesToDiagram({
    cards: [card(1)],
    outline: LEFT_OUTLINE,
    mode: 'sequence',
    settings: { precreaseGrid: true, gridWhereNeeded: false, allowDanglingFolds: true, mergeSymmetricSteps: true },
    via: 'one',
    ...patch,
  });
}

const useDocument = (document = cpDocument()) =>
  useWorkspaceStore.setState({
    oristudioCpDocument: { handle: 1, document, geometry: null } as unknown as OristudioCpDocumentState,
  });

/** One square's diagonal flipped: 7 is the left one, 8 the right. */
const flipped = (index: number) =>
  cpDocument(
    TWO_SQUARES.map((line, i): FixtureLine =>
      i === index ? [...line.slice(0, 4), line[4] === 'Red1' ? 'Blue2' : 'Red1'] as FixtureLine : line
    )
  );

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(initialState, true);
  useDocument();
});

describe('Send to diagram', () => {
  it('adds the card as a step, linked to its sheet as the Diagram finds it, and says where', async () => {
    const outcome = await send();
    expect(outcome).toMatchObject({ status: 'sent', filled: false });
    const [step] = steps();
    expect(step).toMatchObject({
      text: 'Fold 1.',
      picture: { kind: 'step-diagram', model: SENT_MODEL, mirrored: false },
      source: {
        kind: 'references-step',
        mode: 'sequence',
        card: 1,
        line: { n: [0, 1], d: 0.5 },
        side: 'front',
        settings: { gridWhereNeeded: false },
        // The region as the segmentation has it, not the planner's outline.
        region: { segmentIdHint: left!.id, bounds: left!.bounds },
      },
    });
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Send to diagram');
    expect(toasts.success).toHaveBeenCalledWith('Added as step 1', expect.objectContaining({ action: expect.anything() }));
    expect(analytics.trackReferencesStepSentToDiagram).toHaveBeenCalledWith('sequence', 'one', 1, false);
    expect(analytics.trackDiagramStepAdded).toHaveBeenCalledWith('references', 'references');
  });

  // The plan's browser check: editing another sheet is no change to this one.
  it('reads its sheet changed when its own creases change, and only then', async () => {
    await send();
    const source = steps()[0]!.source!;
    if (source.kind !== 'references-step') throw new Error('sent');
    expect(linkStatus(source, cpDocument(), segmentation)).toBe('current');
    expect(linkStatus(source, flipped(8), segmentation)).toBe('current');
    expect(linkStatus(source, flipped(7), segmentation)).toBe('stale');
    expect(linkStatus(source, cpDocument(), twoSquaresSegmentation({ wall: false }))).toBe('missing');
  });

  it('still sends a card whose sheet matches no region, and says its pattern cannot be found', async () => {
    await send({ outline: [[0, 0], [300, 0], [300, 300], [0, 300]] });
    const source = steps()[0]!.source!;
    if (source.kind !== 'references-step') throw new Error('sent');
    expect(source).toMatchObject({ fingerprint: null, region: { segmentIdHint: null } });
    expect(source.thumbnail.strokes).toHaveLength(4);
    expect(linkStatus(source, cpDocument(), segmentation)).toBe('missing');
    // Nor does it say it changed if a region comes to match it: it kept no creases to compare.
    const matched = { ...source, region: { ...source.region, boundary: [LEFT_OUTLINE.map(([x, y]) => ({ x, y }))] } };
    expect(linkStatus(matched, cpDocument(), segmentation)).toBe('unknown');
  });

  it('sends nothing while the pattern’s regions cannot be worked out, and says to try again', async () => {
    vi.mocked(ensureCpSegmentationArtifacts).mockResolvedValueOnce(null);
    expect(await send()).toEqual({ status: 'unknown' });
    expect(steps()).toEqual([]);
    expect(toasts.error).toHaveBeenCalledWith('The crease pattern isn’t ready yet. Try again in a moment.');
  });

  it('sends the strip as consecutive steps, one undo step, after the selected one', async () => {
    const first = state().addDiagramStep()!;
    state().addDiagramStep();
    state().selectDiagramStep(first);
    const before = state().diagramHistory.past.length;
    const outcome = await send({ cards: [card(1), card(null, true), card(2, true)], via: 'all' });
    if (outcome.status !== 'sent') throw new Error('sent');
    expect(steps().map((step) => step.id)).toEqual([first, ...outcome.stepIds, expect.any(String)]);
    expect(steps()[2]).toMatchObject({
      text: 'Turn the paper over.',
      source: { card: null, side: 'back' },
      picture: { mirrored: true },
    });
    expect(state().diagramHistory.past).toHaveLength(before + 1);
    expect(state().diagramSelectedStepId).toBe(outcome.stepIds[2]);
    expect(toasts.success).toHaveBeenCalledWith('Added as steps 2–4', expect.anything());
  });

  it('fills the step From References… waits for, and stops waiting', async () => {
    state().addDiagramStep();
    const waiting = state().addDiagramStep()!;
    expect(state().requestDiagramStepFromReferences(waiting)).toBe(true);
    const outcome = await send({ cards: [card(1), card(2)], via: 'all' });
    expect(outcome).toMatchObject({ status: 'sent', filled: true });
    expect(steps()[1]).toMatchObject({ id: waiting, source: { card: 1 } });
    expect(steps()).toHaveLength(3);
    expect(state().diagramReferencesTarget).toBeNull();
    expect(toasts.success).toHaveBeenCalledWith('Added as steps 2–3', expect.anything());
    // The filled step was already there: only the new one is an added step.
    expect(analytics.trackDiagramStepAdded).toHaveBeenCalledTimes(1);
    expect(analytics.trackReferencesStepSentToDiagram).toHaveBeenCalledWith('sequence', 'all', 2, true);
  });

  it('says the step it filled, when it filled one', async () => {
    const waiting = state().addDiagramStep()!;
    state().requestDiagramStepFromReferences(waiting);
    await send();
    expect(toasts.success).toHaveBeenCalledWith('Sent to step 1', expect.anything());
  });

  it('sends nothing to a read-only diagram, or with no pattern open, and says why', async () => {
    useWorkspaceStore.setState({ diagramReadOnly: true });
    expect(await send()).toEqual({ status: 'read-only' });
    expect(toasts.error).toHaveBeenLastCalledWith(expect.stringContaining('read-only'));
    useWorkspaceStore.setState({ diagramReadOnly: false, oristudioCpDocument: null });
    expect(await send()).toEqual({ status: 'no-pattern' });
    expect(steps()).toEqual([]);
  });

  it('sends nothing when a card is past what the file reads back', async () => {
    const line = { kind: 'line' as const, from: [0, 0] as const, to: [1, 1] as const, style: 'crease' as const };
    const huge = { ...card(1), model: { ...SENT_MODEL, primitives: Array.from({ length: STEP_DIAGRAM_MAX_PRIMITIVES + 1 }, () => line) } };
    expect(await send({ cards: [card(2), huge] })).toEqual({ status: 'too-large' });
    expect(steps()).toEqual([]);
    expect(toasts.error).toHaveBeenCalledWith('This step is too detailed to keep in the diagram.');
  });

  it('drops a send that outlived its diagram', async () => {
    const pending = send();
    // A project opened while the sheet was being found.
    useWorkspaceStore.setState({ diagramLoadId: state().diagramLoadId + 1 });
    expect(await pending).toEqual({ status: 'discarded' });
    expect(steps()).toEqual([]);
  });
});
