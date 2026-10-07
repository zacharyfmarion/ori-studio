/**
 * The marks a pulled step's References card brought (17d, §6 and §8 of
 * `implementation-plans/diagram-references-annotations.md`): tagged at the
 * lift, kept by carries and Duplicate, `edited` once the author changes one,
 * released when the picture stops being the card, never out of step, and
 * swapped whole — edited ones too — by Replace and another way.
 */
import { describe, expect, it } from 'vitest';
import type { StepDiagramModel } from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import { MAX_STEP_ANNOTATIONS } from '../annotate/annotationModel';
import { liftedCardPicture } from '../references/referencesCardMarks';
import { framedCard, pointsCard } from '../references/referencesCardMarks.fixtures';
import { authorMarksOf, cardMarkEdits, editedCardMarksGone, isCardMark, releaseCardMarks } from './cardMarks';
import {
  annotationsOutOfStep,
  createDiagram,
  createStep,
  DEFAULT_DIAGRAM_STYLE,
  duplicateStep,
  editStepAnnotations,
  insertSteps,
  liftedStepDiagramKey,
  pullReferencesSteps,
  removeStepPicture,
  setReferencesSide,
  setReferencesWay,
  setStepPicture,
  stepById,
  stepDiagramCardKey,
  type DiagramDocument,
  type DiagramIdFactory,
  type DiagramStep,
  type DiagramStepDiagramPicture,
  type KnownDiagramAnnotation,
  type LiftedCard,
  type SentReferencesStep,
} from './diagramDocument';
import { referencesSource, stepsIn } from './diagramSteps.fixtures';

function sequentialIds(prefix = ''): DiagramIdFactory {
  let next = 0;
  return (kind) => `${kind}-${prefix}${++next}`;
}

/** A card: its fold, its reference line, its ring and letter, its arrow. */
const CARD: StepDiagramModel = {
  sheet: { width: 1, height: 1, centre: [0.5, 0.5] },
  primitives: [
    { kind: 'sheet', width: 1, height: 1 },
    { kind: 'line', from: [0, 0.25], to: [1, 0.25], style: 'crease' },
    { kind: 'line', from: [0, 0.5], to: [1, 0.5], style: 'valley' },
    { kind: 'line', from: [0, 0], to: [1, 0], style: 'highlight' },
    { kind: 'point', at: [0, 1], style: 'highlight' },
    { kind: 'fold-arrow', out: { center: [0.5, 0.5], radius: 0.5, from: Math.PI / 2 + 0.6, to: Math.PI / 2 - 0.4, ccw: false } },
    { kind: 'label', at: [0, 1], text: 'P', style: 'highlight' },
  ],
};

const baked = (key = 'steps-a', mirrored = false, model = CARD): DiagramStepDiagramPicture => ({
  kind: 'step-diagram',
  model,
  mirrored,
  key: mirrored ? `${key}-back` : key,
});
const lifted = (key = 'steps-a', mirrored = false, model = CARD, prefix = key): LiftedCard =>
  liftedCardPicture(baked(key, mirrored, model), { letters: true, highlights: true }, DEFAULT_DIAGRAM_STYLE, sequentialIds(prefix))!;
const sent = (key = 'steps-a', model = CARD): SentReferencesStep => ({
  source: referencesSource({ way: 'way-1', sentence: 'Fold it.', marks: { letters: true, highlights: true } }),
  picture: baked(key, false, model),
  lifted: lifted(key, false, model),
  text: 'Fold it.',
});

function diagram(...steps: DiagramStep[]): DiagramDocument {
  return insertSteps(createDiagram({ title: 'T', newId: sequentialIds('d') }), steps, 0);
}

/** A step pulled from `CARD`, lifted, by `pullReferencesSteps` itself. */
function pulled(): { document: DiagramDocument; stepId: string } {
  const result = pullReferencesSteps(diagram(), [sent()], { kind: 'end' }, { newId: sequentialIds('s') });
  return { document: result.document, stepId: result.stepIds[0]! };
}

const stepOf = (document: DiagramDocument, stepId: string) => stepById(document, stepId)!;
const known = (step: DiagramStep) => step.annotations as KnownDiagramAnnotation[];
const circle = (id: string): KnownDiagramAnnotation => ({ id, kind: 'circle', from: [0.3, 0.3], to: [0.3, 0.3] });

