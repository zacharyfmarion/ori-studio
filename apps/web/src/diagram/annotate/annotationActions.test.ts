import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import type { DiagramAnnotationKind, KnownDiagramAnnotation } from '../document/diagramDocument';
import {
  NUDGE_STEP,
  annotationActionEdit,
  buildAnnotationActions,
  deleteKeyEdit,
  nudgePathNodeEdit,
  offersAnnotationAction,
  steppedNode,
  type AnnotationEdit,
} from './annotationActions';
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

describe('Edit Path’s node verbs', () => {
  /** A four-node S, smooth throughout. */
  const S: KnownDiagramAnnotation = {
    id: 's',
    kind: 'valley-arrow',
    from: [0.1, 0.5],
    to: [0.7, 0.5],
    path: [
      { at: [0.1, 0.5], out: [0.15, 0.4] },
      { at: [0.3, 0.4], in: [0.25, 0.45], out: [0.35, 0.35] },
      { at: [0.5, 0.6], in: [0.45, 0.65], out: [0.55, 0.55] },
      { at: [0.7, 0.5], in: [0.65, 0.6] },
    ],
  };
  const build = (annotation: KnownDiagramAnnotation, state: Partial<Parameters<typeof buildAnnotationActions>[1]> = {}) => {
    const apply = vi.fn<(edit: AnnotationEdit) => void>();
    const selectNode = vi.fn<(node: number | null) => void>();
    const actions = buildAnnotationActions(annotation, { editable: true, editingPath: true, ...state }, { t, apply, selectNode });
    const verb = (id: string) => actions.find((action) => action.id === id)!;
    return { actions, verb, apply, selectNode };
  };

  it('are offered on a fold arrow with Edit Path in hand, and only there', () => {
    const ids = (annotation: KnownDiagramAnnotation, editingPath: boolean) =>
      buildAnnotationActions(annotation, { editable: true, editingPath }, { t, apply: vi.fn() }).map(
        ({ id, group }) => `${group}:${id}`
      );
    expect(ids(S, true)).toEqual([
      'node:previous-node',
      'node:next-node',
      'node:smooth-node',
      'node:corner-node',
      'node:add-node',
      'node:delete-node',
      'annotation:flip-arc',
      'annotation:reset-path',
      'annotation:delete',
    ]);
    // With Select, a shaped arrow still offers Reset; an arc does not.
    expect(ids(S, false)).toEqual(['annotation:flip-arc', 'annotation:reset-path', 'annotation:delete']);
    expect(ids(of('a', 'valley-arrow'), false)).toEqual(['annotation:flip-arc', 'annotation:delete']);
    // Edit Path on a kind that is not shaped offers it nothing of its own.
    expect(ids(of('p', 'push-arrow'), true)).toEqual(['annotation:delete']);
  });

  it('step from node to node, stopping at the ends, from none to the first or the last', () => {
    expect(steppedNode(null, 4, 1)).toBe(0);
    expect(steppedNode(null, 4, -1)).toBe(3);
    expect(steppedNode(1, 4, 1)).toBe(2);
    expect(steppedNode(3, 4, 1)).toBe(3);
    expect(steppedNode(0, 4, -1)).toBe(0);
    const { verb, selectNode } = build(S, { node: 1 });
    verb('next-node').run();
    verb('previous-node').run();
    expect(selectNode.mock.calls).toEqual([[2], [0]]);
    // At an end, the way on is off; a read-only step still steps (nothing changes).
    expect(build(S, { node: 3 }).verb('next-node').disabled).toBe(true);
    expect(build(S, { node: 1, editable: false }).verb('next-node').disabled).toBe(false);
  });

  it('need a node, and Smooth and Corner one between two others', () => {
    const none = build(S, { node: null });
    expect(['smooth-node', 'corner-node', 'add-node', 'delete-node'].map((id) => none.verb(id).disabled)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    const end = build(S, { node: 0 });
    expect([end.verb('smooth-node').disabled, end.verb('corner-node').disabled, end.verb('add-node').disabled]).toEqual([
      true,
      true,
      false,
    ]);
    const middle = build(S, { node: 1 });
    expect([middle.verb('smooth-node').active, middle.verb('corner-node').active]).toEqual([true, false]);
    expect(middle.verb('delete-node').shortcutId).toBe('edit.delete');
    // Every edit is off on a step that cannot change.
    expect(build(S, { node: 1, editable: false }).verb('delete-node').disabled).toBe(true);
    // Reset waits for a path to undo.
    expect(build(of('a', 'valley-arrow'), { node: 0 }).verb('reset-path').disabled).toBe(true);
    expect(middle.verb('reset-path').disabled).toBe(false);
  });

  it('make a node a corner and smooth again, as one edit each, counted as shaping by node type', () => {
    const { verb, apply } = build(S, { node: 2 });
    verb('corner-node').run();
    const corner = apply.mock.calls[0]![0];
    expect(corner.label).toBe('Make node corner');
    expect(corner.shapes).toEqual({ annotationId: 's', gesture: 'node_type' });
    const cornered = corner.edit([S])[0]!;
    expect(cornered.path![2]!.type).toBe('corner');
    const smooth = annotationActionEdit('smooth-node', 's', { node: 2 }).edit([cornered])[0]!;
    expect(smooth.path![2]!.type).toBeUndefined();
  });

  it('add a node halfway along the segment after the selected one — before the tip — and select it', () => {
    const after = annotationActionEdit('add-node', 's', { node: 1 });
    expect(after.selectPathNode).toBe(2);
    expect(after.shapes).toEqual({ annotationId: 's', gesture: 'add_node' });
    const added = after.edit([S])[0]!;
    expect(added.path).toHaveLength(5);
    // The nodes either side keep their places.
    expect([added.path![1]!.at, added.path![3]!.at]).toEqual([S.path![1]!.at, S.path![2]!.at]);
    // From the tip, the segment before it.
    const tip = annotationActionEdit('add-node', 's', { node: 3 }).edit([S])[0]!;
    expect(tip.path!.map((node) => node.at).filter((at, index) => index !== 3)).toEqual(S.path!.map((node) => node.at));
    // An arc is shaped by it: its two nodes become three.
    const arc = of('a', 'valley-arrow', { bend: ARROW_BEND });
    expect(annotationActionEdit('add-node', 'a', { node: 0 }).edit([arc])[0]!.path).toHaveLength(3);
    // No node, no edit.
    expect(annotationActionEdit('add-node', 's').edit([S])[0]).toBe(S);
  });

  it('delete the node, selecting the one before, and a two-node arrow’s whole', () => {
    const deleted = annotationActionEdit('delete-node', 's', { node: 2 });
    expect(deleted.selectPathNode).toBe(1);
    expect(deleted.edit([S])[0]!.path!.map((node) => node.at)).toEqual([
      [0.1, 0.5],
      [0.3, 0.4],
      [0.7, 0.5],
    ]);
    expect(annotationActionEdit('delete-node', 's', { node: 0 }).selectPathNode).toBe(0);
    const arc = of('a', 'valley-arrow', { bend: ARROW_BEND });
    const list = annotationActionEdit('delete-node', 'a', { node: 1 }).edit([arc, of('b', 'valley-line')]);
    expect(list.map((annotation) => annotation.id)).toEqual(['b']);
  });

  it('give Delete the node while one is selected, and the annotation otherwise', () => {
    expect(deleteKeyEdit('s', 1)).toMatchObject({ label: 'Delete node', selectPathNode: 0 });
    expect(deleteKeyEdit('s', null)).toMatchObject({ label: 'Delete annotation', select: null });
  });

  it('reset a shaped arrow to its arc, the node selection let go', () => {
    const reset = annotationActionEdit('reset-path', 's', { frame: { width: 1, height: 1 } });
    expect(reset.selectPathNode).toBeNull();
    const arc = reset.edit([S])[0]!;
    expect(arc.path).toBeUndefined();
    expect(Math.abs(arc.bend!)).toBeCloseTo(ARROW_BEND, 12);
    expect([arc.from, arc.to]).toEqual([S.from, S.to]);
  });

  it('nudge a node by a step, its handles with it, as one edit counted as a nudge', () => {
    const nudge = nudgePathNodeEdit('s', 1, [NUDGE_STEP.small, -NUDGE_STEP.large]);
    expect(nudge).toMatchObject({ label: 'Nudge node', shapes: { annotationId: 's', gesture: 'nudge' } });
    const node = nudge.edit([S])[0]!.path![1]!;
    expect(node.at[0]).toBeCloseTo(0.301, 12);
    expect(node.at[1]).toBeCloseTo(0.39, 12);
    expect(node.out![0]).toBeCloseTo(0.351, 12);
  });
});
