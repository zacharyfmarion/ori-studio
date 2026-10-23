import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import type { FoldOp, FoldPrecreaseOp, FoldRef } from '../document/foldSequenceDocument';
import { foldSentenceStepOf } from '../sequence/foldSentenceStep';
import { foldStateFrame } from '../sequence/foldStateFrame';
import { foldStepSentence } from '../stepSentence';
import { bookScene, flatSquareScene } from './foldCanvas.fixtures';
import { foldStepLetters } from './foldStepLetters';

const t = i18n.t.bind(i18n);

const point = (x: number, y: number): FoldRef => ({ kind: 'point', at: [x, y] });
const pointOnto = (inputs: FoldRef[]): FoldOp => ({
  kind: 'valley',
  line: { via: 'axiom', axiom: 2, inputs },
  seed: { scope: 'all' },
});

const round = ({ x, y }: { x: number; y: number }) => [Math.round(x * 1e9) / 1e9, Math.round(y * 1e9) / 1e9];

describe('the letters on the folded pane', () => {
  const sheet = flatSquareScene();
  const parent = foldStateFrame(sheet);

  it('letter what the sentence names by letter, as the sentence letters it', () => {
    // The bottom edge's middle onto the top edge's: points, not corners.
    const op = pointOnto([point(0.5, 0), point(0.5, 1)]);
    const letters = foldStepLetters(op, parent, sheet);
    expect(letters.map(({ letter, kind }) => [letter, kind])).toEqual([
      ['P', 'point'],
      ['Q', 'point'],
    ]);
    expect(letters.map(({ at }) => round(at))).toEqual([
      [0.5, 0],
      [0.5, 1],
    ]);
    // The picture and the sentence: every letter on one is in the other.
    const sentence = foldStepSentence(t, foldSentenceStepOf(op, { parent, child: null, report: null }));
    for (const { letter } of letters) expect(sentence).toContain(`point ${letter}`);
  });

  it('sit where the pane draws their points: a spread pane’s, through `place`', () => {
    const op = pointOnto([point(0.5, 0), point(0.5, 1)]);
    const moved = foldStepLetters(op, parent, sheet, ([x, y]) => ({ x: x + 0.03, y: y - 0.01 }));
    expect(moved.map(({ at }) => round(at))).toEqual([
      [0.53, -0.01],
      [0.53, 0.99],
    ]);
  });

  it('leave the sheet’s own corners to the sentence, which names them by description', () => {
    const op = pointOnto([point(1, 0), point(0, 1)]);
    expect(foldStepLetters(op, parent, sheet)).toEqual([]);
    expect(foldStepSentence(t, foldSentenceStepOf(op, { parent, child: null, report: null }))).toContain(
      'bottom-right corner'
    );
    // Without the frame the sentence names them by letter too, and so does the pane.
    expect(foldStepLetters(op, null, sheet).map(({ letter }) => letter)).toEqual(['P', 'Q']);
  });

  it('letter a line on itself, and a mark as a point', () => {
    const op: FoldOp = {
      kind: 'valley',
      line: {
        via: 'axiom',
        axiom: 5,
        inputs: [{ kind: 'mark', at: [0.25, 0], mark: 'fmark-1' }, point(0.5, 0.5), { kind: 'edge', a: [0, 0.25], b: [1, 0.75] }],
      },
      seed: { scope: 'all' },
    };
    const letters = foldStepLetters(op, parent, sheet);
    expect(letters.map(({ letter, kind }) => [letter, kind])).toEqual([
      ['P', 'point'],
      ['Q', 'point'],
      ['A', 'line'],
    ]);
    // The line's letter stands on its middle.
    expect(round(letters[2]!.at)).toEqual([0.5, 0.5]);
  });

  it('show a landed step’s references where it put them: the point brought onto the other', () => {
    // The book fold, its right half brought over: (0.75, 0.2) onto (0.25, 0.2).
    const op = pointOnto([point(0.75, 0.2), point(0.25, 0.2)]);
    const letters = foldStepLetters(op, parent, bookScene());
    expect(letters.map(({ letter }) => letter)).toEqual(['P', 'Q']);
    expect(round(letters[0]!.at)).toEqual(round(letters[1]!.at));
  });

  it('have nothing to letter for a line not found by an axiom', () => {
    const free: FoldOp = { kind: 'valley', line: { via: 'free', through: [[0.5, 0], [0.5, 1]] }, seed: { scope: 'all' } };
    expect(foldStepLetters(free, parent, sheet)).toEqual([]);
    expect(foldStepLetters({ kind: 'turn', axis: 'vertical' }, parent, sheet)).toEqual([]);
  });

  it('letter a partial precrease’s points after the line’s, as its sentence does', () => {
    const pinch: FoldPrecreaseOp = {
      kind: 'precrease',
      direction: 'valley',
      line: { via: 'axiom', axiom: 2, inputs: [point(0.5, 0), point(0.5, 1)] },
      seed: { scope: 'all' },
      extent: { kind: 'pinch', at: { kind: 'point', at: [0.25, 0.5] }, length: 1 / 16 },
    };
    const letters = foldStepLetters(pinch, parent, sheet);
    expect(letters.map(({ letter }) => letter)).toEqual(['P', 'Q', 'R']);
    expect(round(letters[2]!.at)).toEqual([0.25, 0.5]);
    const sentence = foldStepSentence(t, foldSentenceStepOf(pinch, { parent, child: null, report: null }));
    expect(sentence).toContain('a short pinch at point R');
    // Along a free line, the pinch alone is lettered.
    const free: FoldPrecreaseOp = { ...pinch, line: { via: 'free', through: [[0, 0.5], [1, 0.5]] } };
    expect(foldStepLetters(free, parent, sheet).map(({ letter }) => letter)).toEqual(['P']);
  });
});
