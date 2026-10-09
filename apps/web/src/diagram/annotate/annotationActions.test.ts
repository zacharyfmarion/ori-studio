import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import type { DiagramAnnotationKind, KnownDiagramAnnotation } from '../document/diagramDocument';
import {
  NUDGE_STEP,
  annotationActionEdit,
  buildAnnotationActions,
  deleteKeyEdit,
  flipKeyEdit,
  nudgePathNodeEdit,
  offersAnnotationAction,
  steppedNode,
  type AnnotationAction,
  type AnnotationEdit,
} from './annotationActions';
import { flipChangesArc, ANNOTATION_KINDS, ARROW_BEND, MAX_PATH_NODES } from './annotationModel';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

/** The verbs a test is about: the flips, a row of their own, are tested on their own. */
const verbsOf = (actions: AnnotationAction[]) => actions.filter((action) => action.group !== 'flip');

const of = (id: string, kind: DiagramAnnotationKind, extra: Partial<KnownDiagramAnnotation> = {}): KnownDiagramAnnotation => ({
  id,
  kind,
  from: [0.2, 0.3],
  to: [0.6, 0.3],
  ...extra,
});

describe('the annotation verbs', () => {
  it('offer Flip Arc on the three fold arrows, the pleat arrow, the white arrow and equal divisions alone, and Delete on every kind', () => {
    const flips = ANNOTATION_KINDS.filter((kind) => offersAnnotationAction('flip-arc', of('a', kind)));
    expect(flips).toEqual(['valley-arrow', 'mountain-arrow', 'fold-unfold-arrow', 'pleat-arrow', 'white-arrow', 'divisions']);
    expect(ANNOTATION_KINDS.every((kind) => offersAnnotationAction('delete', of('a', kind)))).toBe(true);
  });

  it('give an eye its Flip row, F naming its Horizontal: mirrored across, it looks the other way and stays as upright (Revision 3, R3-9b A, F amended 2026-10-08)', () => {
    const edits: AnnotationEdit[] = [];
    // Looking down and to the right.
    const eye = of('e', 'eye', { from: [0.3, 0.4], to: [0.3, 0.4], angle: 30 });
    const actions = buildAnnotationActions(eye, { editable: true }, { t, apply: (edit) => edits.push(edit) });
    // No Flip of its own beside the row's Horizontal, which F runs.
    expect(actions.map((action) => [action.id, action.label, action.shortcutId])).toEqual([
      ['flip-horizontal', 'Flip Horizontal', 'diagram.flipArc'],
      ['flip-vertical', 'Flip Vertical', undefined],
      ['delete', 'Delete', 'edit.delete'],
    ]);
    // F: down and to the left, not up and to the left as a half turn would have it.
    const key = flipKeyEdit(eye)!;
    expect(key.label).toBe('Flip horizontal');
    expect(key.edit([eye])).toEqual([{ ...eye, angle: 150 }]);
    expect(key.flips).toEqual({ annotationId: 'e', axis: 'horizontal' });
    actions.find((action) => action.id === 'flip-horizontal')!.run();
    expect(edits[0]!.edit([eye])).toEqual(key.edit([eye]));
    // Looking left, F has it look right, its angle unsaid; looking straight down, F changes nothing and falls through.
    const { angle: _left, ...right } = { ...eye, angle: 180 };
    expect(flipKeyEdit({ ...eye, angle: 180 })!.edit([{ ...eye, angle: 180 }])).toEqual([right]);
    expect(flipKeyEdit({ ...eye, angle: 90 })).toBeNull();
  });

  it('run Flip Arc with F where an arc flips and would change, and nothing on a mark with neither (Revision 3)', () => {
    expect(flipKeyEdit(of('v', 'valley-arrow', { bend: ARROW_BEND }))!.label).toBe('Flip arc');
    expect(flipKeyEdit(of('v', 'valley-arrow', { bend: 0 }))).toBeNull();
    expect(flipKeyEdit(of('l', 'valley-line'))).toBeNull();
    expect(flipKeyEdit(of('s', 'star', { to: [0.2, 0.3] }))).toBeNull();
  });

  it('name Flip on a pleat arrow, which has no arc, and step its Zs to the other side and back (15c)', () => {
    const edits: AnnotationEdit[] = [];
    const pleat = of('p', 'pleat-arrow');
    const [flip] = verbsOf(buildAnnotationActions(pleat, { editable: true }, { t, apply: (edit) => edits.push(edit) }));
    expect(flip).toMatchObject({ id: 'flip-arc', label: 'Flip', shortcutId: 'diagram.flipArc', disabled: false });
    flip!.run();
    const once = edits[0]!.edit([pleat]);
    expect(once).toEqual([{ ...pleat, mirrored: true }]);
    // Back: `mirrored` is written only when true.
    expect(edits[0]!.edit(once)).toEqual([pleat]);
  });

  it('name Flip on equal divisions, which have no arc, put their line over and back, and hold it where it is alike on both sides (Revision 2)', () => {
    const edits: AnnotationEdit[] = [];
    const divisions = of('d', 'divisions', { parts: 4, offset: 2.5 });
    const [flip] = verbsOf(buildAnnotationActions(divisions, { editable: true }, { t, apply: (edit) => edits.push(edit) }));
    expect(flip).toMatchObject({ id: 'flip-arc', label: 'Flip', shortcutId: 'diagram.flipArc', disabled: false });
    flip!.run();
    const once = edits[0]!.edit([divisions]);
    expect(once).toEqual([{ ...divisions, mirrored: true }]);
    expect(edits[0]!.edit(once)).toEqual([divisions]);
    // On their line with no count, the template's symbol: alike either side, so held.
    const symbol = of('d', 'divisions', { parts: 4, offset: 0 });
    expect(verbsOf(buildAnnotationActions(symbol, { editable: true }, { t, apply: vi.fn() }))[0]).toMatchObject({
      id: 'flip-arc',
      disabled: true,
    });
    const numbered = of('d', 'divisions', { parts: 4, offset: 0, numbered: true });
    expect(verbsOf(buildAnnotationActions(numbered, { editable: true }, { t, apply: vi.fn() }))[0]).toMatchObject({
      disabled: false,
    });
  });

  it('come in the pane’s order with their keys, enabled only on a step that can change', () => {
    const apply = vi.fn();
    const arrow = verbsOf(buildAnnotationActions(of('a', 'valley-arrow'), { editable: true }, { t, apply }));
    expect(arrow.map(({ id, label, shortcutId, disabled }) => ({ id, label, shortcutId, disabled }))).toEqual([
      { id: 'flip-arc', label: 'Flip Arc', shortcutId: 'diagram.flipArc', disabled: false },
      { id: 'delete', label: 'Delete', shortcutId: 'edit.delete', disabled: false },
    ]);
    const line = verbsOf(buildAnnotationActions(of('l', 'valley-line'), { editable: false }, { t, apply }));
    expect(line.map(({ id, disabled }) => ({ id, disabled }))).toEqual([{ id: 'delete', disabled: true }]);
  });

  it('run as one edit of the step’s list, on the annotation as it is when the edit lands', () => {
    const edits: AnnotationEdit[] = [];
    const [flip, remove] = verbsOf(
      buildAnnotationActions(of('a', 'mountain-arrow', { bend: 0.2 }), { editable: true }, {
        t,
        apply: (edit) => edits.push(edit),
      })
    );
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
      verbsOf(buildAnnotationActions(annotation, { editable: true, editingPath }, { t, apply: vi.fn() })).map(
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

  it('are offered on a white arrow with Edit Path in hand, and Reset with Select only once it is bent', () => {
    const ids = (annotation: KnownDiagramAnnotation, editingPath: boolean) =>
      verbsOf(buildAnnotationActions(annotation, { editable: true, editingPath, node: 0 }, { t, apply: vi.fn(), selectNode: vi.fn() })).map(
        ({ id, disabled }) => `${id}${disabled ? ' (off)' : ''}`
      );
    const straight = of('w', 'white-arrow', { path: [{ at: [0.2, 0.3] }, { at: [0.6, 0.3] }], width: 'regular', tail: 'pointed' });
    expect(ids(straight, true)).toEqual([
      'previous-node (off)',
      'next-node',
      'smooth-node (off)',
      'corner-node (off)',
      'add-node',
      'delete-node',
      // Straight already: a flip mirrors it onto itself, and there is nothing to go back to.
      'flip-arc (off)',
      'reset-path (off)',
      'delete',
    ]);
    // With Select a straight one offers no Reset; a bent one does, and Reset lays it straight.
    expect(ids(straight, false)).toEqual(['flip-arc (off)', 'delete']);
    const bent = { ...straight, path: [{ at: [0.2, 0.3] as [number, number], out: [0.3, 0.1] as [number, number] }, { at: [0.6, 0.3] as [number, number] }] };
    expect(ids(bent, false)).toEqual(['flip-arc', 'reset-path', 'delete']);
    expect(annotationActionEdit('reset-path', 'w').edit([bent])).toEqual([straight]);
    // Nodes added along a straight one leave it straight: still nothing to flip (review).
    const along = { ...straight, path: [{ at: [0.2, 0.3] as [number, number] }, { at: [0.4, 0.3] as [number, number], in: [0.3, 0.3] as [number, number], out: [0.5, 0.3] as [number, number] }, { at: [0.6, 0.3] as [number, number] }] };
    // (Reset takes the nodes out again.)
    expect(ids(along, false)).toEqual(['flip-arc (off)', 'reset-path', 'delete']);
    expect(flipChangesArc(along)).toBe(false);
    expect(flipChangesArc(bent)).toBe(true);
    // An arc flips while it bends.
    expect(flipChangesArc(of('v', 'valley-arrow', { bend: 0.1 }))).toBe(true);
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

  it('name the Delete key on the verb it runs: the node’s while one is selected, else the annotation’s', () => {
    const onNode = build(S, { node: 1 });
    expect([onNode.verb('delete-node').shortcutId, onNode.verb('delete').shortcutId]).toEqual(['edit.delete', undefined]);
    const noNode = build(S, { node: null });
    expect([noNode.verb('delete-node').shortcutId, noNode.verb('delete').shortcutId]).toEqual([undefined, 'edit.delete']);
  });

  it('select the node Add Node adds, the tip selected too, and offer it no further than the most nodes', () => {
    // From the tip the node lands before it, where the tip was: that one is selected, not the tip.
    const { verb, apply } = build(S, { node: 3 });
    verb('add-node').run();
    const edit = apply.mock.calls[0]![0];
    expect(edit.selectPathNode).toBe(3);
    expect(edit.edit([S])[0]!.path![4]!.at).toEqual(S.to);
    // At the most nodes an arrow holds, Add Node is off.
    const full: KnownDiagramAnnotation = {
      ...S,
      path: Array.from({ length: MAX_PATH_NODES }, (_, index) => ({ at: [0.1 + index * 0.02, 0.5] as [number, number] })),
      to: [0.1 + (MAX_PATH_NODES - 1) * 0.02, 0.5],
    };
    expect(build(full, { node: 3 }).verb('add-node').disabled).toBe(true);
  });

  it('keep a fold-and-unfold arrow’s tip, where it turns back, and its return’s one node past it', () => {
    // Its nodes run from the tail through the tip to the return's end.
    const unfold = of('u', 'fold-unfold-arrow', { bend: ARROW_BEND });
    const tip = build(unfold, { node: 1 });
    expect(['smooth-node', 'corner-node', 'add-node', 'delete-node'].map((id) => tip.verb(id).disabled)).toEqual([
      true,
      true,
      false,
      true,
    ]);
    expect(build(unfold, { node: 2 }).verb('delete-node').disabled).toBe(true);
    // Add Node at the tip adds to the return, and selects what it adds.
    tip.verb('add-node').run();
    const edit = tip.apply.mock.calls[0]![0];
    expect(edit.selectPathNode).toBe(2);
    const added = edit.edit([unfold])[0]!;
    expect(added.back).toHaveLength(3);
    const middle = build(added, { node: 2 });
    expect([middle.verb('smooth-node').disabled, middle.verb('delete-node').disabled]).toEqual([false, false]);
  });

  it('offer no Reset on a loop whose ends meet, which has no arc to go back to', () => {
    const loop: KnownDiagramAnnotation = {
      ...S,
      to: [0.105, 0.5],
      path: [
        { at: [0.1, 0.5], out: [0.5, 0.1] },
        { at: [0.105, 0.5], in: [0.5, 0.9] },
      ],
    };
    expect(build(loop, { node: 0 }).verb('reset-path').disabled).toBe(true);
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

describe('Flip Horizontal and Flip Vertical (Zach, 2026-10-05)', () => {
  it('are offered on every mark with a side to it, a row of their own ahead of the rest, with no keys', () => {
    const flips = ANNOTATION_KINDS.filter((kind) => offersAnnotationAction('flip-horizontal', of('a', kind)));
    // A star has no Flip, as a circle has none: its turn is its box's (Revision 3).
    expect(flips).toEqual(ANNOTATION_KINDS.filter((kind) => !['turn-over', 'label', 'circle', 'star', 'zoom'].includes(kind)));
    const actions = buildAnnotationActions(of('a', 'valley-arrow'), { editable: true }, { t, apply: vi.fn() });
    expect(actions.map(({ id, group, label, shortcutId, disabled }) => ({ id, group, label, shortcutId, disabled }))).toEqual([
      { id: 'flip-horizontal', group: 'flip', label: 'Flip Horizontal', shortcutId: undefined, disabled: false },
      { id: 'flip-vertical', group: 'flip', label: 'Flip Vertical', shortcutId: undefined, disabled: false },
      { id: 'flip-arc', group: 'annotation', label: 'Flip Arc', shortcutId: 'diagram.flipArc', disabled: false },
      { id: 'delete', group: 'annotation', label: 'Delete', shortcutId: 'edit.delete', disabled: false },
    ]);
  });

  it('are held where the mark would turn over onto itself, and on a step that cannot change', () => {
    const [horizontal, vertical] = buildAnnotationActions(of('l', 'valley-line'), { editable: true }, { t, apply: vi.fn() });
    // A level line top to bottom is itself; left to right its ends change places.
    expect(vertical).toMatchObject({ id: 'flip-vertical', disabled: true });
    expect(horizontal).toMatchObject({ id: 'flip-horizontal', disabled: false });
    const [held] = buildAnnotationActions(of('a', 'valley-arrow'), { editable: false }, { t, apply: vi.fn() });
    expect(held).toMatchObject({ id: 'flip-horizontal', disabled: true });
  });

  it('hold a Flip Horizontal along equal divisions’ level line, which draws them as they were, and offer Flip Vertical (Revision 2)', () => {
    // Left to right, the ends change places and the side turns over: the same mark.
    const divisions = of('d', 'divisions', { parts: 4, offset: 2.5 });
    const [horizontal, vertical] = buildAnnotationActions(divisions, { editable: true }, { t, apply: vi.fn() });
    expect(horizontal).toMatchObject({ id: 'flip-horizontal', disabled: true });
    // Top to bottom, the line goes to the other side of the edge.
    expect(vertical).toMatchObject({ id: 'flip-vertical', disabled: false });
    expect(annotationActionEdit('flip-vertical', 'd').edit([divisions])).toEqual([{ ...divisions, mirrored: true }]);
    // On a slant, either way moves it.
    const slant = of('d', 'divisions', { from: [0.2, 0.2], to: [0.6, 0.5], parts: 4, offset: 2.5 });
    const [h, v] = buildAnnotationActions(slant, { editable: true }, { t, apply: vi.fn() });
    expect([h!.disabled, v!.disabled]).toEqual([false, false]);
  });

  it('turn the mark over as one edit, on the mark as it is when it lands, saying which way for the count', () => {
    const edits: AnnotationEdit[] = [];
    const [horizontal] = buildAnnotationActions(of('a', 'valley-arrow', { bend: 0.2 }), { editable: true }, {
      t,
      apply: (edit) => edits.push(edit),
    });
    horizontal!.run();
    expect(edits[0]).toMatchObject({ label: 'Flip horizontal', flips: { annotationId: 'a', axis: 'horizontal' } });
    const [flipped, other] = edits[0]!.edit([of('a', 'valley-arrow', { bend: 0.3 }), of('b', 'push-arrow')]);
    expect(flipped).toMatchObject({ from: [expect.closeTo(0.6, 12), 0.3], to: [expect.closeTo(0.2, 12), 0.3], bend: -0.3 });
    expect(other).toEqual(of('b', 'push-arrow'));
  });
});

describe('Turn 90°', () => {
  const square = (opens: [number, number]): KnownDiagramAnnotation => ({
    id: 'r',
    kind: 'right-angle',
    from: [0.5, 0.5],
    to: [0.5 + 0.02 * opens[0], 0.5 + 0.02 * opens[1]],
  });

  it('is offered on a right angle alone, after the arrows’ verbs and before Delete', () => {
    const turns = ANNOTATION_KINDS.filter((kind) => offersAnnotationAction('turn-right-angle', of('a', kind)));
    expect(turns).toEqual(['right-angle']);
    const actions = verbsOf(buildAnnotationActions(square([1, 0]), { editable: true }, { t, apply: vi.fn() }));
    expect(actions.map(({ id, label, disabled }) => ({ id, label, disabled }))).toEqual([
      { id: 'turn-right-angle', label: 'Turn 90°', disabled: false },
      { id: 'delete', label: 'Delete', disabled: false },
    ]);
    expect(verbsOf(buildAnnotationActions(square([1, 0]), { editable: false }, { t, apply: vi.fn() }))[0]!.disabled).toBe(true);
  });

  it('turns it a quarter clockwise about its corner, as one edit, on the mark as it is when it lands', () => {
    const edits: AnnotationEdit[] = [];
    verbsOf(buildAnnotationActions(square([1, 0]), { editable: true }, { t, apply: (edit) => edits.push(edit) }))[0]!.run();
    expect(edits.map(({ label, select }) => ({ label, select }))).toEqual([{ label: 'Turn right angle', select: undefined }]);
    // Opening right now, whatever it opened when the verbs were built: it opens down (y down, clockwise on the page).
    const [turned, other] = edits[0]!.edit([square([0, -1]), of('b', 'valley-line')]);
    expect(turned!.from).toEqual([0.5, 0.5]);
    expect(turned!.to[0]).toBeCloseTo(0.52, 12);
    expect(turned!.to[1]).toBeCloseTo(0.5, 12);
    expect(other).toEqual(of('b', 'valley-line'));
  });
});
