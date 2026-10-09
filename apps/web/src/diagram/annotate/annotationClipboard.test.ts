import { describe, expect, it } from 'vitest';
import type { DiagramStep, KnownDiagramAnnotation } from '../document/diagramDocument';
import { cpStep, referencesStep, scenePicture, stepDiagramPicture } from '../document/diagramSteps.fixtures';
import { marksTouchingWindow } from '../zoom/stepView';
import { fromBox, stepWindow } from '../zoom/zoomFrames';
import {
  PASTE_DIVISIONS_OFFSET_MM,
  PASTE_OFFSET,
  annotationClipboard,
  copiedView,
  pastedAnnotations,
  pastedOnto,
} from './annotationClipboard';
import { ANNOTATION_REACH, AREA_SIDE } from './annotationModel';

const white: KnownDiagramAnnotation = {
  id: 'w',
  kind: 'white-arrow',
  from: [0.2, 0.3],
  to: [0.6, 0.3],
  path: [{ at: [0.2, 0.3], out: [0.3, 0.1] }, { at: [0.6, 0.3] }],
  width: 'regular',
  tail: 'pointed',
};

describe('annotations on the clipboard', () => {
  it('puts a copy beside its original on its own step, and in place anywhere else, a step on for each paste', () => {
    let clipboard = annotationClipboard([white], 'step-1');
    let ids = 0;
    const newId = () => `annotation-${(ids += 1)}`;
    const [beside] = pastedAnnotations(clipboard, 'step-1', newId);
    // Moved whole: its nodes and their handles with it.
    expect(beside).toMatchObject({ id: 'annotation-1', from: [0.2 + PASTE_OFFSET, 0.3 + PASTE_OFFSET] });
    expect(beside!.path![0]!.out).toEqual([expect.closeTo(0.3 + PASTE_OFFSET, 12), expect.closeTo(0.1 + PASTE_OFFSET, 12)]);
    expect(pastedAnnotations(clipboard, 'step-2', newId)[0]).toEqual({ ...white, id: 'annotation-2' });
    clipboard = pastedOnto(pastedOnto(clipboard, 'step-2'), 'step-1');
    expect(clipboard.pastes).toEqual({ 'step-1': 2, 'step-2': 1 });
    expect(pastedAnnotations(clipboard, 'step-2', newId)[0]!.from).toEqual([0.2 + PASTE_OFFSET, 0.3 + PASTE_OFFSET]);
  });

  it('keeps equal divisions on their line, each paste on their own step standing 2.5 mm further out, up to 15 (ED12)', () => {
    const divisions: KnownDiagramAnnotation = { id: 'd', kind: 'divisions', from: [0, 0], to: [1, 0], parts: 4, offset: 2.5, mirrored: true };
    expect(PASTE_DIVISIONS_OFFSET_MM).toBe(2.5);
    let clipboard = annotationClipboard([divisions], 'step-1');
    const [first] = pastedAnnotations(clipboard, 'step-1', () => 'annotation-1');
    // Not moved by PASTE_OFFSET, which would leave it measuring nothing.
    expect(first).toEqual({ ...divisions, id: 'annotation-1', offset: 5 });
    clipboard = pastedOnto(clipboard, 'step-1');
    expect(pastedAnnotations(clipboard, 'step-1', () => 'annotation-2')[0]!.offset).toBe(7.5);
    for (let i = 0; i < 6; i += 1) clipboard = pastedOnto(clipboard, 'step-1');
    expect(pastedAnnotations(clipboard, 'step-1', () => 'annotation-3')[0]!.offset).toBe(15);
    // In place, as it was, on another step.
    expect(pastedAnnotations(clipboard, 'step-2', () => 'annotation-4')[0]).toEqual({ ...divisions, id: 'annotation-4' });
  });

  it('keeps equal divisions’ short dividers on a paste, on their own step and on another (Revision 3)', () => {
    const short: KnownDiagramAnnotation = { id: 'd', kind: 'divisions', from: [0, 0], to: [1, 0], parts: 3, offset: 10, shortDividers: true };
    const clipboard = annotationClipboard([short], 'step-1');
    expect(pastedAnnotations(clipboard, 'step-1', () => 'annotation-1')[0]).toEqual({ ...short, id: 'annotation-1', offset: 12.5 });
    expect(pastedAnnotations(clipboard, 'step-2', () => 'annotation-2')[0]).toEqual({ ...short, id: 'annotation-2' });
  });

  it('pastes an eye beside its original on its own step, looking the way it did at its scale, and in place anywhere else (Revision 3)', () => {
    const eye: KnownDiagramAnnotation = { id: 'e', kind: 'eye', from: [0.3, 0.4], to: [0.3, 0.4], angle: 135, scale: 1.5 };
    const clipboard = annotationClipboard([eye], 'step-1');
    const beside: [number, number] = [0.3 + PASTE_OFFSET, 0.4 + PASTE_OFFSET];
    expect(pastedAnnotations(clipboard, 'step-1', () => 'annotation-1')[0]).toEqual({ ...eye, id: 'annotation-1', from: beside, to: beside });
    expect(pastedAnnotations(clipboard, 'step-2', () => 'annotation-2')[0]).toEqual({ ...eye, id: 'annotation-2' });
  });

  // 17d: a mark lifted from a card is the card's on a step that shows that card, the author's anywhere else.
  it('keeps a pulled mark the card’s only on a step showing the same card, front or back', () => {
    const ring: KnownDiagramAnnotation = { id: 'r', kind: 'circle', from: [0, 1], to: [0, 1], imported: 'edited' };
    const pulled = (id: string, key: string, mirrored = false): DiagramStep => ({
      ...referencesStep(id),
      picture: { ...stepDiagramPicture(mirrored), key },
      annotatedPictureKey: key,
    });
    const from = pulled('step-1', 'steps-c-marks');
    const clipboard = annotationClipboard([ring], 'step-1', { cut: true, view: copiedView(from) });
    expect(clipboard.view?.card).toBe('steps-c');
    // Cut and pasted back: still the card's.
    expect(pastedAnnotations(clipboard, 'step-1', () => 'p-1', from)[0]).toEqual({ ...ring, id: 'p-1' });
    // Onto the card's back, or its baked picture on an older step: the card's.
    expect(pastedAnnotations(clipboard, 'step-2', () => 'p-2', pulled('step-2', 'steps-c-marks-back', true))[0]?.imported).toBe('edited');
    expect(pastedAnnotations(clipboard, 'step-3', () => 'p-3', pulled('step-3', 'steps-c'))[0]?.imported).toBe('edited');
    // Onto another card, or another picture: the author's.
    expect(pastedAnnotations(clipboard, 'step-4', () => 'p-4', pulled('step-4', 'steps-d-marks'))[0]).toEqual({ ...ring, id: 'p-4', imported: undefined });
    expect(pastedAnnotations(clipboard, 'step-5', () => 'p-5', cpStep('step-5'))[0]).not.toHaveProperty('imported');
    // Copied from a step that is no card's, a tag goes too.
    const plain = annotationClipboard([ring], 'step-6', { view: copiedView(cpStep('step-6')) });
    expect(plain.view).not.toHaveProperty('card');
    expect(pastedAnnotations(plain, 'step-1', () => 'p-6', from)[0]).not.toHaveProperty('imported');
  });

  // 17d review: a second P pasted beside the card's own would go with the card on the next Replace, unsaid.
  it('makes a pulled mark pasted beside a copy of itself the author’s', () => {
    const letter: KnownDiagramAnnotation = { id: 'p', kind: 'label', from: [0, 1], to: [0, 1], text: 'P', imported: 'untouched' };
    const from: DiagramStep = { ...referencesStep('step-1'), picture: { ...stepDiagramPicture(), key: 'steps-c-marks' }, annotatedPictureKey: 'steps-c-marks' };
    // Copied: the original still lies on its step, so the copy pasted there is a second P, the author's.
    const copied = annotationClipboard([letter], 'step-1', { view: copiedView(from) });
    expect(pastedAnnotations(copied, 'step-1', () => 'p-1', from)[0]).not.toHaveProperty('imported');
    // Cut, the first paste puts the card's P back; a second paste of it is the author's.
    const cut = annotationClipboard([letter], 'step-1', { cut: true, view: copiedView(from) });
    expect(pastedAnnotations(cut, 'step-1', () => 'p-2', from)[0]?.imported).toBe('untouched');
    expect(pastedAnnotations(pastedOnto(cut, 'step-1'), 'step-1', () => 'p-3', from)[0]).not.toHaveProperty('imported');
  });

  it('puts a cut mark back where it was on its own step', () => {
    const clipboard = annotationClipboard([white], 'step-1', { cut: true });
    expect(pastedAnnotations(clipboard, 'step-1', () => 'annotation-1')[0]).toEqual({ ...white, id: 'annotation-1' });
  });

  it('keeps a paste within reach, the mark whole', () => {
    const edge: KnownDiagramAnnotation = { id: 'e', kind: 'valley-line', from: [ANNOTATION_REACH - 0.01, 0.5], to: [ANNOTATION_REACH, 0.5] };
    const [pasted] = pastedAnnotations(annotationClipboard([edge], 'step-1'), 'step-1', () => 'annotation-1');
    expect(pasted!.to[0]).toBe(ANNOTATION_REACH);
    expect(pasted!.from[0]).toBe(ANNOTATION_REACH - 0.01);
    expect(pasted!.from[1]).toBeCloseTo(0.5 + PASTE_OFFSET, 12);
  });
});

