import { describe, expect, it } from 'vitest';
import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import { PASTE_OFFSET, annotationClipboard, pastedAnnotations, pastedOnto } from './annotationClipboard';
import { ANNOTATION_REACH } from './annotationModel';

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
