import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureCpSegmentationArtifacts } from '../../cp-workspace/cpSegmentationArtifacts';
import type { ReferencesDiagramCard } from '../../cp-workspace/references/referencesDiagramCards';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cpDocument, TWO_SQUARES, twoSquaresSegmentation, type FixtureLine } from '../capture/capture.fixtures';
import { linkStatus } from '../capture/linkStatus';
import { SENT_MODEL } from '../document/diagramSteps.fixtures';
import { stepsOf, type KnownDiagramAnnotation } from '../document/diagramDocument';
import { MAX_STEP_ANNOTATIONS } from '../annotate/annotationModel';
import { STEP_DIAGRAM_MAX_PRIMITIVES } from '../document/stepDiagramModelFile';
import { chooseReferencesWay, pullFromReferences, referencesCardPicture, type PulledCard, type ReferencesPull } from './referencesPulledSteps';

vi.mock('../../cp-workspace/cpSegmentationArtifacts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/cpSegmentationArtifacts')>()),
  ensureCpSegmentationArtifacts: vi.fn(async () => segmentation),
}));
const analytics = vi.hoisted(() => ({
  trackDiagramStepAdded: vi.fn(),
  trackDiagramStepsPulledFromReferences: vi.fn(),
  trackDiagramTurnAdded: vi.fn(),
  trackDiagramImportedMarkEdited: vi.fn(),
}));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

/** What a pull with every mark shown, lifted, reports (17d). */
const SHOWN_LIFTED = { letters: 'shown', reference_lines: 'shown', marks: 'lifted' };

