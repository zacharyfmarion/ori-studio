/**
 * Small Fold sequences for the document modules' tests: ids that are the same
 * on every run, steps built in one line, and one file value that holds every
 * op kind, choice and mark this build reads, in the order it writes them.
 */

import { builtInPaperPreset } from '../../lib/paper/paperPresets';
import {
  FOLD_DEFAULT_PAPER_STYLE,
  FOLD_SEQUENCE_FORMAT_VERSION,
  SQUARE_PAPER,
  type FoldIdFactory,
  type FoldOp,
  type FoldPaper,
  type FoldPlainOp,
  type FoldSequenceDocument,
  type FoldStep,
  type FoldStepNode,
} from './foldSequenceDocument';

/** `fold-1`, `fstep-2`, …: one counter across prefixes. */
export function sequentialIds(): FoldIdFactory {
  let next = 0;
  return (prefix) => `${prefix}-${(next += 1)}`;
}

/** A valley through all layers along the free horizontal line at `y`, the part above it moving. */
export function valleyAt(y: number): FoldPlainOp {
  return {
    kind: 'valley',
    line: { via: 'free', through: [[0, y], [1, y]] },
    moving: [0.5, (1 + y) / 2],
    seed: { scope: 'all' },
  };
}

export function step(id: string, parent: string | null, op: FoldOp = valleyAt(0.5), rest: Partial<FoldStep> = {}): FoldStep {
  return { id, parent, op, ...rest };
}

export function sequenceOf(
  steps: readonly FoldStepNode[],
  paper: FoldPaper = SQUARE_PAPER,
  id = 'fold-a'
): FoldSequenceDocument {
  return { formatVersion: FOLD_SEQUENCE_FORMAT_VERSION, id, title: 'Test', paper, style: FOLD_DEFAULT_PAPER_STYLE, steps };
}

/**
 * A sequence as this build writes one — every key in its written order — so
 * reading it and writing it back gives the same JSON, byte for byte.
 */