describe('a pulled step', () => {
  it('shows its card’s paper, its marks lifted, tagged and in step', () => {
    const { document, stepId } = pulled();
    const step = stepOf(document, stepId);
    expect(step.picture).toMatchObject({ kind: 'step-diagram', key: 'steps-a-marks' });
    expect(step.annotatedPictureKey).toBe('steps-a-marks');
    expect(known(step).map((mark) => mark.kind)).toEqual(['valley-line', 'solid-line', 'circle', 'fold-unfold-arrow', 'label']);
    expect(known(step).every((mark) => isCardMark(step, mark) && mark.imported === 'untouched')).toBe(true);
    expect(authorMarksOf(step)).toEqual([]);
    expect(stepDiagramCardKey(step.picture!.key)).toBe('steps-a');
  });

  it('is pulled whole, and said so, when its marks are more than a step holds', () => {
    const result = pullReferencesSteps(diagram(), [{ ...sent(), lifted: null }], { kind: 'end' });
    const step = stepsIn(result.document)[0]!;
    expect(result.baked).toEqual([step.id]);
    expect(step.picture).toEqual(baked());
    expect(step.annotations).toEqual([]);
    // Sent as before marks were lifted: baked, and nothing to say.
    const before = pullReferencesSteps(diagram(), [{ ...sent(), lifted: undefined }], { kind: 'end' });
    expect(before.baked).toEqual([]);
  });

  it('keys a card’s pictures apart, and the card the same, whichever side and however its marks are kept', () => {
    expect(liftedStepDiagramKey('steps-a', false)).toBe('steps-a-marks');
    expect(liftedStepDiagramKey('steps-a-back', true)).toBe('steps-a-marks-back');
    expect(liftedStepDiagramKey('steps-a-marks-back', false)).toBe('steps-a-marks');
    for (const key of ['steps-a', 'steps-a-back', 'steps-a-marks', 'steps-a-marks-back']) expect(stepDiagramCardKey(key)).toBe('steps-a');
  });
});

describe('the tag', () => {
  it('stays untouched through an unrelated edit, and goes to edited on the mark changed', () => {
    const { document, stepId } = pulled();
    const before = stepOf(document, stepId);
    const added = editStepAnnotations(document, stepId, (marks) => [...marks, circle('annotation-mine')]);
    const step = stepOf(added, stepId);
    expect(known(step).filter((mark) => mark.imported === 'untouched')).toHaveLength(5);
    expect(known(step).at(-1)).toEqual(circle('annotation-mine'));
    expect(cardMarkEdits(before, step)).toEqual([]);
    // One moved: that one is the author's change now.
    const moved = editStepAnnotations(added, stepId, (marks) =>
      marks.map((mark) => (mark.kind === 'valley-line' ? { ...mark, from: [0, 0.55], to: [1, 0.55] } : mark))
    );
    const after = stepOf(moved, stepId);
    expect(known(after).map((mark) => mark.imported)).toEqual(['edited', 'untouched', 'untouched', 'untouched', 'untouched', undefined]);
    expect(cardMarkEdits(step, after)).toEqual([expect.objectContaining({ kind: 'valley-line', edit: 'changed' })]);
    // Edited stays edited, and is not counted again.
    const again = stepOf(editStepAnnotations(moved, stepId, (marks) => marks.map((mark) => (mark.kind === 'valley-line' ? { ...mark, to: [1, 0.6] } : mark))), stepId);
    expect(known(again)[0]?.imported).toBe('edited');
    expect(cardMarkEdits(after, again)).toEqual([]);
  });

  it('never counts the cleaning of an unrelated edit as an edit', () => {
    const { document, stepId } = pulled();
    // A mark a file gave past what this build writes: an arrow bent past half a circle.
    const loose = editStepAnnotations(document, stepId, (marks) => marks);
    expect(loose).toBe(document);
    const bent = {
      ...document,
      steps: document.steps.map((entry) =>
        entry.id === stepId
          ? { ...(entry as DiagramStep), annotations: known(entry as DiagramStep).map((mark) => (mark.kind === 'fold-unfold-arrow' ? { ...mark, bend: 0.9 } : mark)) }
          : entry
      ),
    };
    const edited = stepOf(editStepAnnotations(bent, stepId, (marks) => [...marks, circle('annotation-mine')]), stepId);
    const arrow = known(edited).find((mark) => mark.kind === 'fold-unfold-arrow')!;
    expect(arrow.bend).toBe(0.5);
    expect(arrow.imported).toBe('untouched');
  });

  it('counts a mark taken away, edited or not', () => {
    const { document, stepId } = pulled();
    const before = stepOf(document, stepId);
    const after = stepOf(editStepAnnotations(document, stepId, (marks) => marks.filter((mark) => mark.kind !== 'label')), stepId);
    expect(cardMarkEdits(before, after)).toEqual([expect.objectContaining({ kind: 'label', edit: 'deleted' })]);
  });

  it('is kept by Duplicate Step: the copy shows the same card', () => {
    const { document, stepId } = pulled();
    const copy = duplicateStep(document, stepId, sequentialIds('c'))!;
    const step = stepOf(copy.document, copy.stepId);
    expect(known(step).every((mark) => mark.imported === 'untouched')).toBe(true);
    expect(new Set(known(step).map((mark) => mark.id))).not.toEqual(new Set(known(stepOf(document, stepId)).map((mark) => mark.id)));
  });

  it('is dropped when the picture stops being the card, the marks the author’s under the notice', () => {
    const { document, stepId } = pulled();
    for (const changed of [
      removeStepPicture(document, stepId),
      setStepPicture(document, stepId, { id: 'asset-1', kind: 'raster', src: 'data:image/png;base64,', widthPx: 10, heightPx: 10, bytes: 1 }),
    ]) {
      const step = stepOf(changed, stepId);
      expect(step.annotations).toHaveLength(5);
      expect(known(step).some((mark) => mark.imported !== undefined)).toBe(false);
      expect(authorMarksOf(step)).toHaveLength(5);
    }
    expect(annotationsOutOfStep(stepOf(setStepPicture(document, stepId, { id: 'asset-1', kind: 'raster', src: 'data:image/png;base64,', widthPx: 10, heightPx: 10, bytes: 1 }), stepId))).toBe(true);
    // A tag on a step that shows no card is not read.
    const read = { ...stepOf(document, stepId), source: null, picture: null };
    expect(isCardMark(read, read.annotations[0]!)).toBe(false);
    const released = stepOf(removeStepPicture(document, stepId), stepId);
    expect(releaseCardMarks(released)).toBe(released);
  });
});

