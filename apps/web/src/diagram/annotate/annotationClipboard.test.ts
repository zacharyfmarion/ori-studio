import { describe, expect, it } from 'vitest';
import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import { PASTE_DIVISIONS_OFFSET_MM, PASTE_OFFSET, annotationClipboard, pastedAnnotations, pastedOnto } from './annotationClipboard';
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
