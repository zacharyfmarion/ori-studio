/**
 * The contract's own helpers (E5's sign rule, the bridge's triples, the
 * limits), and the fake backend the dialog's tests stand on, held to the
 * contract's rules.
 */
import { describe, expect, it } from 'vitest';
import { faceLettersOf } from './faceIndex';
import {
  FAKE_LAYER_ORDER_SOURCE,
  FAKE_LIMITS,
  FAKE_NO_NODES,
  createFakeLayerOrderBackend,
} from './layerOrderEngine.fixtures';
import { LAYER_ORDER_COUNT_SLICE } from '../layerOrderBudgets';
import {
  KEEP_TRYING_FACTOR,
  LAYER_ORDER_LIMITS,
  LAYER_ORDER_WORKER_NAMES,
  NO_PROVED_ENDS,
  constraintSeen,
  constraintVerb,
  keepTrying,
  layerOrderWorkerRole,
  layerPositionEnds,
  withProvedEnd,
  packConstraints,
  spotCount,
  unpackConstraints,
  type LayerSide,
  type LayerVerb,
} from './layerOrderEngine';

describe('constraints read from a side', () => {
  it('follow FOLD’s sign rule, as E5’s Constraint::seen does', () => {
    // From the front, "in front of" puts the subject above; the side above a face is its front exactly when it shows its front.
    expect(constraintSeen(2, 'in_front_of', 3, 'front', true)).toEqual([2, 3, 1]);
    expect(constraintSeen(2, 'in_front_of', 3, 'front', false)).toEqual([2, 3, -1]);
    expect(constraintSeen(2, 'behind', 3, 'front', true)).toEqual([2, 3, -1]);
    // Turned over, "in front of" puts the subject below.
    expect(constraintSeen(2, 'in_front_of', 3, 'back', true)).toEqual([2, 3, -1]);
    expect(constraintSeen(2, 'behind', 3, 'back', false)).toEqual([2, 3, -1]);
  });

  it('are paper-relative: the same constraint reads the other way from the other side', () => {
    const sides: LayerSide[] = ['front', 'back'];
    const verbs: LayerVerb[] = ['in_front_of', 'behind'];
    for (const side of sides) {
      for (const verb of verbs) {
        for (const frontUp of [true, false]) {
          const constraint = constraintSeen(0, verb, 1, side, frontUp);
          expect(constraintVerb(constraint, side, frontUp)).toBe(verb);
          const other = side === 'front' ? 'back' : 'front';
          expect(constraintVerb(constraint, other, frontUp)).toBe(verb === 'in_front_of' ? 'behind' : 'in_front_of');
        }
      }
    }
  });

  it('pack into the bridge’s triples and back', () => {
    const packed = packConstraints([
      [3, 0, 1],
      [2, 5, -1],
    ]);
    expect(packed).toEqual(Int32Array.of(3, 0, 1, 2, 5, -1));
    expect(unpackConstraints(packed)).toEqual([
      [3, 0, 1],
      [2, 5, -1],
    ]);
    expect(unpackConstraints(new Int32Array())).toEqual([]);
  });
});

describe('limits', () => {
  it('give a preview about 3 s, and every call E5’s node defaults', () => {
    expect(LAYER_ORDER_LIMITS.preview.deadlineMs).toBe(3_000);
    for (const limits of Object.values(LAYER_ORDER_LIMITS)) {
      expect(limits).toMatchObject({ maxNodes: 200_000, fastNodes: 128 });
    }
  });

  it('keep trying with a later deadline and more nodes, since the same nodes would stop in the same place', () => {
    expect(keepTrying(LAYER_ORDER_LIMITS.preview)).toEqual({
      maxNodes: 200_000 * KEEP_TRYING_FACTOR,
      fastNodes: 128,
      deadlineMs: 3_000 * KEEP_TRYING_FACTOR,
    });
    expect(keepTrying({ maxNodes: 10, fastNodes: 128, deadlineMs: 500 }, 2)).toEqual({
      maxNodes: 20,
      fastNodes: 128,
      deadlineMs: 1_000,
    });
  });

  it('give a count slice a small budget and a short deadline: the longest a call waits behind the count', () => {
    expect(LAYER_ORDER_COUNT_SLICE).toEqual({ maxNodes: 1_000, fastNodes: 128, deadlineMs: 30 });
    expect(LAYER_ORDER_COUNT_SLICE.deadlineMs).toBeLessThan(LAYER_ORDER_LIMITS.preview.deadlineMs / 10);
  });

  it('count spots from the stacks’ offsets', () => {
    expect(spotCount({ offsets: Uint32Array.of(0, 2, 5), faces: new Uint32Array(5) })).toBe(2);
    expect(spotCount({ offsets: new Uint32Array(), faces: new Uint32Array() })).toBe(0);
  });
});

