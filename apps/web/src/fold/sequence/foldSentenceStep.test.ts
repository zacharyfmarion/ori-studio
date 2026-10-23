import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import type { FoldLockedStep, FoldPlainOp } from '../document/foldSequenceDocument';
import { foldedLineOf } from '../engine/foldEngineCompoundWire';
import type { FoldReport } from '../engine/foldEngineWire';
import { foldStepSentence } from '../stepSentence';
import { operationBadge, operationLabel } from '../stepWords';
import { diagonalHalfScene, squareScene } from './foldScene.fixtures';
import { foldNodeSentenceStep, foldSentenceStepOf, foldsInHalf, movingInputs, referenceOf } from './foldSentenceStep';
import { foldStateFrame } from './foldStateFrame';

const t = i18n.t.bind(i18n);
const square = foldStateFrame(squareScene());
const half = foldStateFrame(diagonalHalfScene());

/** The diagonal fold's report: the line `y = x`, its top-left side (`n · p < d`) moving. */
const DIAGONAL: FoldReport = {
  line: { n: [Math.SQRT1_2, -Math.SQRT1_2], d: 0 },
  side: 'negative',
  snap: { clusters: 0, angle: 0, max_shift: 0 },
  direction: 'valley',
  flaps: [],
  picked: [],
  added: [],
  moving: [0],
  moving_faces: [1],
  created: [4],
  unfolded: [],
  refolded: [],
  split: 1,
};

/** The top-left corner onto the bottom-right, through all layers: O2 in the crate's order, mover first. */
const CORNER_TO_CORNER: FoldPlainOp = {
  kind: 'valley',
  line: {
    via: 'axiom',
    axiom: 2,
    inputs: [
      { kind: 'point', at: [1, 0] },
      { kind: 'point', at: [0, 1] },
    ],
  },
  seed: { scope: 'all' },
};

