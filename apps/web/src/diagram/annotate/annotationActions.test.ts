import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import type { DiagramAnnotationKind, KnownDiagramAnnotation } from '../document/diagramDocument';
import { annotationActionEdit, buildAnnotationActions, offersAnnotationAction, type AnnotationEdit } from './annotationActions';
import { ANNOTATION_KINDS, ARROW_BEND } from './annotationModel';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

const of = (id: string, kind: DiagramAnnotationKind, extra: Partial<KnownDiagramAnnotation> = {}): KnownDiagramAnnotation => ({
  id,
  kind,
  from: [0.2, 0.3],
  to: [0.6, 0.3],
  ...extra,
});

describe('the annotation verbs', () => {
  it('offer Flip Arc on the three fold arrows alone, and Delete on every kind', () => {
    const flips = ANNOTATION_KINDS.filter((kind) => offersAnnotationAction('flip-arc', of('a', kind)));
    expect(flips).toEqual(['valley-arrow', 'mountain-arrow', 'fold-unfold-arrow']);
    expect(ANNOTATION_KINDS.every((kind) => offersAnnotationAction('delete', of('a', kind)))).toBe(true);
  });

  it('come in the pane’s order with their keys, enabled only on a step that can change', () => {
    const apply = vi.fn();
    const arrow = buildAnnotationActions(of('a', 'valley-arrow'), { editable: true }, { t, apply });
    expect(arrow.map(({ id, label, shortcutId, disabled }) => ({ id, label, shortcutId, disabled }))).toEqual([
      { id: 'flip-arc', label: 'Flip Arc', shortcutId: 'diagram.flipArc', disabled: false },
      { id: 'delete', label: 'Delete', shortcutId: 'edit.delete', disabled: false },
    ]);
    const line = buildAnnotationActions(of('l', 'valley-line'), { editable: false }, { t, apply });
    expect(line.map(({ id, disabled }) => ({ id, disabled }))).toEqual([{ id: 'delete', disabled: true }]);
  });

  it('run as one edit of the step’s list, on the annotation as it is when the edit lands', () => {
    const edits: AnnotationEdit[] = [];
    const [flip, remove] = buildAnnotationActions(of('a', 'mountain-arrow', { bend: 0.2 }), { editable: true }, {
      t,
      apply: (edit) => edits.push(edit),
    });
    flip!.run();
    remove!.run();
    expect(edits.map(({ label, select }) => ({ label, select }))).toEqual([
      { label: 'Flip arc', select: undefined },
      { label: 'Delete annotation', select: null },
    ]);
    // Its bend changed since the actions were built: the flip turns the bend it has now.
    const now = [of('a', 'mountain-arrow', { bend: 0.3 }), of('b', 'valley-arrow', { bend: 0.1 })];
    expect(edits[0]!.edit(now).map((annotation) => annotation.bend)).toEqual([-0.3, 0.1]);
    expect(edits[1]!.edit(now).map((annotation) => annotation.id)).toEqual(['b']);
  });

  it('flip an arrow written without a bend from References’ 60° arc', () => {
    const { edit } = annotationActionEdit('flip-arc', 'a');
    expect(edit([of('a', 'valley-arrow')])[0]!.bend).toBeCloseTo(-ARROW_BEND, 12);
    // Flip arc on a kind that does not offer it leaves it as it is.
    const push = of('a', 'push-arrow');
    expect(edit([push])[0]).toBe(push);
  });
});