describe('the stepper’s ends, every pager’s', () => {
  const at = (index: number, n: number, exact: boolean) => ({ index, total: { n, exact } });

  it('are the first and the last once the total is exact', () => {
    expect(layerPositionEnds(at(1, 3, true))).toEqual({ first: true, last: false, only: false });
    expect(layerPositionEnds(at(2, 3, true))).toEqual({ first: false, last: false, only: false });
    expect(layerPositionEnds(at(3, 3, true))).toEqual({ first: false, last: true, only: false });
    expect(layerPositionEnds(at(1, 1, true))).toEqual({ first: true, last: true, only: true });
  });

  it('leave ‹ at 1 until then: the index counts the solutions found so far, not their rank (E9)', () => {
    expect(layerPositionEnds(at(1, 3, false))).toEqual({ first: false, last: false, only: false });
    expect(layerPositionEnds(at(1, 1, false), null)).toEqual({ first: false, last: false, only: false });
    expect(layerPositionEnds(at(4, 4, false))).toEqual({ first: false, last: false, only: false });
  });

  it('wait each way a step proved to end, whatever the count says', () => {
    const previous = withProvedEnd(null, 'previous');
    const next = withProvedEnd(NO_PROVED_ENDS, 'next');
    expect(layerPositionEnds(at(1, 3, false), previous)).toEqual({ first: true, last: false, only: false });
    expect(layerPositionEnds(at(3, 3, false), next)).toEqual({ first: false, last: true, only: false });
    // The last, proved, but not the only one: a solution listed before the first found may yet be.
    expect(layerPositionEnds(at(1, 1, false), next)).toEqual({ first: false, last: true, only: false });
  });

  it('keep both proved ends: the one solution there is, the count unfinished', () => {
    const both = withProvedEnd(withProvedEnd(null, 'previous'), 'next');
    expect(both).toEqual({ previous: true, next: true });
    // Proving one way again keeps the other.
    expect(withProvedEnd(both, 'previous')).toEqual({ previous: true, next: true });
    expect(layerPositionEnds(at(1, 1, false), both)).toEqual({ first: true, last: true, only: true });
    // Both ends of an order the count has found others beside: no claim of one.
    expect(layerPositionEnds(at(2, 3, false), both)).toEqual({ first: true, last: true, only: false });
  });
});

describe('a worker’s role', () => {
  it('is read from the name the runtime spawns it with, a host’s unless it is the dialog’s', () => {
    expect(layerOrderWorkerRole(LAYER_ORDER_WORKER_NAMES.dialog)).toBe('dialog');
    expect(layerOrderWorkerRole(LAYER_ORDER_WORKER_NAMES.host)).toBe('host');
    expect(layerOrderWorkerRole('')).toBe('host');
  });
});