describe('a stored step as its sentence reads it', () => {
  it('names the input that moves first, the sheet’s corners by compass, and a half fold as one', () => {
    const words = foldSentenceStepOf(CORNER_TO_CORNER, { parent: square, child: half, report: DIAGONAL });
    expect(words).toEqual({
      op: 'fold',
      direction: 'valley',
      line: {
        via: 'axiom',
        axiom: 2,
        inputs: [
          { kind: 'corner', corner: 'se' },
          { kind: 'corner', corner: 'nw' },
        ],
        moving: [1],
        inHalf: true,
      },
      scope: { kind: 'all' },
    });
    expect(foldStepSentence(t, words)).toBe(
      'Valley fold in half, bringing the top-left corner onto the bottom-right corner, through all layers.'
    );
  });

  it('says nothing it does not know: no movers before the engine has said, no half without both areas', () => {
    expect(movingInputs(CORNER_TO_CORNER.line.via === 'axiom' ? CORNER_TO_CORNER.line.inputs : [], { parent: square, child: null, report: null })).toEqual([]);
    expect(foldsInHalf({ parent: square, child: null, report: DIAGONAL })).toBe(false);
    const words = foldSentenceStepOf(CORNER_TO_CORNER, { parent: null, child: null, report: null });
    expect(words).toMatchObject({ line: { inputs: [{ kind: 'point' }, { kind: 'point' }] } });
    expect(words.op === 'fold' && words.line.via === 'axiom' && words.line.inHalf).toBeFalsy();
  });

  it('names by letter what is not the silhouette’s own, or lies on one that is no rectangle', () => {
    expect(referenceOf({ kind: 'point', at: [0.5, 0.5] }, square)).toEqual({ kind: 'point' });
    expect(referenceOf({ kind: 'mark', at: [0, 0], mark: 'fmark-1' }, square)).toEqual({ kind: 'point' });
    expect(referenceOf({ kind: 'point', at: [0, 0] }, half)).toEqual({ kind: 'point' });
    expect(referenceOf({ kind: 'edge', a: [0, 0], b: [1, 0] }, square)).toEqual({ kind: 'edge', side: 'bottom' });
    expect(referenceOf({ kind: 'edge', a: [0, 1], b: [1, 0] }, square)).toEqual({ kind: 'diagonal', diagonal: 'nw_se' });
    expect(referenceOf({ kind: 'edge', a: [0, 0], b: [0.5, 0] }, square)).toEqual({ kind: 'line' });
  });

  it('reads every other kind of step', () => {
    const none = { parent: null, child: null, report: null };
    expect(foldSentenceStepOf({ kind: 'turn', axis: 'vertical' }, none)).toEqual({
      op: 'turn',
      turn: { kind: 'turn-over', axis: 'vertical' },
    });
    expect(
      foldSentenceStepOf(
        { kind: 'refold', crease: [0.5, 0.5], direction: 'mountain', seed: { scope: 'depth', at: [0.5, 0.5], layers: 2 } },
        none
      )
    ).toEqual({ op: 'fold', direction: 'mountain', line: { via: 'crease' }, scope: { kind: 'depth', layers: 2 } });
    expect(
      foldSentenceStepOf({ kind: 'unfold', crease: [0.5, 0.5], direction: 'valley', seed: { scope: 'flaps', at: [[0.1, 0.1]] } }, none)
    ).toEqual({ op: 'unfold', direction: 'valley', scope: { kind: 'flaps', flaps: 1 } });
    expect(
      foldSentenceStepOf(
        { kind: 'precrease', direction: 'valley', line: { via: 'free', through: [[0, 0], [1, 1]] }, seed: { scope: 'all' } },
        none
      )
    ).toEqual({ op: 'precrease', direction: 'valley', line: { via: 'free' }, scope: { kind: 'all' } });
    expect(foldSentenceStepOf({ kind: 'cp-jump', cpJson: '{}', orderJson: '{}', origin: 'cp' }, none)).toEqual({ op: 'cp-jump' });
    const line = { via: 'free', through: [[0, 0.5], [1, 0.5]] } as const;
    // A crimp names both its lines — its second by how it was found, a crease or drawn — and the layers it takes.
    expect(
      foldSentenceStepOf({ kind: 'crimp', line, second: line, crimp: 'outside', seed: { scope: 'all' } }, none)
    ).toEqual({ op: 'crimp', crimp: 'outside', line: { via: 'free' }, second: 'free', scope: { kind: 'all' } });
    expect(
      foldSentenceStepOf(
        {
          kind: 'crimp',
          line,
          second: { via: 'crease', at: [0.5, 0.3] },
          crimp: 'inside',
          seed: { scope: 'depth', at: [0.5, 0.75], layers: 2 },
        },
        none
      )
    ).toEqual({ op: 'crimp', crimp: 'inside', line: { via: 'free' }, second: 'crease', scope: { kind: 'depth', layers: 2 } });
    expect(
      foldSentenceStepOf({ kind: 'tuck', line, direction: 'mountain', seed: { scope: 'all' }, target: [0.5, 0.5] }, none)
    ).toEqual({ op: 'tuck', direction: 'mountain', line: { via: 'free' } });
    const locked: FoldLockedStep = { id: 'l', parent: null, unknown: { op: { kind: 'sink' } } };
    expect(foldNodeSentenceStep(locked, none)).toEqual({ op: 'unknown' });
  });

  it('names a partial precrease’s points as an axiom’s inputs are named', () => {
    const op = {
      kind: 'precrease' as const,
      direction: 'valley' as const,
      line: { via: 'free' as const, through: [[0.5, 0], [0.5, 1]] as [[number, number], [number, number]] },
      moving: [0.75, 0.5] as [number, number],
      seed: { scope: 'all' as const },
    };
    const none = { parent: square, child: null, report: null };
    expect(
      foldSentenceStepOf({ ...op, extent: { kind: 'pinch', at: { kind: 'point', at: [0.5, 0.5] }, length: 1 / 16 } }, none)
    ).toEqual({
      op: 'precrease',
      direction: 'valley',
      line: { via: 'free' },
      scope: { kind: 'all' },
      extent: { kind: 'pinch', at: { kind: 'point' } },
    });
    // A segment from the sheet's corner: named by description, as an axiom's corner is.
    const segment = foldSentenceStepOf(
      {
        ...op,
        extent: { kind: 'segment', from: { kind: 'point', at: [0, 0] }, to: { kind: 'mark', at: [0.5, 0.5], mark: 'fmark-1' } },
      },
      none
    );
    expect(segment).toMatchObject({ extent: { kind: 'segment', from: { kind: 'corner', corner: 'sw' }, to: { kind: 'point' } } });
    expect(foldStepSentence(t, segment)).toBe(
      'Valley fold and unfold along the line drawn, through all layers. Crease only the stretch from the bottom-left corner to point Q.'
    );
    // The whole line says nothing of an extent.
    expect(foldSentenceStepOf(op, none)).not.toHaveProperty('extent');
  });

  it('reads a fold along a bend that only laid its flap flat as the unfold it was, as the engine reported it', () => {
    // The Valley tool along a folded edge, the top flap taken: stored as a valley fold (plan D3).
    const along: FoldPlainOp = {
      kind: 'valley',
      landing: { kind: 'outer' },
      line: { via: 'crease', at: [0.5, 0.5] },
      seed: { scope: 'depth', at: [0.25, 0.75], layers: 1 },
    };
    const unfolded = { ...DIAGONAL, created: [], unfolded: [3], refolded: [] };
    const words = foldSentenceStepOf(along, { parent: half, child: square, report: foldedLineOf({ report: unfolded }) });
    expect(words).toEqual({ op: 'unfold', direction: 'valley', scope: { kind: 'depth', layers: 1 } });
    expect(foldStepSentence(t, words)).toBe('Unfold the top layer.');
    expect(operationLabel(t, words)).toBe('Unfold');
    expect(operationBadge(t, words)).toBe('Unfold');
    // A fold that also made a crease, or refolded a flat one, is the fold it says.
    for (const report of [
      { ...unfolded, created: [5] },
      { ...unfolded, refolded: [{ edge: 2, remembered: 'valley' as const, letter: 'valley' as const }] },
      { ...unfolded, unfolded: [] },
    ]) {
      expect(foldSentenceStepOf(along, { parent: half, child: square, report: foldedLineOf({ report }) })).toMatchObject({ op: 'fold' });
    }
    // Before the engine has said, it reads as stored.
    expect(foldSentenceStepOf(along, { parent: half, child: null, report: null })).toMatchObject({ op: 'fold' });
  });

  it('reads a line a tool gives in the model frame as one the user placed', () => {
    expect(
      foldSentenceStepOf(
        { kind: 'mountain', line: { via: 'model', line: { n: [0, 1], d: 0.5 } }, side: 'positive', seed: { scope: 'all' } },
        { parent: square, child: null, report: null }
      )
    ).toMatchObject({ line: { via: 'free' } });
  });
});