describe('marks a card brought are never out of step', () => {
  it('leaves the notice to the author’s marks', () => {
    const { document, stepId } = pulled();
    const step = stepOf(document, stepId);
    expect(annotationsOutOfStep({ ...step, annotatedPictureKey: 'another' })).toBe(false);
    const mine = { ...step, annotations: [...step.annotations, circle('annotation-mine')], annotatedPictureKey: 'another' };
    expect(annotationsOutOfStep(mine)).toBe(true);
  });

  // 17d review: "Your own marks stay, with the notice" (RM6) — touching only the card's marks is not looking at your own.
  it('keeps the notice on the author’s marks through an edit of the card’s alone, and clears it when one of theirs is touched', () => {
    const { document, stepId } = pulled();
    const drawn = editStepAnnotations(document, stepId, (marks) => [...marks, circle('annotation-mine')]);
    const replaced = pullReferencesSteps(drawn, [sent('steps-b')], { kind: 'replace', stepId }).document;
    expect(annotationsOutOfStep(stepOf(replaced, stepId))).toBe(true);
    // A card mark nudged, another taken away, one pasted back: the author's still out of step.
    const nudged = editStepAnnotations(replaced, stepId, (marks) =>
      marks.map((mark) => (mark.kind === 'valley-line' ? { ...mark, from: [0, 0.55] as [number, number] } : mark))
    );
    const removed = editStepAnnotations(nudged, stepId, (marks) => marks.filter((mark) => mark.kind !== 'label'));
    const label = known(stepOf(replaced, stepId)).find((mark) => mark.kind === 'label')!;
    const pasted = editStepAnnotations(removed, stepId, (marks) => [...marks, { ...label, id: 'annotation-again' }]);
    for (const edited of [nudged, removed, pasted]) {
      expect(stepOf(edited, stepId).annotatedPictureKey).toBe('steps-a-marks');
      expect(annotationsOutOfStep(stepOf(edited, stepId))).toBe(true);
    }
    // One of the author's moved, or a mark of theirs added: they are in step with this picture now.
    const moved = editStepAnnotations(pasted, stepId, (marks) =>
      marks.map((mark) => (mark.id === 'annotation-mine' ? { ...mark, from: [0.4, 0.4] as [number, number], to: [0.4, 0.4] as [number, number] } : mark))
    );
    const added = editStepAnnotations(pasted, stepId, (marks) => [...marks, circle('annotation-mine-2')]);
    for (const touched of [moved, added]) expect(annotationsOutOfStep(stepOf(touched, stepId))).toBe(false);
  });

  it('turns over with the card, every fold renamed, though the author’s marks are out of step and stay', () => {
    const { document, stepId } = pulled();
    const mine = circle('annotation-mine');
    const outOfStep = {
      ...document,
      steps: document.steps.map((entry) =>
        entry.id === stepId ? { ...(entry as DiagramStep), annotations: [...(entry as DiagramStep).annotations, mine], annotatedPictureKey: 'another' } : entry
      ),
    };
    const turned = stepOf(setReferencesSide(outOfStep, stepId, true), stepId);
    const card = known(turned).filter((mark) => mark.imported !== undefined);
    // The card's fold, seen from the back, is a mountain, and its marks are mirrored.
    expect(card[0]).toMatchObject({ kind: 'mountain-line', imported: 'untouched' });
    expect(card[2]!.from[0]).toBeCloseTo(1, 9);
    // The author's stay where they were, still out of step.
    expect(known(turned).at(-1)).toEqual(mine);
    expect(turned.annotatedPictureKey).toBe('another');
    expect(annotationsOutOfStep(turned)).toBe(true);
    // A pull turned over is the card pulled from the back.
    const back = pullReferencesSteps(diagram(), [{ ...sent(), picture: baked('steps-a', true), lifted: lifted('steps-a', true) }], { kind: 'end' });
    const fromBack = known(stepsIn(back.document)[0]!);
    const turnedFront = known(stepOf(setReferencesSide(document, stepId, true), stepId));
    expect(turnedFront.map((mark) => mark.kind)).toEqual(fromBack.map((mark) => mark.kind));
    turnedFront.forEach((mark, index) => {
      expect(mark.from[0]).toBeCloseTo(fromBack[index]!.from[0], 9);
      expect(mark.from[1]).toBeCloseTo(fromBack[index]!.from[1], 9);
    });
  });
});

