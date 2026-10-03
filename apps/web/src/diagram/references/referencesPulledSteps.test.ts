import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureCpSegmentationArtifacts } from '../../cp-workspace/cpSegmentationArtifacts';
import type { ReferencesDiagramCard } from '../../cp-workspace/references/referencesDiagramCards';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cpDocument, TWO_SQUARES, twoSquaresSegmentation, type FixtureLine } from '../capture/capture.fixtures';
import { linkStatus } from '../capture/linkStatus';
import { SENT_MODEL } from '../document/diagramSteps.fixtures';
import { STEP_DIAGRAM_MAX_PRIMITIVES } from '../document/stepDiagramModelFile';
import { pullFromReferences, referencesCardPicture, type PulledCard, type ReferencesPull } from './referencesPulledSteps';

vi.mock('../../cp-workspace/cpSegmentationArtifacts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/cpSegmentationArtifacts')>()),
  ensureCpSegmentationArtifacts: vi.fn(async () => segmentation),
}));
const analytics = vi.hoisted(() => ({
  trackDiagramStepAdded: vi.fn(),
  trackDiagramStepsPulledFromReferences: vi.fn(),
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

function card(number: number | null, mirrored = false, way: string | null = null): PulledCard {
  const drawn: ReferencesDiagramCard = {
    kind: number === null ? 'turn-over' : 'fold',
    model: SENT_MODEL,
    mirrored,
    sentence: number === null ? 'Turn the paper over.' : `Fold ${number}.`,
    card: number,
    line: number === null ? null : { n: [0, 1], d: 0.5 },
  };
  const picture = referencesCardPicture(drawn);
  if (!picture) throw new Error('fixture card too large');
  return { card: drawn, picture, way };
}

function pull(patch: Partial<ReferencesPull> = {}) {
  return pullFromReferences({
    cards: [card(1)],
    outline: LEFT_OUTLINE,
    mode: 'sequence',
    settings: { precreaseGrid: true, gridWhereNeeded: false, allowDanglingFolds: true, mergeSymmetricSteps: true },
    plan: 'plan-left',
    anchor: { kind: 'end' },
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
      i === index ? ([...line.slice(0, 4), line[4] === 'Red1' ? 'Blue2' : 'Red1'] as FixtureLine) : line
    )
  );

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(initialState, true);
  useDocument();
});

describe('pulling cards from References', () => {
  it('adds the card as a step, linked to its sheet as the Diagram finds it, with its plan and way, and says where', async () => {
    const outcome = await pull({ cards: [card(1, false, 'way-b')] });
    expect(outcome).toMatchObject({ status: 'pulled' });
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
        plan: 'plan-left',
        way: 'way-b',
        // The region as the segmentation has it, not the planner's outline.
        region: { segmentIdHint: left!.id, bounds: left!.bounds },
      },
    });
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Add step from References');
    expect(toasts.success).toHaveBeenCalledWith('Added as step 1');
    expect(analytics.trackDiagramStepsPulledFromReferences).toHaveBeenCalledWith('sequence', 'end', 1);
    expect(analytics.trackDiagramStepAdded).toHaveBeenCalledWith('references', 'references');
  });

  it('keeps no plan or way for a Find answer', async () => {
    await pull({ mode: 'find', settings: null, plan: null });
    expect(steps()[0]?.source).toMatchObject({ mode: 'find', settings: null });
    expect(steps()[0]?.source).not.toHaveProperty('plan');
    expect(steps()[0]?.source).not.toHaveProperty('way');
  });

  // The plan's browser check: editing another sheet is no change to this one.
  it('reads its sheet changed when its own creases change, and only then', async () => {
    await pull();
    const source = steps()[0]!.source!;
    if (source.kind !== 'references-step') throw new Error('pulled');
    expect(linkStatus(source, cpDocument(), segmentation)).toBe('current');
    expect(linkStatus(source, flipped(8), segmentation)).toBe('current');
    expect(linkStatus(source, flipped(7), segmentation)).toBe('stale');
    expect(linkStatus(source, cpDocument(), twoSquaresSegmentation({ wall: false }))).toBe('missing');
  });

  it('still adds a card whose sheet matches no region, which says its pattern cannot be found', async () => {
    await pull({ outline: [[0, 0], [300, 0], [300, 300], [0, 300]] });
    const source = steps()[0]!.source!;
    if (source.kind !== 'references-step') throw new Error('pulled');
    expect(source).toMatchObject({ fingerprint: null, region: { segmentIdHint: null } });
    expect(source.thumbnail.strokes).toHaveLength(4);
    expect(linkStatus(source, cpDocument(), segmentation)).toBe('missing');
    // Nor does it say it changed if a region comes to match it: it kept no creases to compare.
    const matched = { ...source, region: { ...source.region, boundary: [LEFT_OUTLINE.map(([x, y]) => ({ x, y }))] } };
    expect(linkStatus(matched, cpDocument(), segmentation)).toBe('unknown');
  });

  it('adds nothing while the pattern’s regions cannot be worked out, and says to try again', async () => {
    vi.mocked(ensureCpSegmentationArtifacts).mockResolvedValueOnce(null);
    expect(await pull()).toEqual({ status: 'unknown' });
    expect(steps()).toEqual([]);
    expect(toasts.error).toHaveBeenCalledWith('The crease pattern isn’t ready yet. Try again in a moment.');
  });

  it('adds a range as consecutive steps, one undo step, after the step it was opened for', async () => {
    const first = state().addDiagramStep()!;
    state().addDiagramStep();
    const before = state().diagramHistory.past.length;
    state().openDiagramReferencesBrowser({ kind: 'after', stepId: first });
    const outcome = await pull({ cards: [card(1), card(null, true), card(2, true)], anchor: { kind: 'after', stepId: first } });
    if (outcome.status !== 'pulled') throw new Error('pulled');
    expect(steps().map((step) => step.id)).toEqual([first, ...outcome.stepIds, expect.any(String)]);
    expect(steps()[2]).toMatchObject({
      text: 'Turn the paper over.',
      source: { card: null, side: 'back' },
      picture: { mirrored: true },
    });
    expect(state().diagramHistory.past).toHaveLength(before + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Add steps from References');
    // The last is selected, and the browser has closed on the steps.
    expect(state().diagramSelectedStepId).toBe(outcome.stepIds[2]);
    expect(state().diagramReferencesBrowser).toBeNull();
    expect(toasts.success).toHaveBeenCalledWith('Added as steps 2–4');
  });

  it('fills the empty step it was opened for, counting only the new steps as added', async () => {
    state().addDiagramStep();
    const empty = state().addDiagramStep()!;
    const outcome = await pull({ cards: [card(1), card(2)], anchor: { kind: 'fill', stepId: empty } });
    if (outcome.status !== 'pulled') throw new Error('pulled');
    expect(outcome.stepIds[0]).toBe(empty);
    expect(steps()[1]).toMatchObject({ id: empty, source: { card: 1 } });
    expect(steps()).toHaveLength(3);
    expect(toasts.success).toHaveBeenCalledWith('Added as steps 2–3');
    expect(analytics.trackDiagramStepAdded).toHaveBeenCalledTimes(1);
    expect(analytics.trackDiagramStepsPulledFromReferences).toHaveBeenCalledWith('sequence', 'fill', 2);
  });

  it('counts and names where the cards went: after a step that could no longer be filled, or at the end once it is gone', async () => {
    const pictured = state().addDiagramStep()!;
    await pull({ anchor: { kind: 'fill', stepId: pictured } });
    // Filled now: a second fill of it puts the card after it.
    const outcome = await pull({ cards: [card(2)], anchor: { kind: 'fill', stepId: pictured } });
    expect(outcome).toMatchObject({ status: 'pulled', into: 'after' });
    expect(analytics.trackDiagramStepsPulledFromReferences).toHaveBeenLastCalledWith('sequence', 'after', 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Add step from References');
    expect(toasts.success).toHaveBeenLastCalledWith('Added as step 2');
    // An anchor step that is gone: at the end.
    expect(await pull({ anchor: { kind: 'after', stepId: 'step-gone' } })).toMatchObject({ into: 'end' });
  });

  it('says the step it filled or replaced, when that is all it did', async () => {
    const empty = state().addDiagramStep()!;
    await pull({ anchor: { kind: 'fill', stepId: empty } });
    expect(toasts.success).toHaveBeenLastCalledWith('Filled step 1');
    // The filled step recorded Card 1's sentence, and its words are still that.
    expect(steps()[0]?.source).toMatchObject({ sentence: 'Fold 1.' });
    await pull({ cards: [card(3)], anchor: { kind: 'replace', stepId: empty } });
    expect(toasts.success).toHaveBeenLastCalledWith('Replaced step 1’s card');
    expect(steps()).toHaveLength(1);
    expect(steps()[0]).toMatchObject({ text: 'Fold 3.', source: { card: 3 } });
    expect(analytics.trackDiagramStepAdded).not.toHaveBeenCalled();
  });

  it('adds nothing to a read-only diagram, or with no pattern open, and says why', async () => {
    useWorkspaceStore.setState({ diagramReadOnly: true });
    expect(await pull()).toEqual({ status: 'read-only' });
    expect(toasts.error).toHaveBeenLastCalledWith(expect.stringContaining('read-only'));
    useWorkspaceStore.setState({ diagramReadOnly: false, oristudioCpDocument: null });
    expect(await pull()).toEqual({ status: 'no-pattern' });
    expect(steps()).toEqual([]);
  });

  it('gives a card past what the file reads back no picture, so the browser cannot add it', () => {
    const line = { kind: 'line' as const, from: [0, 0] as const, to: [1, 1] as const, style: 'crease' as const };
    const primitives = Array.from({ length: STEP_DIAGRAM_MAX_PRIMITIVES + 1 }, () => line);
    expect(referencesCardPicture({ ...card(1).card, model: { ...SENT_MODEL, primitives } })).toBeNull();
  });

  it('drops a pull that outlived its diagram', async () => {
    const pending = pull();
    // A project opened while the sheet was being found.
    useWorkspaceStore.setState({ diagramLoadId: state().diagramLoadId + 1 });
    expect(await pending).toEqual({ status: 'discarded' });
    expect(steps()).toEqual([]);
  });
});
