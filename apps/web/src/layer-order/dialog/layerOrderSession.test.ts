/**
 * The dialog's open and Apply as engine conversations, over the real runtime
 * and worker shell with the fake backend: which open each request takes,
 * what a ready session holds, and what Apply hands the host.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import {
  FAKE_LAYER_ORDER_FIGURE,
  FAKE_LAYER_ORDER_SOURCE,
  FAKE_LIMITS,
  fakeLayerOrderScene,
  fakeLayerOrderWorkers,
} from '../engine/layerOrderEngine.fixtures';
import { createLayerOrderRuntime, type LayerOrderRuntime } from '../engine/layerOrderRuntime';
import {
  applyLayerOrderSession,
  layerOrderOpenHow,
  openLayerOrderSession,
  requestFaceLetters,
  type LayerOrderOpenAnswer,
} from './layerOrderSession';

const REQUEST: LayerOrderRequest = {
  source: FAKE_LAYER_ORDER_SOURCE,
  record: null,
  look: {
    style: DEFAULT_PAPER_STYLE,
    policy: PAPER_STYLE_POLICIES['folded-flat'],
    turnDeg: 0,
    side: 'front',
    xray: false,
    lineStyle: 'color',
    lineWidth: 1,
  },
};
/** The toy figure as a host shows it: 2 over 3 over 0 over 1. */
const SHOWN = fakeLayerOrderScene(FAKE_LAYER_ORDER_FIGURE, [2, 3, 0, 1], 'front');
const face = (k: number) => ({ at: FAKE_LAYER_ORDER_FIGURE.facePoints[k]!, area: 100 });
const RECORD: LayerOrderRecord = { faces: [face(3), face(0)], constraints: [[0, 1, 1]], order: [] };

const tag = (value: unknown) => Object.prototype.toString.call(value);

let runtime: LayerOrderRuntime | null = null;

afterEach(() => {
  runtime?.dispose();
  runtime = null;
});

function overFakes() {
  const fakes = fakeLayerOrderWorkers();
  runtime = createLayerOrderRuntime({ role: 'dialog', spawn: fakes.spawn });
  return { fakes, engine: runtime.engine };
}

function ready(answer: LayerOrderOpenAnswer) {
  if (answer.kind !== 'ready') throw new Error(`refused: ${JSON.stringify(answer.refusal)}`);
  return answer.open;
}

