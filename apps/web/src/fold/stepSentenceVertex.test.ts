import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { FOLD_VERTEX_OP_KINDS } from './document/foldSequenceDocument';
import { foldSentenceStepOf } from './sequence/foldSentenceStep';
import { foldStepSentence } from './stepSentence';
import { vertexRows } from './stepSentenceVertex';
import { lineLabel, operationBadge, operationLabel } from './stepWords';

const t = i18n.t.bind(i18n);

describe('a vertex fold’s words', () => {
  it('are a sentence, a name and a badge of their own, and no line', () => {
    const words = FOLD_VERTEX_OP_KINDS.map((fold) => {
      const step = { op: 'vertex', fold, direction: 'valley' } as const;
      return [foldStepSentence(t, step), operationLabel(t, step), operationBadge(t, step), lineLabel(t, step)];
    });
    expect(words).toEqual([
      ['Squash-fold the flap.', 'Squash fold', 'Squash', null],
      ['Petal-fold the flap.', 'Petal fold', 'Petal', null],
      ['Rabbit-ear the triangle.', 'Rabbit ear', 'Rabbit ear', null],
      ['Swivel-fold the paper about the point.', 'Swivel fold', 'Swivel', null],
    ]);
  });

  it('say a mountain vertex fold folds the paper behind, in a sentence and a name of its own', () => {
    const words = FOLD_VERTEX_OP_KINDS.map((fold) => {
      const step = { op: 'vertex', fold, direction: 'mountain' } as const;
      return [foldStepSentence(t, step), operationLabel(t, step), operationBadge(t, step)];
    });
    expect(words).toEqual([
      ['Squash-fold the flap behind.', 'Squash fold behind', 'Squash'],
      ['Petal-fold the flap behind.', 'Petal fold behind', 'Petal'],
      ['Rabbit-ear the triangle behind.', 'Rabbit ear behind', 'Rabbit ear'],
      ['Swivel-fold the paper behind, about the point.', 'Swivel fold behind', 'Swivel'],
    ]);
  });

  it('say a swivel by its valley and mountain as folders do: toward the viewer, its kind and its construction', () => {
    const context = { paper: { kind: 'square' }, marks: [] } as unknown as Parameters<typeof foldSentenceStepOf>[1];
    const lines = { valley: { line: { via: 'crease' as const, at: [0.3, 0.6] as const } }, mountain: { line: { via: 'crease' as const, at: [0.2, 0.7] as const } } };
    const open = foldSentenceStepOf({ kind: 'swivel', via: 'valley-mountain', ...lines }, context);
    const inside = foldSentenceStepOf({ kind: 'swivel', via: 'valley-mountain', ...lines, swivel: 'inside' }, context);
    expect(open).toEqual({ op: 'vertex', fold: 'swivel', direction: 'valley', form: { swivel: 'valley-mountain' } });
    expect([foldStepSentence(t, open), operationLabel(t, open), operationBadge(t, open)]).toEqual([
      'Swivel-fold the flap along the valley and the mountain.',
      'Swivel fold',
      'Swivel',
    ]);
    expect([foldStepSentence(t, inside), operationLabel(t, inside), operationBadge(t, inside)]).toEqual([
      'Inside-swivel the flap along the valley and the mountain.',
      'Inside swivel',
      'Inside swivel',
    ]);
    if (open.op !== 'vertex' || inside.op !== 'vertex') throw new Error('no vertex fold');
    expect(vertexRows(t, open.form).map((row) => [row.label, row.value])).toEqual([
      ['Construction', 'Valley and mountain'],
      ['Kind', 'Open'],
    ]);
    expect(vertexRows(t, inside.form).map((row) => row.value)).toEqual(['Valley and mountain', 'Inside']);
  });

  it('come from the stored op, its direction kept', () => {
    const context = { paper: { kind: 'square' }, marks: [] } as unknown as Parameters<typeof foldSentenceStepOf>[1];
    expect(foldSentenceStepOf({ kind: 'squash', flap: [0.2, 0.1], direction: 'mountain' }, context)).toEqual({
      op: 'vertex',
      fold: 'squash',
      direction: 'mountain',
    });
  });

  it('say how a petal fold named its hinge: a crease there, or two points the fold creases', () => {
    const context = { paper: { kind: 'square' }, marks: [] } as unknown as Parameters<typeof foldSentenceStepOf>[1];
    const byCrease = foldSentenceStepOf({ kind: 'petal', crease: [0.3, 0.6], petal: [0.2, 0.7], direction: 'valley' }, context);
    const byEnds = foldSentenceStepOf(
      { kind: 'petal', ends: [[0.2, 0.5], [0.5, 0.8]], petal: [0.2, 0.7], direction: 'valley' },
      context
    );
    expect(byCrease).toEqual({ op: 'vertex', fold: 'petal', direction: 'valley', form: { hinge: 'crease' } });
    expect(foldStepSentence(t, byCrease)).toBe('Petal-fold the flap.');
    expect(foldStepSentence(t, byEnds)).toBe('Petal-fold the flap, creasing its hinge as it lifts.');
    expect(foldStepSentence(t, { ...byEnds, direction: 'mountain' } as typeof byEnds)).toBe(
      'Petal-fold the flap behind, creasing its hinge as it lifts.'
    );
    if (byEnds.op !== 'vertex' || byCrease.op !== 'vertex') throw new Error('no vertex fold');
    expect(vertexRows(t, byCrease.form)).toMatchObject([{ label: 'Hinge', value: 'Existing crease' }]);
    expect(vertexRows(t, byEnds.form)).toMatchObject([{ label: 'Hinge', value: 'Two points, creased by the fold' }]);
  });

  it('say a swivel by its edge lays the edge on its target about its pivot, with its target and ridge as rows', () => {
    const context = { paper: { kind: 'square' }, marks: [] } as unknown as Parameters<typeof foldSentenceStepOf>[1];
    const edge = {
      kind: 'swivel' as const,
      via: 'edge' as const,
      pivot: [0.8, 0.3] as const,
      edge: [0.5, 0] as const,
      target: { via: 'crease' as const, at: [0.5, 0.5] as const },
      seed: { scope: 'all' as const },
      direction: 'valley' as const,
    };
    const onCrease = foldSentenceStepOf(edge, context);
    expect(onCrease).toEqual({
      op: 'vertex',
      fold: 'swivel',
      direction: 'valley',
      form: { swivel: 'edge', target: 'crease', ridge: 'foot' },
    });
    expect(foldStepSentence(t, onCrease)).toBe('Swivel the edge onto the crease, pivoting at the point.');
    const onLine = foldSentenceStepOf(
      { ...edge, target: { via: 'free', through: [[0, 0], [1, 1]] }, ridge: [0.5, -0.5], direction: 'mountain' },
      context
    );
    expect(foldStepSentence(t, onLine)).toBe('Swivel the edge behind onto the line, pivoting at the point.');
    if (onLine.op !== 'vertex') throw new Error('no vertex fold');
    expect(vertexRows(t, onLine.form)).toMatchObject([
      { label: 'Lands on', value: 'Line through two points' },
      { label: 'Ridge', value: 'Toward the edge’s end' },
    ]);
    // By its rays, as before: its sentence, and no rows.
    const rays = foldSentenceStepOf(
      {
        kind: 'swivel',
        vertex: [0.5, 0.3],
        toward: [[1, 0.6], [0, 0.6], [0.5, 0]],
        emergent: [0, 1],
        seed: { scope: 'all' },
        stayer: [0.1, 0.1],
        direction: 'valley',
      },
      context
    );
    expect(foldStepSentence(t, rays)).toBe('Swivel-fold the paper about the point.');
    if (rays.op !== 'vertex') throw new Error('no vertex fold');
    expect(vertexRows(t, rays.form)).toEqual([]);
  });

  it('say a swivel on a folded edge meets its creases there, with its target and where they meet as rows', () => {
    const context = { paper: { kind: 'square' }, marks: [] } as unknown as Parameters<typeof foldSentenceStepOf>[1];
    const onFold = {
      kind: 'swivel' as const,
      via: 'edge' as const,
      fold: [0.75, 0.6] as const,
      edge: [1, 0.85] as const,
      target: { via: 'crease' as const, at: [0.75, 0.5] as const },
      direction: 'valley' as const,
    };
    const step = foldSentenceStepOf(onFold, context);
    expect(step).toEqual({ op: 'vertex', fold: 'swivel', direction: 'valley', form: { swivel: 'fold', target: 'crease' } });
    expect(foldStepSentence(t, step)).toBe('Swivel the edge onto the crease, the creases meeting on the folded edge.');
    if (step.op !== 'vertex') throw new Error('no vertex fold');
    expect(vertexRows(t, step.form)).toMatchObject([
      { label: 'Lands on', value: 'Existing crease or edge' },
      { label: 'Creases meet', value: 'On a folded edge' },
      { label: 'Kind', value: 'Open' },
    ]);
    const behind = foldSentenceStepOf(
      { ...onFold, target: { via: 'free', through: [[0, 0], [1, 1]] }, direction: 'mountain' },
      context
    );
    expect(foldStepSentence(t, behind)).toBe('Swivel the edge behind onto the line, the creases meeting on the folded edge.');
  });

  it('say an inside swivel tucks its strip: its sentence, name, badge and Kind row', () => {
    const context = { paper: { kind: 'square' }, marks: [] } as unknown as Parameters<typeof foldSentenceStepOf>[1];
    const inside = {
      kind: 'swivel' as const,
      via: 'edge' as const,
      fold: [0.75, 0.6] as const,
      edge: [1, 0.85] as const,
      target: { via: 'crease' as const, at: [0.75, 0.5] as const },
      direction: 'valley' as const,
      swivel: 'inside' as const,
    };
    const step = foldSentenceStepOf(inside, context);
    expect(step).toEqual({
      op: 'vertex',
      fold: 'swivel',
      direction: 'valley',
      form: { swivel: 'fold', target: 'crease', inside: true },
    });
    expect(foldStepSentence(t, step)).toBe('Inside-swivel the edge onto the crease, the creases meeting on the folded edge.');
    expect(operationLabel(t, step)).toBe('Inside swivel');
    expect(operationBadge(t, step)).toBe('Inside swivel');
    if (step.op !== 'vertex') throw new Error('no vertex fold');
    expect(vertexRows(t, step.form)[2]).toMatchObject({ label: 'Kind', value: 'Inside' });
    const behind = foldSentenceStepOf(
      { ...inside, target: { via: 'free', through: [[0, 0], [1, 1]] }, direction: 'mountain' },
      context
    );
    expect(foldStepSentence(t, behind)).toBe('Inside-swivel the edge behind onto the line, the creases meeting on the folded edge.');
    expect(operationLabel(t, behind)).toBe('Inside swivel behind');
  });
});