export function writtenSequence(): Record<string, unknown> {
  return {
    formatVersion: 1,
    id: 'fold-full',
    title: 'Every kind',
    paper: { shape: { kind: 'rectangle', aspect: [1, 0.5] }, startSide: 'back' },
    style: { preset: 'default', style: builtInPaperPreset('default').style },
    appearance: { front: '#336699' },
    sheetMarks: [{ id: 'fmark-1', from: [0, 0], to: [1, 0], divide: { mode: 'count', parts: 3 } }],
    steps: [
      {
        id: 'fstep-1',
        parent: null,
        op: {
          kind: 'valley',
          line: {
            via: 'axiom',
            axiom: 2,
            inputs: [
              { kind: 'point', at: [0, 0] },
              { kind: 'mark', at: [1 / 3, 0], mark: 'fmark-1' },
            ],
          },
          moving: [0.1, 0.05],
          seed: { scope: 'all' },
        },
        choices: { root: { n: [1, 0], d: 1 / 6 } },
        expect: 'fs1:0123456789abcdef',
        note: 'Bring the corner to the mark.',
        marks: [
          {
            id: 'fmark-2',
            from: [0, 0.5],
            to: [1, 0.5],
            divide: { mode: 'ratio', ratio: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 2 } },
          },
        ],
        spread: { kind: 'affine', amount: 0.05, keep: 'bottom', skew: 0.5, axisDeg: 30 },
      },
      {
        id: 'fstep-2',
        parent: 'fstep-1',
        op: {
          kind: 'mountain',
          line: {
            via: 'axiom',
            axiom: 5,
            inputs: [
              { kind: 'point', at: [0, 0.5] },
              { kind: 'point', at: [1, 0] },
              { kind: 'edge', a: [0, 0], b: [1, 0] },
            ],
          },
          seed: { scope: 'depth', at: [0.9, 0.1], layers: 2 },
        },
        choices: {
          root: { n: [0.6, 0.8], d: 0.4 },
          completion: {
            faces: [
              [0.2, 0.2],
              [0.8, 0.3],
              [0.5, 0.9],
            ],
            orders: [
              [0, 1, 1],
              [2, 1, -1],
            ],
          },
          pocket: [
            [0.1, 0.1],
            [0.2, 0.2],
          ],
          opening: [{ upper: [[0.3, 0.3]] }],
        },
        spread: 'off',
      },
      {
        id: 'fstep-3',
        parent: 'fstep-1',
        op: {
          kind: 'precrease',
          line: { via: 'crease', at: [0.5, 0.25] },
          direction: 'mountain',
          seed: { scope: 'flaps', at: [[0.7, 0.1]] },
        },
      },
      {
        id: 'fstep-4',
        parent: 'fstep-3',
        op: { kind: 'refold', crease: [0.5, 0.25], direction: 'valley', moving: [0.5, 0.4], seed: { scope: 'all' } },
      },
      {
        id: 'fstep-5',
        parent: 'fstep-4',
        op: { kind: 'unfold', crease: [0.5, 0.25], direction: 'valley', seed: { scope: 'flaps', at: [[0.5, 0.4]] } },
      },
      { id: 'fstep-6', parent: 'fstep-5', op: { kind: 'turn', axis: 'vertical' } },
      { id: 'fstep-7', parent: 'fstep-6', op: { kind: 'rotate', rotate: { amount: 'quarter', direction: 'ccw' } } },
      {
        id: 'fstep-8',
        parent: 'fstep-7',
        op: { kind: 'cp-jump', cpJson: '{"vertices_coords":[]}', orderJson: '[]', origin: 'sample' },
      },
      {
        id: 'fstep-9',
        parent: 'fstep-8',
        op: {
          kind: 'valley',
          line: { via: 'free', through: [[0, 0.25], [1, 0.25]] },
          moving: [0.5, 0.4],
          seed: { scope: 'all' },
        },
      },
      // Compound folds (plan D4), one block per family.
      {
        id: 'fstep-10',
        parent: 'fstep-9',
        op: {
          kind: 'inside-reverse',
          line: { via: 'free', through: [[0.6, 0.1], [0.9, 0.2]] },
          moving: [0.9, 0.05],
          seed: { scope: 'all' },
        },
        choices: {
          completion: {
            faces: [
              [0.8, 0.1],
              [0.7, 0.3],
            ],
            orders: [[1, 0, 1]],
          },
          opening: [{ upper: [[0.85, 0.12]] }],
        },
      },
      {
        id: 'fstep-11',
        parent: 'fstep-10',
        op: { kind: 'outside-reverse', line: { via: 'crease', at: [0.5, 0.25] }, seed: { scope: 'flaps', at: [[0.4, 0.2]] } },
      },
      {
        id: 'fstep-12',
        parent: 'fstep-9',
        op: {
          kind: 'crimp',
          line: { via: 'crease', at: [0.3, 0.1] },
          second: { via: 'free', through: [[0, 0.2], [1, 0.3]] },
          crimp: 'outside',
          moving: [0.8, 0.1],
          seed: { scope: 'flaps', at: [[0.8, 0.1]] },
        },
        choices: {
          completion: {
            faces: [
              [0.8, 0.1],
              [0.7, 0.2],
            ],
            orders: [[1, 0, -1]],
          },
          opening: [{ upper: [[0.75, 0.15]] }],
        },
      },
      {
        id: 'fstep-13',
        parent: 'fstep-9',
        op: {
          kind: 'tuck',
          line: { via: 'free', through: [[0, 0.3], [0.3, 0]] },
          direction: 'mountain',
          moving: [0.05, 0.05],
          seed: { scope: 'flaps', at: [[0.05, 0.05]] },
          target: [0.75, 0.5],
        },
      },
      // The vertex folds, each with its optional direction where it has one.
      {
        id: 'fstep-14',
        parent: 'fstep-9',
        op: { kind: 'squash', flap: [0.1, 0.4], target: [-1, 0.5], direction: 'valley' },
      },
      {
        id: 'fstep-15',
        parent: 'fstep-14',
        op: { kind: 'petal', crease: [0.3, 0.2], petal: [0.25, 0.1], direction: 'valley' },
        choices: {
          completion: {
            faces: [
              [0.3, 0.1],
              [0.6, 0.1],
            ],
            orders: [[0, 1, 1]],
          },
        },
      },
      {
        id: 'fstep-16',
        parent: 'fstep-15',
        op: {
          kind: 'rabbit-ear',
          corners: [
            [0, 0],
            [1, 0],
            [0, 0.5],
          ],
          emergent: [-1, 0],
          seed: { scope: 'depth', at: [0.2, 0.1], layers: 1 },
          stayer: [0.8, 0.4],
          direction: 'mountain',
          ridge: [0, -1],
        },
      },
      {
        id: 'fstep-17',
        parent: 'fstep-16',
        op: {
          kind: 'swivel',
          vertex: [0.5, 0.2],
          toward: [
            [1, 0.4],
            [0, 0.4],
            [0.5, 0],
          ],
          emergent: [0, 1],
          seed: { scope: 'all' },
          stayer: [0.3, 0.45],
          direction: 'valley',
        },
      },
      // Sinks.
      {
        id: 'fstep-18',
        parent: 'fstep-8',
        op: {
          kind: 'open-sink',
          line: { via: 'free', through: [[0.35, 0.35], [0.2, 0.5]] },
          seed: { scope: 'flaps', at: [[0.4, 0.45]] },
        },
      },
      {
        id: 'fstep-19',
        parent: 'fstep-8',
        op: {
          kind: 'closed-sink',
          line: { via: 'free', through: [[0.35, 0.35], [0.2, 0.5]] },
          moving: [0.45, 0.45],
          seed: { scope: 'all' },
        },
        choices: {
          completion: {
            faces: [
              [0.4, 0.45],
              [0.6, 0.45],
            ],
            orders: [[1, 0, 1]],
          },
          pocket: [
            [0.15, 0.4],
            [0.15, 0.6],
          ],
        },
      },
      {
        id: 'fstep-20',
        parent: 'fstep-18',
        op: {
          kind: 'unsink',
          line: { via: 'crease', at: [0.275, 0.425] },
          seed: { scope: 'flaps', at: [[0.4, 0.45]] },
        },
      },
      // Partial precreases: a pinch, and a segment from a mark to a point.
      {
        id: 'fstep-21',
        parent: 'fstep-9',
        op: {
          kind: 'precrease',
          line: { via: 'free', through: [[0.5, 0], [0.5, 0.5]] },
          direction: 'valley',
          moving: [0.75, 0.25],
          seed: { scope: 'all' },
          extent: { kind: 'pinch', at: { kind: 'point', at: [0.5, 0.25] }, length: 0.03125 },
        },
      },
      {
        id: 'fstep-22',
        parent: 'fstep-21',
        op: {
          kind: 'precrease',
          line: {
            via: 'axiom',
            axiom: 1,
            inputs: [
              { kind: 'point', at: [0, 0] },
              { kind: 'point', at: [1, 0.5] },
            ],
          },
          direction: 'mountain',
          seed: { scope: 'flaps', at: [[0.9, 0.1]] },
          extent: {
            kind: 'segment',
            from: { kind: 'mark', at: [1 / 3, 1 / 6], mark: 'fmark-1' },
            to: { kind: 'point', at: [0.8, 0.4] },
          },
        },
        choices: { root: { n: [0.4472135954999579, -0.8944271909999159], d: 0 } },
      },
      // A petal fold whose H is named by its two ends, which it creases.
      {
        id: 'fstep-23',
        parent: 'fstep-14',
        op: {
          kind: 'petal',
          ends: [
            [0.2, 0.5],
            [0.5, 0.2],
          ],
          petal: [0.25, 0.1],
          direction: 'mountain',
        },
      },
      {
        id: 'fstep-24', parent: 'fstep-23',
        op: { kind: 'unfold-to', target: null,
          source: { path: 'fh1:source', state: 'fs1:source', targetState: 'fs1:sheet' } },
      },
      {
        id: 'fstep-26', parent: 'fstep-24',
        op: { kind: 'pleat', line: { via: 'free', through: [[0.5, 0], [0.5, 1]] },
          second: { via: 'free', through: [[0.75, 0], [0.75, 1]] }, moving: [0.9, 0.5], seed: { scope: 'all' },
          resolved: [{ landing: { kind: 'outer' } }, { landing: { kind: 'outer' } }] },
      },
      {
        id: 'fstep-25', parent: 'fstep-24',
        op: { kind: 'repeat', source: { first: 'fstep-24', last: 'fstep-24', revision: 'fh1:source' },
          axis: { n: [1, 0], d: 0.5 }, parentState: 'fs1:source',
          steps: [{ op: { kind: 'turn', axis: 'vertical' }, expect: 'fs1:result', sourceStep: 'fstep-24' }] },
      },
    ],
  };
}