describe('opening the dialog’s session', () => {
  it('opens on the order the host shows, then reads both sides’ stacks and scenes, and the order packed for undo', async () => {
    const { fakes, engine } = overFakes();
    const request = { ...REQUEST, shown: SHOWN };
    expect(layerOrderOpenHow(request)).toBe('showing');
    const open = ready(await openLayerOrderSession(engine, request, FAKE_LIMITS));
    expect(fakes.workers[0]!.backend.calls).toEqual(['openShowing', 'stacks', 'stacks', 'scene', 'scene', 'order']);
    expect(Array.from(open.facts.order)).toEqual([2, 3, 0, 1]);
    expect(open.how).toBe('showing');
    // The order the host drew, held whole: 0 must stay over 1, and does.
    expect(open.opened.opened_on).toEqual({ kind: 'held', ignored: 0 });
    expect(Array.from(open.stacks.front.faces)).toEqual([2, 3, 0, 1]);
    expect(Array.from(open.stacks.back.faces)).toEqual([1, 0, 3, 2]);
    expect(open.scenes.front?.flipped).toBe(false);
    expect(open.scenes.back?.flipped).toBe(true);
    // Lettered in reading order: the top row left to right, then the next.
    expect([0, 1, 2, 3].map((k) => open.letters?.letterOf(k))).toEqual(['A', 'B', 'C', 'D']);
    // What U9's inspector takes as its `opened` action.
    expect(open.facts.faces).toBe(4);
    expect(Array.from(open.facts.openPairs)).toEqual(Array.from(open.opened.open_pairs));
    expect(open.facts.restore).toBeNull();
    // The letters it sorts objects by (D21), from the scene it read.
    expect(open.facts.letterOrder).toEqual(open.letters?.inLetterOrder);
    expect(open.facts.letterOrder).toEqual([0, 1, 2, 3]);
  });

  it('opens on the solver’s first order when the host shows none', async () => {
    const { fakes, engine } = overFakes();
    expect(layerOrderOpenHow(REQUEST)).toBe('first');
    const open = ready(await openLayerOrderSession(engine, REQUEST, FAKE_LIMITS));
    expect(fakes.workers[0]!.backend.calls[0]).toBe('open');
    expect(open.opened.opened_on.kind).toBe('first');
  });

  it('restores a saved record, and again on the session open for Keep trying', async () => {
    const { fakes, engine } = overFakes();
    const request = { ...REQUEST, record: RECORD, shown: SHOWN };
    expect(layerOrderOpenHow(request)).toBe('restore');
    const open = ready(await openLayerOrderSession(engine, request, FAKE_LIMITS));
    expect(fakes.workers[0]!.backend.calls[0]).toBe('restore');
    expect(open.facts.constraints).toEqual([[3, 0, 1]]);
    expect(open.facts.restore?.outcome).toEqual({ kind: 'applied' });
    expect(open.facts.letterOrder).toEqual([0, 1, 2, 3]);

    const again = ready(await openLayerOrderSession(engine, request, FAKE_LIMITS, { sessionOpen: true }));
    expect(fakes.workers[0]!.backend.calls).toContain('restoreRecord');
    expect(again.facts.letterOrder).toEqual([0, 1, 2, 3]);
  });

  it('answers a refusal as a refusal, and reads nothing more', async () => {
    const { fakes, engine } = overFakes();
    await engine.close();
    fakes.workers[0]!.backend.openShowing = async () => ({
      status: 'refused',
      refusal: { code: 'source_digest_mismatch', expected: 'a', actual: 'b' },
    });
    const answer = await openLayerOrderSession(engine, { ...REQUEST, shown: SHOWN }, FAKE_LIMITS);
    expect(answer).toEqual({ kind: 'refused', refusal: { code: 'source_digest_mismatch', expected: 'a', actual: 'b' } });
    expect(fakes.workers[0]!.backend.calls).not.toContain('stacks');
  });

  it('letters faces from the host’s scene before the engine answers', () => {
    expect(requestFaceLetters(REQUEST)).toBeNull();
    expect(requestFaceLetters({ ...REQUEST, shown: SHOWN })?.letterOf(3)).toBe('D');
  });
});

describe('Apply’s plumbing', () => {
  it('hands the host the saved record, the order on screen as relations, and the source it was given', async () => {
    const { fakes, engine } = overFakes();
    const request = { ...REQUEST, shown: SHOWN };
    ready(await openLayerOrderSession(engine, request, FAKE_LIMITS));
    const answer = await applyLayerOrderSession(engine, request);
    if (answer.kind !== 'applied') throw new Error('refused');
    expect(answer.applied.source).toBe(request.source);
    expect(tag(answer.applied.relations)).toBe('[object Uint32Array]');
    // 2 over 3 over 0 over 1, as the host's kernel takes it: [upper, lower, …].
    expect(Array.from(answer.applied.relations)).toEqual([0, 1, 2, 0, 2, 1, 2, 3, 3, 0, 3, 1]);
    expect(answer.applied.record.constraints).toEqual([]);
    expect(fakes.workers[0]!.backend.calls.slice(-2)).toEqual(['save', 'relations']);
  });

  it('refuses inside the dialog when the record can’t be saved', async () => {
    const { fakes, engine } = overFakes();
    ready(await openLayerOrderSession(engine, REQUEST, FAKE_LIMITS));
    fakes.workers[0]!.backend.save = async () => ({
      status: 'refused',
      refusal: { code: 'record_over_budget', bytes: 2_000_000, budget: 1_048_576 },
    });
    await expect(applyLayerOrderSession(engine, REQUEST)).resolves.toEqual({
      kind: 'refused',
      refusal: { code: 'record_over_budget', bytes: 2_000_000, budget: 1_048_576 },
    });
    expect(fakes.workers[0]!.backend.calls).not.toContain('relations');
  });
});