describe('marks a card brought on an enlarged step', () => {
  it('turn over with the card in the window’s units, though the author’s are out of step and stay', () => {
    const { document, stepId } = pulled();
    // A frame round the whole sheet: every one of the card's marks lies in it.
    const zoom = { from: 'area-1', shape: 'circle' as const, frame: { centre: [0.5, 0.5] as [number, number], radius: 0.75 } };
    const mine = circle('annotation-mine');
    const enlarged = {
      ...document,
      steps: document.steps.map((entry) => (entry.id === stepId ? { ...(entry as DiagramStep), zoom, annotations: [] } : entry)),
    };
    // The card into the window, then a mark of the author's drawn on another picture.
    const replaced = pullReferencesSteps(enlarged, [sent('steps-b')], { kind: 'replace', stepId }).document;
    const withMine = {
      ...replaced,
      steps: replaced.steps.map((entry) =>
        entry.id === stepId ? { ...(entry as DiagramStep), annotations: [...(entry as DiagramStep).annotations, mine], annotatedPictureKey: 'another' } : entry
      ),
    };
    const before = stepOf(withMine, stepId);
    const turned = stepOf(setReferencesSide(withMine, stepId, true), stepId);
    const card = known(turned).filter((mark) => mark.imported !== undefined);
    expect(card.map((mark) => mark.kind)).toEqual(['mountain-line', 'solid-line', 'circle', 'fold-unfold-arrow', 'label']);
    // The ring at the sheet's top-left corner, in a window -0.25 to 1.25: (1/6, 1/6); mirrored, at its top-right, (5/6, 1/6).
    const ring = (step: DiagramStep) => known(step).find((mark) => mark.kind === 'circle' && mark.imported !== undefined)!;
    expect(ring(before).from[0]).toBeCloseTo(1 / 6, 9);
    expect(ring(turned).from[0]).toBeCloseTo(5 / 6, 9);
    expect(ring(turned).from[1]).toBeCloseTo(1 / 6, 9);
    expect(known(turned).at(-1)).toEqual(mine);
    expect(turned.annotatedPictureKey).toBe('another');
  });
});