describe('the fake backend keeps the contract’s rules', () => {
  async function openedBackend() {
    const backend = createFakeLayerOrderBackend();
    const open = await backend.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    if (open.status !== 'ok') throw new Error('expected an open session');
    return { backend, open };
  }

  it('a preview never commits', async () => {
    const { backend, open } = await openedBackend();
    const before = await backend.stacks('front');
    await expect(backend.preview([3, 0, 1], FAKE_LIMITS)).resolves.toMatchObject({ verdict: 'fits' });
    expect(await backend.stacks('front')).toEqual(before);
    expect(await backend.openPairs()).toEqual(open.open_pairs);
    expect(await backend.constraints()).toEqual([]);
  });

  it('Add commits what was previewed, and the open pairs shrink', async () => {
    const { backend } = await openedBackend();
    // 3 in front of 0, 0 showing its front: 3 moves to the top.
    const preview = await backend.preview([3, 0, 1], FAKE_LIMITS);
    const commit = await backend.commit([[3, 0, 1]], FAKE_LIMITS);
    if (preview.verdict !== 'fits' || commit.verdict !== 'committed') throw new Error('expected a fit');
    expect(commit.stacks).toEqual(preview.stacks);
    expect([...commit.stacks.front.faces]).toEqual([3, 0, 1, 2]);
    expect([...commit.changed.front]).toEqual([0]);
    // 3 above 0 above 1 is settled; 2 against each of them is not.
    expect([...commit.open_pairs]).toEqual([0, 2, 1, 2, 2, 3]);
    expect(await backend.constraints()).toEqual([[3, 0, 1]]);
  });

  it('removing a constraint keeps the order on screen', async () => {
    const { backend } = await openedBackend();
    await backend.commit([[3, 0, 1]], FAKE_LIMITS);
    const removed = await backend.commit([], FAKE_LIMITS);
    if (removed.verdict !== 'committed') throw new Error('expected a commit');
    expect([...removed.stacks.front.faces]).toEqual([3, 0, 1, 2]);
    expect([...removed.changed.front]).toEqual([]);
  });

  it('a constraint against the creases can’t fit, and one against another is opposed', async () => {
    const { backend } = await openedBackend();
    // 1 in front of 0: the creases force 0 above 1.
    await expect(backend.preview([1, 0, 1], FAKE_LIMITS)).resolves.toMatchObject({
      verdict: 'cant_fit',
      proof: { kind: 'forced' },
      constraints: Uint32Array.of(0),
    });
    // [2, 3, 1] puts 3 above 2, as 3 is face down; [3, 2, -1] puts 2 above 3, as 2 is face up.
    await backend.commit([[2, 3, 1]], FAKE_LIMITS);
    await expect(backend.preview([3, 2, -1], FAKE_LIMITS)).resolves.toMatchObject({
      verdict: 'cant_fit',
      proof: { kind: 'opposed' },
      constraints: Uint32Array.of(0, 1),
    });
  });

  it('with no nodes, an answer that needs a search times out; one deduction settles does not', async () => {
    const { backend } = await openedBackend();
    await expect(backend.preview([3, 0, 1], FAKE_NO_NODES)).resolves.toEqual({
      verdict: 'timed_out',
      limit: 'nodes',
      nodes: 0,
    });
    await expect(backend.preview([0, 2, 1], FAKE_NO_NODES)).resolves.toMatchObject({ verdict: 'fits' });
    await expect(backend.preview([1, 0, 1], FAKE_NO_NODES)).resolves.toMatchObject({ verdict: 'cant_fit' });
  });

  it('a constraint that is no question throws, as the bridge does', async () => {
    const { backend } = await openedBackend();
    await expect(backend.preview([2, 2, 1], FAKE_LIMITS)).rejects.toMatchObject({ code: 'session_bad_constraint' });
    await expect(backend.commit([[0, 9, 1]], FAKE_LIMITS)).rejects.toMatchObject({ code: 'session_bad_constraint' });
  });

  it('draws a scene of the order on screen that letters its faces in reading order', async () => {
    const { backend } = await openedBackend();
    await backend.commit([[3, 0, 1]], FAKE_LIMITS);
    const front = await backend.scene('front');
    const back = await backend.scene('back');
    expect(front?.subfaces[0]?.faces_top_to_bottom).toEqual([3, 0, 1, 2]);
    expect(back?.subfaces[0]?.faces_top_to_bottom).toEqual([2, 1, 0, 3]);
    const letters = faceLettersOf(front!);
    expect([0, 1, 2, 3].map((face) => letters.letterOf(face))).toEqual(['A', 'B', 'C', 'D']);
    expect(faceLettersOf(back!).inLetterOrder).toEqual(letters.inLetterOrder);
  });

  it('saves a record that restores to the same constraints and order', async () => {
    const { backend } = await openedBackend();
    await backend.commit([[3, 0, 1]], FAKE_LIMITS);
    const saved = await backend.save();
    if (saved.status !== 'ok') throw new Error('expected a record');
    expect(saved.json.startsWith('{"v":1,')).toBe(true);

    const reopened = createFakeLayerOrderBackend();
    const restored = await reopened.restore(FAKE_LAYER_ORDER_SOURCE, saved.record, FAKE_LIMITS);
    if (restored.status !== 'ok') throw new Error('expected a restore');
    expect(restored.outcome).toEqual({ kind: 'applied' });
    expect(restored.saved_constraints).toEqual([{ status: 'intact' }]);
    expect(restored.constraints).toEqual([[3, 0, 1]]);
    expect(await reopened.stacks('front')).toEqual(await backend.stacks('front'));
    expect(await reopened.relations()).toEqual(await backend.relations());
  });

  it('Add adopts its preview by token; a stale token, or a step since, commits by a search', async () => {
    const { backend } = await openedBackend();
    const preview = await backend.preview([3, 0, 1], FAKE_LIMITS);
    if (preview.verdict !== 'fits') throw new Error('expected a fit');
    await expect(backend.commitPreview(preview.token, [[3, 0, 1]], FAKE_NO_NODES)).resolves.toMatchObject({
      verdict: 'committed',
      adopted: true,
      stacks: preview.stacks,
    });

    const next = await backend.preview([2, 3, 1], FAKE_LIMITS);
    if (next.verdict !== 'fits') throw new Error('expected a fit');
    await expect(backend.step({ picture: 'back' }, 'previous', FAKE_LIMITS)).resolves.toMatchObject({ verdict: 'moved' });
    await expect(
      backend.commitPreview(next.token, [
        [3, 0, 1],
        [2, 3, 1],
      ], FAKE_LIMITS)
    ).resolves.toMatchObject({ verdict: 'committed', adopted: false });
  });

  it('opens on the order shown, held whole when the creases allow it', async () => {
    const backend = createFakeLayerOrderBackend();
    // [3, 0, 1, 2] top first: every pair above to below.
    const shown = Uint32Array.of(3, 0, 3, 1, 3, 2, 0, 1, 0, 2, 1, 2);
    await expect(backend.openShowing(FAKE_LAYER_ORDER_SOURCE, shown, FAKE_LIMITS)).resolves.toMatchObject({
      status: 'ok',
      opened_on: { kind: 'held', ignored: 0 },
    });
    expect([...(await backend.stacks('front')).faces]).toEqual([3, 0, 1, 2]);
    // 1 above 0 is against the creases: the closest order that folds stands in.
    const against = Uint32Array.of(1, 0, 1, 2, 1, 3, 0, 2, 0, 3, 2, 3);
    await expect(backend.openShowing(FAKE_LAYER_ORDER_SOURCE, against, FAKE_LIMITS)).resolves.toMatchObject({
      opened_on: { kind: 'closest' },
    });
  });

  it('a restore whose constraints clash applies none, carries every one, and a save writes them back', async () => {
    const { backend } = await openedBackend();
    await backend.commit([[3, 0, 1]], FAKE_LIMITS);
    const saved = await backend.save();
    if (saved.status !== 'ok') throw new Error('expected a record');
    const [f, g, sign] = saved.record.constraints[0]!;
    const clashing = { ...saved.record, constraints: [...saved.record.constraints, [f, g, sign === 1 ? -1 : 1] as const] };

    const restored = await backend.restoreRecord(clashing, FAKE_LIMITS);
    if (restored.status !== 'ok') throw new Error('expected a restore');
    expect(restored.outcome).toEqual({ kind: 'clash', constraints: [0, 1] });
    expect(restored.constraints).toEqual([]);
    expect(restored.carried.map((row) => [row.index, row.status, row.constraint])).toEqual([
      [0, 'clashing', [3, 0, 1]],
      [1, 'clashing', [3, 0, -1]],
    ]);
    const resaved = await backend.save();
    if (resaved.status !== 'ok') throw new Error('expected a record');
    expect(resaved.record.constraints).toHaveLength(2);
    await expect(backend.removeCarried(1)).resolves.toBe(true);
    await expect(backend.carried()).resolves.toHaveLength(1);
    await backend.clearCarried();
    await expect(backend.carried()).resolves.toEqual([]);
  });

  it('explains a clash by its smallest set, and says when a list fits', async () => {
    const { backend } = await openedBackend();
    await backend.commit(
      [
        [2, 3, 1],
        [0, 2, 1],
      ],
      FAKE_LIMITS
    );
    // [3, 2, -1] puts 2 above 3, against the first; the second has no part in it.
    await expect(backend.explain([3, 2, -1], FAKE_LIMITS)).resolves.toMatchObject({
      verdict: 'clash',
      constraints: Uint32Array.of(0, 2),
      minimal: true,
      faces: Uint32Array.of(2, 3),
      proof: { kind: 'opposed' },
    });
    await expect(backend.explain(null, FAKE_LIMITS)).resolves.toEqual({ verdict: 'fits' });
  });
});
