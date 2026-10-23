import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { foldStepSentence, type FoldSentenceLine, type FoldSentenceStep } from '../../fold/stepSentence';
import { foldDiagramMergedSentence, foldDiagramSentence } from './foldDiagramSentence';

const t = i18n.t.bind(i18n);

const all = { kind: 'all' } as const;
/** Lines found every way a step finds one, each naming points and lines by letter in Fold's strip. */
const LINES: FoldSentenceLine[] = [
  { via: 'free' },
  { via: 'crease' },
  { via: 'axiom', axiom: 1, inputs: [{ kind: 'point' }, { kind: 'point' }] },
  { via: 'axiom', axiom: 2, inputs: [{ kind: 'point' }, { kind: 'point' }], moving: [0] },
  { via: 'axiom', axiom: 3, inputs: [{ kind: 'line' }, { kind: 'line' }], moving: [1] },
  { via: 'axiom', axiom: 5, inputs: [{ kind: 'point' }, { kind: 'point' }, { kind: 'line' }] },
  { via: 'axiom', axiom: 7, inputs: [{ kind: 'point' }, { kind: 'line' }, { kind: 'line' }] },
];

/** Every kind of step, as its instruction in the Diagram reads, for each line it can be found by. */
const CASES: [FoldSentenceStep, string][] = [
  ...LINES.flatMap((line): [FoldSentenceStep, string][] => [
    [{ op: 'fold', direction: 'valley', line, scope: all }, 'Valley fold.'],
    [{ op: 'fold', direction: 'mountain', line, scope: { kind: 'depth', layers: 2 } }, 'Mountain fold.'],
    [{ op: 'precrease', direction: 'valley', line, scope: all }, 'Fold and unfold.'],
    [{ op: 'precrease', direction: 'mountain', line, scope: all }, 'Mountain fold and unfold.'],
    [
      { op: 'precrease', direction: 'valley', line, scope: all, extent: { kind: 'segment', from: { kind: 'point' }, to: { kind: 'point' } } },
      'Fold and unfold.',
    ],
    [{ op: 'precrease', direction: 'valley', line, scope: all, extent: { kind: 'pinch', at: { kind: 'point' } } }, 'Make a pinch.'],
    [{ op: 'reverse', kind: 'inside', line, scope: all }, 'Inside reverse fold.'],
    [{ op: 'reverse', kind: 'outside', line, scope: all }, 'Outside reverse fold.'],
    [{ op: 'crimp', crimp: 'inside', line, second: 'free', scope: all }, 'Inside crimp.'],
    [{ op: 'crimp', crimp: 'outside', line, second: 'crease', scope: all }, 'Outside crimp.'],
    [{ op: 'pleat', line, second: line, scope: all }, 'Pleat.'],
    [{ op: 'tuck', direction: 'valley', line }, 'Valley fold and tuck in.'],
    [{ op: 'tuck', direction: 'mountain', line }, 'Mountain fold and tuck in.'],
    [{ op: 'fold', direction: 'valley', line, scope: all, inserted: true }, 'Valley fold and tuck in.'],
    [{ op: 'sink', kind: 'open', line }, 'Open sink.'],
    [{ op: 'sink', kind: 'closed', line }, 'Closed sink.'],
    [{ op: 'sink', kind: 'unsink', line }, 'Unsink.'],
  ]),
  [{ op: 'unfold', direction: 'valley', scope: all }, 'Unfold.'],
  [{ op: 'vertex', fold: 'squash', direction: 'valley' }, 'Squash fold.'],
  [{ op: 'vertex', fold: 'squash', direction: 'mountain' }, 'Squash fold behind.'],
  [{ op: 'vertex', fold: 'petal', direction: 'valley', form: { hinge: 'points' } }, 'Petal fold.'],
  [{ op: 'vertex', fold: 'petal', direction: 'mountain', form: { hinge: 'crease' } }, 'Petal fold behind.'],
  [{ op: 'vertex', fold: 'rabbit-ear', direction: 'valley' }, 'Rabbit-ear fold.'],
  [{ op: 'vertex', fold: 'rabbit-ear', direction: 'mountain' }, 'Rabbit-ear fold behind.'],
  [{ op: 'vertex', fold: 'swivel', direction: 'valley', form: { swivel: 'edge', target: 'crease', ridge: 'foot' } }, 'Swivel fold.'],
  [{ op: 'vertex', fold: 'swivel', direction: 'mountain', form: { swivel: 'rays' } }, 'Swivel fold behind.'],
  [{ op: 'vertex', fold: 'swivel', direction: 'valley', form: { swivel: 'fold', target: 'free', inside: true } }, 'Inside swivel fold.'],
  [{ op: 'vertex', fold: 'swivel', direction: 'mountain', form: { swivel: 'fold', target: 'crease', inside: true } }, 'Inside swivel fold behind.'],
  // By its valley and mountain, on the layer that faces the viewer: never behind.
  [{ op: 'vertex', fold: 'swivel', direction: 'valley', form: { swivel: 'valley-mountain' } }, 'Swivel fold.'],
  [{ op: 'vertex', fold: 'swivel', direction: 'valley', form: { swivel: 'valley-mountain', inside: true } }, 'Inside swivel fold.'],
  [{ op: 'repeat', count: 1 }, 'Repeat on the other side.'],
  [{ op: 'repeat', count: 3 }, 'Repeat the last 3 steps on the other side.'],
  // Its mirror reversed the layers: the steps were folded on the back.
  [{ op: 'repeat', count: 1, behind: true }, 'Repeat behind.'],
  [{ op: 'repeat', count: 3, behind: true }, 'Repeat the last 3 steps behind.'],
  [{ op: 'unfold-to', sheet: true }, 'Unfold completely.'],
  [{ op: 'unfold-to', sheet: false, number: 4 }, 'Unfold to step 4.'],
  [{ op: 'unfold-to', sheet: false }, 'Unfold.'],
  [{ op: 'cp-jump' }, 'Collapse.'],
  [{ op: 'cp-jump', collapse: true }, 'Collapse.'],
];