const segmentation = twoSquaresSegmentation();
const [left] = resolveCpSegments(segmentation);
const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();
// The steps alone: a turn-over card is pulled as a turn between them (D22).
const steps = () => (state().diagram ? stepsOf(state().diagram!) : []);

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
    expect(outcome).toMatchObject({ status: 'pulled', baked: [], replaced: 0 });
    const [step] = steps();
    const baked = card(1).picture;
    expect(step).toMatchObject({
      text: 'Fold 1.',
      // The card's paper as its picture, its marks lifted (17d), every one shown.
      picture: { kind: 'step-diagram', model: { sheet: SENT_MODEL.sheet, primitives: [SENT_MODEL.primitives[0]] }, mirrored: false, key: `${baked.key}-marks` },
      annotatedPictureKey: `${baked.key}-marks`,
      source: {
        kind: 'references-step',
        mode: 'sequence',
        card: 1,
        line: { n: [0, 1], d: 0.5 },
        side: 'front',
        settings: { gridWhereNeeded: false },
        plan: 'plan-left',
        way: 'way-b',
        marks: { letters: true, highlights: true },
        // The region as the segmentation has it, not the planner's outline.
        region: { segmentIdHint: left!.id, bounds: left!.bounds },
      },
    });
    expect(step!.annotations.map((mark) => ('kind' in mark ? [mark.kind, mark.imported] : null))).toEqual([
      ['valley-line', 'untouched'],
      ['fold-unfold-arrow', 'untouched'],
      ['label', 'untouched'],
    ]);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Add step from References');
    expect(toasts.success).toHaveBeenCalledWith('Added as step 1');
    expect(toasts.message).not.toHaveBeenCalled();
    expect(analytics.trackDiagramStepsPulledFromReferences).toHaveBeenCalledWith('sequence', 'end', 1, SHOWN_LIFTED);
    expect(analytics.trackDiagramStepAdded).toHaveBeenCalledWith('references', 'references');
  });

  it('pulls only the marks the Show menu shows, records the choice, and counts it', async () => {
    await pull({ marks: { letters: false, highlights: true } });
    const [step] = steps();
    expect(step!.source).toMatchObject({ marks: { letters: false, highlights: true } });
    expect(step!.annotations.map((mark) => ('kind' in mark ? mark.kind : null))).toEqual(['valley-line', 'fold-unfold-arrow']);
    expect(analytics.trackDiagramStepsPulledFromReferences).toHaveBeenCalledWith('sequence', 'end', 1, {
      letters: 'hidden',
      reference_lines: 'shown',
      marks: 'lifted',
    });
  });

  it('pulls a card whose marks are more than a step holds whole, and says so', async () => {
    const crowded: ReferencesDiagramCard = {
      ...card(1).card,
      model: {
        ...SENT_MODEL,
        primitives: [
          SENT_MODEL.primitives[0]!,
          ...Array.from({ length: MAX_STEP_ANNOTATIONS + 1 }, (_, i) => ({
            kind: 'line' as const,
            from: [i / 1000, 0] as const,
            to: [i / 1000, 1] as const,
            style: 'valley' as const,
          })),
        ],
      },
    };
    const picture = referencesCardPicture(crowded)!;
    const outcome = await pull({ cards: [{ card: crowded, picture, way: null }] });
    if (outcome.status !== 'pulled') throw new Error('pulled');
    expect(outcome.baked).toEqual(outcome.stepIds);
    expect(steps()[0]).toMatchObject({ picture, annotations: [] });
    expect(toasts.message).toHaveBeenCalledWith('Step 1’s marks stay part of its picture: there are more than a step holds.');
    expect(analytics.trackDiagramStepsPulledFromReferences).toHaveBeenCalledWith('sequence', 'end', 1, { ...SHOWN_LIFTED, marks: 'baked' });
  });

  it('replaces a card’s marks, edited too, keeping the author’s, and offers the edited ones back', async () => {
    const empty = state().addDiagramStep()!;
    await pull({ anchor: { kind: 'fill', stepId: empty } });
    // The pulled fold nudged, and a mark of the author's drawn.
    state().editDiagramAnnotations(empty, 'Move annotation', (marks) => [
      ...marks.map((mark) => (mark.kind === 'valley-line' ? { ...mark, from: [0, 0.55] as [number, number] } : mark)),
      { id: 'annotation-mine', kind: 'circle', from: [0.3, 0.3], to: [0.3, 0.3] },
    ]);
    expect(analytics.trackDiagramImportedMarkEdited).toHaveBeenCalledWith('valley_line', 'changed');
    const before = state().diagramHistory.past.length;
    toasts.success.mockClear();
    await pull({ cards: [card(3)], anchor: { kind: 'replace', stepId: empty } });
    const [step] = steps();
    expect(step!.annotations.map((mark) => ('kind' in mark ? [mark.kind, mark.imported] : null))).toEqual([
      ['valley-line', 'untouched'],
      ['fold-unfold-arrow', 'untouched'],
      ['label', 'untouched'],
      ['circle', undefined],
    ]);
    // One undo step, and one toast that says so and offers it: once undone, no toast still says the card was replaced.
    expect(state().diagramHistory.past).toHaveLength(before + 1);
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(toasts.success).toHaveBeenCalledWith('Replaced step 1’s card', {
      description: 'Replaced a mark you had edited',
      action: { label: 'Undo', onClick: expect.any(Function) },
    });
    expect(toasts.message).not.toHaveBeenCalled();
    const [, { action }] = toasts.success.mock.calls.at(-1)! as [string, { action: { onClick: () => void } }];
    action.onClick();
    expect(steps()[0]!.annotations.find((mark) => 'kind' in mark && mark.kind === 'valley-line')).toMatchObject({ imported: 'edited' });
    // Only while the pull is still the newest edit.
    expect(state().diagramHistory.past).toHaveLength(before);
    action.onClick();
    expect(state().diagramHistory.past).toHaveLength(before);
  });

  describe('another way chosen', () => {
    /** A way of the pulled card: its card drawn another way, `model`. */
    const way = (model = SENT_MODEL, signature = 'way-2') => {
      const picture = referencesCardPicture({ ...card(1).card, model })!;
      return { signature, picture, sentence: 'Fold 1 another way.' };
    };
    /** A card with more marks than a step holds. */
    const crowdedModel = () => ({
      ...SENT_MODEL,
      primitives: [
        SENT_MODEL.primitives[0]!,
        ...Array.from({ length: MAX_STEP_ANNOTATIONS + 1 }, (_, i) => ({
          kind: 'line' as const,
          from: [i / 1000, 0] as const,
          to: [i / 1000, 1] as const,
          style: 'valley' as const,
        })),
      ],
    });
    const otherModel = () => ({ ...SENT_MODEL, primitives: [...SENT_MODEL.primitives, { kind: 'point' as const, at: [1, 1] as const, style: 'normal' as const }] });

    it('swaps the card’s marks, and offers back the edited ones it took', async () => {
      await pull({ cards: [card(1, false, 'way-1')] });
      const [step] = steps();
      state().editDiagramAnnotations(step!.id, 'Move annotation', (marks) =>
        marks.map((mark) => (mark.kind === 'valley-line' ? { ...mark, from: [0, 0.55] as [number, number] } : mark))
      );
      vi.clearAllMocks();
      expect(chooseReferencesWay(step!.id, way(otherModel()))).toBe(true);
      expect(steps()[0]!.annotations.every((mark) => 'kind' in mark && mark.imported === 'untouched')).toBe(true);
      expect(toasts.message).toHaveBeenCalledTimes(1);
      expect(toasts.message).toHaveBeenCalledWith('Replaced a mark you had edited', {
        action: { label: 'Undo', onClick: expect.any(Function) },
      });
    });

    // 17d review: past the cap the way was pulled whole, and nothing said so.
    it('says so when the way’s card keeps its marks in its picture, too many for a step', async () => {
      await pull({ cards: [card(1, false, 'way-1')] });
      const [step] = steps();
      const crowded = way(crowdedModel());
      expect(chooseReferencesWay(step!.id, crowded)).toBe(true);
      expect(steps()[0]!.picture).toEqual(crowded.picture);
      expect(toasts.message).toHaveBeenCalledWith('Step 1’s marks stay part of its picture: there are more than a step holds.');
    });

    it('says so when the way’s marks would not fit beside the author’s', async () => {
      await pull({ cards: [card(1, false, 'way-1')] });
      const [step] = steps();
      state().editDiagramAnnotations(step!.id, 'Add annotations', (marks) => [
        ...marks,
        ...Array.from({ length: MAX_STEP_ANNOTATIONS - marks.length }, (_, i) => ({
          id: `annotation-mine-${i}`,
          kind: 'circle' as const,
          from: [0.3, 0.3] as [number, number],
          to: [0.3, 0.3] as [number, number],
        })),
      ]);
      vi.clearAllMocks();
      const other = way(otherModel());
      expect(chooseReferencesWay(step!.id, other)).toBe(true);
      expect(steps()[0]!.picture).toEqual(other.picture);
      expect(toasts.message).toHaveBeenCalledWith('Step 1’s marks stay part of its picture: there are more than a step holds.');
    });
  });

  it('pulls a card after an enlarged step into the window the step starts enlarged with, its lines cut at the frame', async () => {
    await pull();
    const [first] = steps();
    // The step before is enlarged: a card pulled after it starts so (16g), its marks put in the window's units.
    const zoom = { from: 'area-x', shape: 'circle' as const, frame: { centre: [0.5, 0.5] as [number, number], radius: 0.2 } };
    useWorkspaceStore.setState({
      diagram: { ...state().diagram!, steps: state().diagram!.steps.map((entry) => (entry.id === first!.id ? { ...entry, zoom } : entry)) },
    });
    await pull({ cards: [card(2)] });
    const [, second] = steps();
    expect(second!.zoom?.frame).toEqual(zoom.frame);
    expect(second!.annotatedPictureKey).toBe(second!.picture!.key);
    const fold = second!.annotations.find((mark) => 'kind' in mark && mark.kind === 'valley-line') as KnownDiagramAnnotation;
    // The fold across the sheet's middle, in the window's units (its box 0.3 to 0.7), cut just past the frame's rim.
    expect(fold.from[1]).toBeCloseTo(0.5, 9);
    expect(fold.from[0]).toBeGreaterThan(-0.2);
    expect(fold.from[0]).toBeLessThan(0);
    expect(fold.to[0]).toBeGreaterThan(1);
    expect(fold.to[0]).toBeLessThan(1.2);
    // 17d review: the card's arrow and its letter lie outside the frame, which cut them from its picture: not pulled.
    expect(second!.annotations.map((mark) => ('kind' in mark ? mark.kind : null))).toEqual(['valley-line']);
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

  it('adds a range as consecutive steps, its turn-over a turn between them, one undo step, after the step it was opened for', async () => {
    const first = state().addDiagramStep()!;
    state().addDiagramStep();
    const before = state().diagramHistory.past.length;
    state().openDiagramReferencesBrowser({ kind: 'after', stepId: first });
    const outcome = await pull({ cards: [card(1), card(null, true), card(2, true)], anchor: { kind: 'after', stepId: first } });
    if (outcome.status !== 'pulled') throw new Error('pulled');
    // The turn-over card is a turn between the two (D22): no step, no number.
    const entries = state().diagram!.steps;
    expect(entries.map((entry) => entry.id)).toEqual([
      first,
      outcome.stepIds[0],
      outcome.turnIds[0],
      outcome.stepIds[1],
      expect.any(String),
    ]);
    expect(entries[2]).toEqual({ id: outcome.turnIds[0], kind: 'turn-over', axis: 'vertical' });
    expect(steps()[2]).toMatchObject({ text: 'Fold 2.', picture: { mirrored: true } });
    expect(state().diagramHistory.past).toHaveLength(before + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Add steps from References');
    // The last step is selected, and the browser has closed on the steps.
    expect(state().diagramSelectedStepId).toBe(outcome.stepIds[1]);
    expect(state().diagramReferencesBrowser).toBeNull();
    // Numbered without the turn: steps 2 and 3.
    expect(toasts.success).toHaveBeenCalledWith('Added as steps 2–3');
    expect(analytics.trackDiagramTurnAdded).toHaveBeenCalledWith('turn-over', 'references');
  });

  it('adds a turn-over pulled on its own as a turn, before the empty step it was opened for', async () => {
    state().addDiagramStep();
    const empty = state().addDiagramStep()!;
    const outcome = await pull({ cards: [card(null)], anchor: { kind: 'fill', stepId: empty } });
    if (outcome.status !== 'pulled') throw new Error('pulled');
    expect(outcome.stepIds).toEqual([]);
    const entries = state().diagram!.steps;
    expect(entries.map((entry) => entry.id)).toEqual([expect.any(String), outcome.turnIds[0], empty]);
    expect(toasts.success).toHaveBeenCalledWith('Added a turn-over');
  });

  it('never fills or replaces with a turn-over: the one before the card goes before the step it fills', async () => {
    const empty = state().addDiagramStep()!;
    const outcome = await pull({ cards: [card(null), card(1)], anchor: { kind: 'fill', stepId: empty } });
    if (outcome.status !== 'pulled') throw new Error('pulled');
    expect(outcome.into).toBe('fill');
    expect(state().diagram!.steps.map((entry) => entry.id)).toEqual([outcome.turnIds[0], empty]);
    expect(steps()[0]).toMatchObject({ id: empty, text: 'Fold 1.' });
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
    expect(analytics.trackDiagramStepsPulledFromReferences).toHaveBeenCalledWith('sequence', 'fill', 2, SHOWN_LIFTED);
  });

  it('counts and names where the cards went: after a step that could no longer be filled, or at the end once it is gone', async () => {
    const pictured = state().addDiagramStep()!;
    await pull({ anchor: { kind: 'fill', stepId: pictured } });
    // Filled now: a second fill of it puts the card after it.
    const outcome = await pull({ cards: [card(2)], anchor: { kind: 'fill', stepId: pictured } });
    expect(outcome).toMatchObject({ status: 'pulled', into: 'after' });
    expect(analytics.trackDiagramStepsPulledFromReferences).toHaveBeenLastCalledWith('sequence', 'after', 1, SHOWN_LIFTED);
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