describe('marks pasted on the picture they were copied from (Revision 2)', () => {
  const picture = scenePicture('scene-crane');
  const line: KnownDiagramAnnotation = { id: 'l', kind: 'valley-line', from: [0.2, 0.3], to: [0.7, 0.6] };
  /** A step showing the crane's picture: whole, or enlarged to a frame, its marks drawn on it. */
  const showing = (id: string, frame?: { centre: [number, number]; radius: number }): DiagramStep => ({
    ...cpStep(id, undefined, picture),
    ...(frame ? { zoom: { from: 'area', shape: 'circle' as const, frame } } : {}),
    annotations: [line],
    annotatedPictureKey: picture.key,
  });
  const onPaper = (step: DiagramStep, point: readonly [number, number]) => {
    const window = stepWindow(step);
    return window ? fromBox(window, [point[0], point[1]]) : point;
  };
  const near = (a: readonly number[], b: readonly number[]) => a.forEach((value, index) => expect(value).toBeCloseTo(b[index]!, 12));

  it('from one enlarged step to another of the same picture, lands on the same paper in the other’s window', () => {
    const [a, b] = [showing('step-a', { centre: [0.4, 0.4], radius: 0.1 }), showing('step-b', { centre: [0.5, 0.45], radius: 0.25 })];
    const clipboard = annotationClipboard([line], a.id, { view: copiedView(a) });
    const [pasted] = pastedAnnotations(clipboard, b.id, () => 'annotation-1', b);
    near(onPaper(b, pasted!.from), onPaper(a, line.from));
    near(onPaper(b, pasted!.to), onPaper(a, line.to));
    // On its own step, beside its original in the same window.
    expect(pastedAnnotations(clipboard, a.id, () => 'annotation-2', a)[0]!.from).toEqual([0.2 + PASTE_OFFSET, 0.3 + PASTE_OFFSET]);
  });

  it('from an enlarged step to the whole picture, and back, lands on the same paper', () => {
    const [enlarged, whole] = [showing('step-a', { centre: [0.4, 0.4], radius: 0.1 }), showing('step-w')];
    const out = pastedAnnotations(annotationClipboard([line], enlarged.id, { view: copiedView(enlarged) }), whole.id, () => 'annotation-1', whole)[0]!;
    near(out.from, onPaper(enlarged, line.from));
    const back = pastedAnnotations(annotationClipboard([out], whole.id, { view: copiedView(whole) }), enlarged.id, () => 'annotation-2', enlarged)[0]!;
    near(back.from, line.from);
    near(back.to, line.to);
  });

  it('onto another picture: through the picture from or to a whole one; between two windows, in window units', () => {
    const a = showing('step-a', { centre: [0.4, 0.4], radius: 0.1 });
    const elsewhere = (step: DiagramStep): DiagramStep => ({ ...step, picture: scenePicture('scene-other'), annotatedPictureKey: 'scene-other' });
    const clipboard = annotationClipboard([line], a.id, { view: copiedView(a) });
    // Two windows: each frames the paper its area framed, so the mark keeps its place in the window.
    const window = elsewhere(showing('step-o', { centre: [0.5, 0.5], radius: 0.2 }));
    expect(pastedAnnotations(clipboard, window.id, () => 'annotation-1', window)[0]).toEqual({ ...line, id: 'annotation-1' });
    // A whole picture: at the same place on it as on the picture it was copied from — not the window's numbers.
    const whole = elsewhere(showing('step-w'));
    const out = pastedAnnotations(clipboard, whole.id, () => 'annotation-2', whole)[0]!;
    near(out.from, onPaper(a, line.from));
    near(out.to, onPaper(a, line.to));
    // And from a whole picture into a window of another: the same place on the picture, in the window's units.
    const back = pastedAnnotations(annotationClipboard([line], whole.id, { view: copiedView(whole) }), a.id, () => 'annotation-3', a)[0]!;
    near(onPaper(a, back.from), line.from);
    near(onPaper(a, back.to), line.to);
  });

  it('from a whole picture onto another picture’s window, keeps each mark the window would draw nowhere at its place in the window (18d)', () => {
    const a = showing('step-a', { centre: [0.4, 0.4], radius: 0.1 });
    const other: DiagramStep = { ...showing('step-o'), picture: scenePicture('scene-other'), annotatedPictureKey: 'scene-other' };
    // Off the window's corner of the picture: a star, and an eye standing off the paper as eyes often do.
    const star: KnownDiagramAnnotation = { id: 's', kind: 'star', from: [0.85, 0.2], to: [0.85, 0.2], angle: 20 };
    const eye: KnownDiagramAnnotation = { id: 'e', kind: 'eye', from: [0.1, 0.9], to: [0.1, 0.9], angle: 30, scale: 2 };
    let next = 0;
    const ids = () => `annotation-${(next += 1)}`;
    const pasted = pastedAnnotations(annotationClipboard([star, eye], other.id, { view: copiedView(other) }), a.id, ids, a);
    expect(pasted).toEqual([
      { ...star, id: 'annotation-1' },
      { ...eye, id: 'annotation-2' },
    ]);
    expect(marksTouchingWindow(stepWindow(a)!, pasted)).toEqual(pasted);
    // Pasted with a mark that reaches the window, each is asked on its own (18d review): the line goes through the
    // picture, and the star, which the window would draw nowhere there, keeps its place in the window.
    const [crossing, offWindow] = pastedAnnotations(annotationClipboard([line, star], other.id, { view: copiedView(other) }), a.id, ids, a);
    near(onPaper(a, crossing!.from), line.from);
    expect(offWindow).toEqual({ ...star, id: 'annotation-4' });
    expect(marksTouchingWindow(stepWindow(a)!, [offWindow!])).toEqual([offWindow]);
    // One the window would draw, though it lies beside it, goes through the picture too: drawn where it is (16g).
    const beside: KnownDiagramAnnotation = { ...star, from: [0.55, 0.4], to: [0.55, 0.4] };
    const [near1] = pastedAnnotations(annotationClipboard([beside], other.id, { view: copiedView(other) }), a.id, ids, a);
    near(onPaper(a, near1!.from), beside.from);
    expect(marksTouchingWindow(stepWindow(a)!, [near1!])).toEqual([]);
    // From the same picture's whole step it lands on the same paper, outside the window as the picture has it.
    const same = pastedAnnotations(annotationClipboard([star], 'step-w', { view: copiedView(showing('step-w')) }), a.id, ids, a)[0]!;
    near(onPaper(a, same.from), star.from);
    expect(marksTouchingWindow(stepWindow(a)!, [same])).toEqual([]);
  });

  it('pastes an oval or a rectangle into an enlarged step’s window grown with it, so it rings the same part of the picture (Revision 3)', () => {
    const a = showing('step-a', { centre: [0.4, 0.4], radius: 0.1 });
    const whole = showing('step-w');
    const oval: KnownDiagramAnnotation = { id: 'o', kind: 'oval', from: [0.42, 0.38], to: [0.42, 0.38], size: [0.1, 0.05], angle: 20 };
    const [pasted] = pastedAnnotations(annotationClipboard([oval], whole.id, { view: copiedView(whole) }), a.id, () => 'annotation-1', a);
    near(onPaper(a, pasted!.from), oval.from);
    expect(pasted!.to).toEqual(pasted!.from);
    // The window is a fifth of the picture across: five times the size in its units, its turn as it was.
    near(pasted!.size!, [0.5, 0.25]);
    expect(pasted!.angle).toBeCloseTo(20, 9);
    // Back out onto the whole picture, the size it was.
    const back = pastedAnnotations(annotationClipboard([pasted!], a.id, { view: copiedView(a) }), whole.id, () => 'annotation-2', whole)[0]!;
    near(back.size!, oval.size!);
    near(back.from, oval.from);
  });

  it('holds a shape grown past R3-30b’s range by a small window to its largest side, and does not grow it back (18d review)', () => {
    const a = showing('step-a', { centre: [0.4, 0.4], radius: 0.1 });
    const whole = showing('step-w');
    // Half the picture across: two and a half windows, past the two a side may be.
    const wide: KnownDiagramAnnotation = { id: 'w', kind: 'oval', from: [0.4, 0.4], to: [0.4, 0.4], size: [0.5, 0.1] };
    const [pasted] = pastedAnnotations(annotationClipboard([wide], whole.id, { view: copiedView(whole) }), a.id, () => 'annotation-1', a);
    near(onPaper(a, pasted!.from), wide.from);
    near(pasted!.size!, [AREA_SIDE.max, 0.5]);
    // Pasted back out, it rings what the window held of it: 0.4 across, not 0.5.
    const back = pastedAnnotations(annotationClipboard([pasted!], a.id, { view: copiedView(a) }), whole.id, () => 'annotation-2', whole)[0]!;
    near(back.size!, [0.4, 0.1]);
  });

  it('copied out of step with its picture, remembers its units but not its picture', () => {
    const a = { ...showing('step-a', { centre: [0.4, 0.4], radius: 0.1 }), annotatedPictureKey: 'scene-before' };
    expect(copiedView(a)).toEqual({ pictureKey: null, window: stepWindow(a) });
    // Onto another window of its picture, then, it keeps its place in the window; onto the whole picture, it goes through it.
    const b = showing('step-b', { centre: [0.5, 0.45], radius: 0.25 });
    const clipboard = annotationClipboard([line], a.id, { view: copiedView(a) });
    expect(pastedAnnotations(clipboard, b.id, () => 'annotation-1', b)[0]).toEqual({ ...line, id: 'annotation-1' });
    near(pastedAnnotations(clipboard, 'step-w', () => 'annotation-2', showing('step-w'))[0]!.from, onPaper(a, line.from));
  });

  describe('a mark far out from a small window (review of 16g)', () => {
    // Across the model beside a head frame a tenth of a picture wide: some fourteen windows long.
    const far: KnownDiagramAnnotation = { id: 'f', kind: 'valley-line', from: [0.2, 0.3], to: [0.9, 0.6] };
    const head = { centre: [0.4, 0.4] as [number, number], radius: 0.05 };
    const withMarks = (step: DiagramStep, marks: KnownDiagramAnnotation[]): DiagramStep => ({ ...step, annotations: marks });
    const exactly = (a: readonly number[], b: readonly number[]) => a.forEach((value, index) => expect(value).toBeCloseTo(b[index]!, 9));

    it('pasted from the whole picture onto the enlarged step, lands on the same paper', () => {
      const [whole, small] = [withMarks(showing('step-w'), [far]), showing('step-s', head)];
      const [pasted] = pastedAnnotations(annotationClipboard([far], whole.id, { view: copiedView(whole) }), small.id, () => 'annotation-1', small);
      exactly(onPaper(small, pasted!.from), far.from);
      exactly(onPaper(small, pasted!.to), far.to);
    });

    it('pasted back onto its own enlarged step, or a duplicate of it, lands in the window where it was, but for a paste’s step', () => {
      const small = showing('step-s', head);
      const inWindow = pastedAnnotations(annotationClipboard([far], 'step-w', { view: copiedView(showing('step-w')) }), small.id, () => 'x', small)[0]!;
      const clipboard = annotationClipboard([inWindow], small.id, { view: copiedView(withMarks(small, [inWindow])) });
      // On a duplicate: where it is, in the same units.
      const duplicate = { ...showing('step-d', head), annotations: [] };
      exactly(pastedAnnotations(clipboard, duplicate.id, () => 'annotation-1', duplicate)[0]!.from, inWindow.from);
      exactly(pastedAnnotations(clipboard, duplicate.id, () => 'annotation-1', duplicate)[0]!.to, inWindow.to);
      // On its own step: a paste's step down and right of it, in its window's units.
      const [beside] = pastedAnnotations(clipboard, small.id, () => 'annotation-2', small);
      exactly(beside!.from, [inWindow.from[0] + PASTE_OFFSET, inWindow.from[1] + PASTE_OFFSET]);
      exactly(beside!.to, [inWindow.to[0] + PASTE_OFFSET, inWindow.to[1] + PASTE_OFFSET]);
    });
  });
});