describe('a Fold step’s instruction in the Diagram', () => {
  it.each(CASES)('says %j as %s', (step, sentence) => {
    expect(foldDiagramSentence(t, step)).toBe(sentence);
  });

  it('names no letter, where Fold’s strip names the references it draws on its canvas', () => {
    const letters = /\b[A-Z]\b/;
    for (const [step] of CASES) expect(foldDiagramSentence(t, step)).not.toMatch(letters);
    // The strip's own words still name them: this is the Diagram's variant, not a change to the strip.
    const lettered = CASES.filter(([step]) => letters.test(foldStepSentence(t, step)));
    expect(lettered.length).toBeGreaterThan(10);
  });

  it('says a merged precrease and its mirror once, on both sides', () => {
    const line: FoldSentenceLine = { via: 'axiom', axiom: 3, inputs: [{ kind: 'line' }, { kind: 'line' }] };
    const valley: FoldSentenceStep = { op: 'precrease', direction: 'valley', line, scope: all };
    const mountain: FoldSentenceStep = { ...valley, direction: 'mountain' };
    const pinch: FoldSentenceStep = { ...valley, extent: { kind: 'pinch', at: { kind: 'point' } } };
    expect(foldDiagramMergedSentence(t, [valley])).toBe('Fold and unfold on both sides.');
    expect(foldDiagramMergedSentence(t, [valley, valley])).toBe('Fold and unfold on both sides.');
    expect(foldDiagramMergedSentence(t, [mountain])).toBe('Mountain fold and unfold on both sides.');
    expect(foldDiagramMergedSentence(t, [pinch])).toBe('Make a pinch on both sides.');
    expect(foldDiagramMergedSentence(t, [valley, pinch])).toBe('Fold and unfold on both sides. Make a pinch on both sides.');
    expect(foldDiagramMergedSentence(t, [valley, pinch])).not.toMatch(/\b[A-Z]\b/);
    // Only precreases merge today; a fold would be said the same way.
    expect(foldDiagramMergedSentence(t, [{ op: 'fold', direction: 'valley', line, scope: all }])).toBe('Valley fold on both sides.');
    expect(foldDiagramMergedSentence(t, [{ op: 'fold', direction: 'mountain', line, scope: all }])).toBe('Mountain fold on both sides.');
  });
});
