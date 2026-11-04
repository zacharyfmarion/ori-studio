/**
 * The adapter from E7's wire (`engine/layerOrderWire.ts`) to the model's
 * facts: the one file that changes when U6 settles the contract's names.
 */
import { describe, expect, it } from 'vitest';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import {
  SAVED_FACE_AMBIGUOUS,
  SAVED_FACE_GONE,
  SAVED_FACE_INTACT,
  type LayerOpened,
  type LayerRestored,
} from '../engine/layerOrderWire';
import { commitFacts, explainFacts, openFacts, previewFacts, shownFacts, stepFacts } from './layerOrderEngineFacts';

const STACKS = {
  front: { offsets: Uint32Array.of(0, 2, 3), faces: Uint32Array.of(0, 1, 2) },
  back: { offsets: Uint32Array.of(0, 2, 3), faces: Uint32Array.of(1, 0, 2) },
};
const changedSpots = (front: number[]) => ({ front: Uint32Array.from(front), back: new Uint32Array() });
/** The order on screen as `layer_order` packs it, read by the hook after an open, a commit or a step. */
const ORDER = Uint8Array.of(0b101);

const OPENED: LayerOpened = {
  status: 'ok',
  session: 3,
  faces: 7,
  front_up: Uint8Array.of(1, 0, 1, 0, 1, 0, 1),
  open_pairs: Uint32Array.of(0, 2),
  spots: 7,
  opened_on: { kind: 'held', ignored: 0 },
};

describe('the engine’s answers as the model reads them', () => {
  it('an open: the figure, its open pairs, where its order came from, no constraints, and the letters the hook read', () => {
    const letterOrder = [3, 0, 1, 2, 6, 5, 4];
    expect(openFacts(OPENED, STACKS, null, letterOrder, ORDER)).toEqual({
      faces: 7,
      frontUp: OPENED.front_up,
      openPairs: OPENED.open_pairs,
      openedOn: { kind: 'held', ignored: 0 },
      stacks: STACKS,
      order: ORDER,
      constraints: [],
      restore: null,
      letterOrder,
    });
  });

  it('a restore: its constraints, and each carried row’s faces as they are now; a gone face is null', () => {
    const record: LayerOrderRecord = {
      faces: [
        { at: [0, 0], area: 1 },
        { at: [1, 0], area: 1 },
        { at: [2, 0], area: 1 },
      ],
      constraints: [
        [0, 1, 1],
        [2, 1, -1],
      ],
      order: [],
    };
    const restored: LayerRestored = {
      ...OPENED,
      constraints: Int32Array.of(4, 5, -1),
      outcome: { kind: 'applied' },
      saved_faces: {
        status: Uint8Array.of(SAVED_FACE_GONE, SAVED_FACE_INTACT, SAVED_FACE_AMBIGUOUS),
        face: Int32Array.of(-1, 3, 6),
        area: Float64Array.of(Number.NaN, Number.NaN, 0.5),
      },
      saved_constraints: [{ status: 'gone', cause: 'face_gone' }, { status: 'ambiguous' }],
      saved_order: new Uint8Array(),
      carried: [
        {
          status: 'gone',
          cause: 'face_gone',
          index: 0,
          subject: { at: [0, 0], area: 1 },
          object: { at: [1, 0], area: 1 },
          sign: 1,
          constraint: null,
        },
        {
          status: 'ambiguous',
          index: 1,
          subject: { at: [2, 0], area: 1 },
          object: { at: [1, 0], area: 1 },
          sign: -1,
          constraint: null,
        },
      ],
    };
    const facts = openFacts(restored, STACKS, record, [0, 1, 2, 3, 4, 5, 6], ORDER);
    expect(facts.constraints).toEqual([[4, 5, -1]]);
    expect(facts.restore).toEqual({
      outcome: { kind: 'applied' },
      carried: [
        {
          index: 0,
          status: { status: 'gone', cause: 'face_gone' },
          subject: null,
          object: 3,
          subjectState: 'gone',
          objectState: 'intact',
          sign: 1,
          constraint: null,
        },
        {
          index: 1,
          status: { status: 'ambiguous' },
          subject: 6,
          object: 3,
          subjectState: 'ambiguous',
          objectState: 'intact',
          sign: -1,
          constraint: null,
        },
      ],
    });
  });

  it('the engine contract’s shapes too: no handle, and a restore’s constraints as tuples', () => {
    const { session: _session, ...opened } = OPENED;
    const letterOrder = [0, 1, 2, 3, 4, 5, 6];
    expect(openFacts(opened, STACKS, null, letterOrder, ORDER)).toEqual(openFacts(OPENED, STACKS, null, letterOrder, ORDER));
    const restored = {
      ...opened,
      constraints: [[4, 5, -1]] as const,
      outcome: { kind: 'applied' } as const,
      saved_faces: { status: new Uint8Array(), face: new Int32Array(), area: new Float64Array() },
      saved_constraints: [],
      saved_order: new Uint8Array(),
      carried: [],
    };
    expect(openFacts(restored, STACKS, null, letterOrder, ORDER).constraints).toEqual([[4, 5, -1]]);
  });

  it('a check’s verdicts, with the clash’s indices and faces as plain arrays', () => {
    const changed = changedSpots([1]);
    expect(
      previewFacts({ verdict: 'fits', token: 4, changed, stacks: STACKS, stage: 'seeds_first', nodes: 9 })
    ).toEqual({ verdict: 'fits', token: 4, changed, stacks: STACKS });
    expect(
      previewFacts({
        verdict: 'cant_fit',
        proof: { kind: 'opposed' },
        faces: Uint32Array.of(1, 2),
        constraints: Uint32Array.of(0, 1),
      })
    ).toEqual({ verdict: 'cant_fit', constraints: [0, 1] });
    expect(previewFacts({ verdict: 'timed_out', limit: 'deadline', nodes: 3 })).toEqual({ verdict: 'timed_out' });

    const committed = { changed, stacks: STACKS, open_pairs: Uint32Array.of(4, 5), stage: 'unchanged', nodes: 0, adopted: true } as const;
    expect(commitFacts({ verdict: 'committed', ...committed }, ORDER)).toEqual({
      verdict: 'committed',
      changed,
      stacks: STACKS,
      openPairs: Uint32Array.of(4, 5),
      order: ORDER,
    });
    // An exact restore (`layer_show`) is the commit it is, with the order it put back.
    expect(shownFacts({ verdict: 'shown', ...committed, adopted: false }, ORDER)).toEqual(
      commitFacts({ verdict: 'committed', ...committed }, ORDER)
    );

    expect(
      explainFacts({
        verdict: 'clash',
        constraints: Uint32Array.of(0, 2),
        minimal: true,
        faces: Uint32Array.of(1, 3, 4),
        proof: { kind: 'forced' },
        traced: Uint32Array.of(1, 3, 4, 5),
      })
    ).toEqual({ verdict: 'clash', constraints: [0, 2], faces: [1, 3, 4], minimal: true });
    expect(explainFacts({ verdict: 'fits' })).toEqual({ verdict: 'fits' });

    const at = { index: 2, total: { n: 4, exact: true } };
    expect(stepFacts({ verdict: 'moved', changed, position: at, stacks: STACKS }, ORDER)).toEqual({
      verdict: 'moved',
      changed,
      position: at,
      stacks: STACKS,
      order: ORDER,
    });
    expect(stepFacts({ verdict: 'end' }, ORDER)).toEqual({ verdict: 'end' });
  });
});