describe('Replace and another way (RM6)', () => {
  /** The pulled step with its fold edited and a mark of the author's. */
  function edited() {
    const { document, stepId } = pulled();
    const changed = editStepAnnotations(document, stepId, (marks) => [
      ...marks.map((mark) => (mark.kind === 'valley-line' ? { ...mark, from: [0, 0.55] as [number, number] } : mark)),
      circle('annotation-mine'),
    ]);
    return { document: changed, stepId };
  }

  it('swaps every mark the old card brought, edited too, for the new card’s, and keeps the author’s', () => {
    const { document, stepId } = edited();
    const before = stepOf(document, stepId);
    const result = pullReferencesSteps(document, [sent('steps-b')], { kind: 'replace', stepId });
    const step = stepOf(result.document, stepId);
    expect(step.picture?.key).toBe('steps-b-marks');
    expect(result.replaced).toBe(1);
    expect(editedCardMarksGone(before, step)).toBe(1);
    // The new card's first, then the author's own.
    expect(known(step).map((mark) => mark.id)).toEqual([
      'annotation-steps-b1',
      'annotation-steps-b2',
      'annotation-steps-b3',
      'annotation-steps-b4',
      'annotation-steps-b5',
      'annotation-mine',
    ]);
    // The author's were drawn on the old card's paper: the notice says so.
    expect(annotationsOutOfStep(step)).toBe(true);
    // The same card again brings its marks back, and the author's are still in step.
    const again = stepOf(pullReferencesSteps(document, [sent('steps-a')], { kind: 'replace', stepId }).document, stepId);
    expect(again.picture?.key).toBe('steps-a-marks');
    expect(annotationsOutOfStep(again)).toBe(false);
    expect(known(again).filter((mark) => mark.imported === 'edited')).toEqual([]);
  });

  it('in step with the new card when the step has no marks of the author’s', () => {
    const { document, stepId } = pulled();
    const step = stepOf(pullReferencesSteps(document, [sent('steps-b')], { kind: 'replace', stepId }).document, stepId);
    expect(step.annotatedPictureKey).toBe('steps-b-marks');
    expect(annotationsOutOfStep(step)).toBe(false);
  });

  it('pulls the new card whole when its marks and the author’s are more than a step holds', () => {
    const { document, stepId } = pulled();
    // Four of the card's left and the step full: the new card's five do not fit beside the author's.
    const crowded = editStepAnnotations(document, stepId, (marks) => {
      const card = marks.filter((mark) => mark.kind !== 'label');
      return [...card, ...Array.from({ length: MAX_STEP_ANNOTATIONS - card.length }, (_, i) => circle(`annotation-mine-${i}`))];
    });
    expect(stepOf(crowded, stepId).annotations).toHaveLength(MAX_STEP_ANNOTATIONS);
    const result = pullReferencesSteps(crowded, [sent('steps-b')], { kind: 'replace', stepId });
    const step = stepOf(result.document, stepId);
    expect(result.baked).toEqual([stepId]);
    expect(step.picture?.key).toBe('steps-b');
    expect(known(step).every((mark) => mark.imported === undefined)).toBe(true);
  });

  it('pulls a lifted card onto an old baked step, the author’s marks under the notice', () => {
    const old: DiagramStep = {
      ...createStep(() => 'step-old'),
      source: referencesSource({ way: 'way-1' }),
      picture: baked('steps-a'),
      annotations: [circle('annotation-mine')],
      annotatedPictureKey: 'steps-a',
    };
    const step = stepOf(pullReferencesSteps(diagram(old), [sent('steps-b')], { kind: 'replace', stepId: 'step-old' }).document, 'step-old');
    expect(step.picture?.key).toBe('steps-b-marks');
    expect(known(step)).toHaveLength(6);
    expect(annotationsOutOfStep(step)).toBe(true);
  });

  // 17d review: the same card's sheet, its marks lifted where they were baked, has not moved under the author's.
  it('keeps the author’s marks in step when an old baked step is given its own card again, lifted, from the same side', () => {
    const old = (side: boolean, inStep = true): DiagramStep => ({
      ...createStep(() => 'step-old'),
      source: referencesSource({ way: 'way-1' }),
      picture: baked('steps-a', side),
      annotations: [circle('annotation-mine')],
      annotatedPictureKey: inStep ? baked('steps-a', side).key : 'another',
    });
    const replace = (step: DiagramStep, card: SentReferencesStep) =>
      stepOf(pullReferencesSteps(diagram(step), [card], { kind: 'replace', stepId: 'step-old' }).document, 'step-old');
    const same = replace(old(false), sent('steps-a'));
    expect(same.picture?.key).toBe('steps-a-marks');
    expect(same.annotatedPictureKey).toBe('steps-a-marks');
    expect(annotationsOutOfStep(same)).toBe(false);
    // Out of step already, they stay so; the card from its other side is another sheet.
    expect(annotationsOutOfStep(replace(old(false, false), sent('steps-a')))).toBe(true);
    expect(annotationsOutOfStep(replace(old(true), sent('steps-a')))).toBe(true);
  });

  it('swaps them for another way’s, lifted with the step’s own choice, as one edit', () => {
    const { document, stepId } = edited();
    const way = { signature: 'way-2', picture: baked('steps-w'), sentence: 'Fold it so.', lifted: lifted('steps-w') };
    const chosen = setReferencesWay(document, stepId, way);
    const step = stepOf(chosen, stepId);
    expect(step.picture?.key).toBe('steps-w-marks');
    expect(known(step).filter((mark) => mark.imported === 'untouched')).toHaveLength(5);
    expect(known(step).at(-1)?.id).toBe('annotation-mine');
    expect(editedCardMarksGone(stepOf(document, stepId), step)).toBe(1);
    // The way it shows, baked or lifted, is no edit.
    expect(setReferencesWay(chosen, stepId, { ...way, picture: baked('steps-w') })).toBe(chosen);
  });

  it('puts the new card’s marks into an enlarged step’s window, its lines cut at the frame, and none the frame leaves out', () => {
    const { document, stepId } = pulled();
    const zoom = { from: 'area-1', shape: 'circle' as const, frame: { centre: [0.5, 0.5] as [number, number], radius: 0.2 } };
    const enlarged = {
      ...document,
      steps: document.steps.map((entry) => (entry.id === stepId ? { ...(entry as DiagramStep), zoom, annotations: [] } : entry)),
    };
    const step = stepOf(pullReferencesSteps(enlarged, [sent('steps-b', framedCard())], { kind: 'replace', stepId }).document, stepId);
    expect(step.zoom).toEqual(zoom);
    // 17d review: what the frame cut from the card's picture — a reference line, a ring and an arrow outside it — is not
    // pulled, so the step draws nothing past its cell; the fold across it, the ring and letter and short arrow in it are.
    expect(known(step).map((mark) => mark.kind)).toEqual(['valley-line', 'circle', 'label', 'fold-unfold-arrow']);
    const fold = known(step).find((mark) => mark.kind === 'valley-line')!;
    // The window is the frame's box, 0.3 to 0.7: the fold across the middle, in its units, cut just past the rim.
    expect(fold.from[1]).toBeCloseTo(0.5, 9);
    expect(fold.from[0]).toBeGreaterThan(-0.2);
    expect(fold.to[0]).toBeLessThan(1.2);
    expect(fold.from[0]).toBeLessThan(0);
    // The ring in the frame, in the window's units: its point (0.5, 0.45) on the picture.
    const ring = known(step).find((mark) => mark.kind === 'circle')!;
    expect(ring.from[0]).toBeCloseTo((0.5 - 0.3) / 0.4, 9);
    expect(ring.from[1]).toBeCloseTo((0.45 - 0.3) / 0.4, 9);
  });
});

describe('a card filled into a seeded step', () => {
  it('fills an empty step with the card’s paper and marks, its author’s marks out of step', () => {
    const empty: DiagramStep = { ...createStep(() => 'step-e'), annotations: [circle('annotation-mine')], annotatedPictureKey: 'gone' };
    const result = pullReferencesSteps(diagram(empty), [sent()], { kind: 'fill', stepId: 'step-e' });
    const step = stepOf(result.document, 'step-e');
    expect(step.picture?.key).toBe('steps-a-marks');
    expect(known(step).map((mark) => mark.imported)).toEqual(['untouched', 'untouched', 'untouched', 'untouched', 'untouched', undefined]);
    expect(annotationsOutOfStep(step)).toBe(true);
  });
});

describe('a real card', () => {
  it('lifts Zach’s screenshot’s kind of step whole', () => {
    const card = liftedCardPicture(baked('steps-p', false, pointsCard()), { letters: true, highlights: true }, DEFAULT_DIAGRAM_STYLE)!;
    expect(card.annotations.map((mark) => mark.kind).sort()).toEqual(
      ['circle', 'circle', 'circle', 'fold-unfold-arrow', 'fold-unfold-arrow', 'label', 'label', 'label', 'valley-line'].sort()
    );
  });
});
