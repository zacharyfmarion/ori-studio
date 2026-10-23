import { describe, expect, it } from 'vitest';
import { FOLD_OP_KINDS, type FoldOp, type FoldSinkOp } from '../document/foldSequenceDocument';
import { createFoldEngineSinkCalls, type FoldWasmSinkEngine } from './foldEngineSinkCalls';
import {
  FOLD_SINK_OP_KINDS,
  FOLD_SINK_REFUSAL_CODES,
  isFoldSinkOp,
  pocketChoice,
  sinkStoredChoices,
  type FoldEngineSinkOp,
} from './foldEngineSinkWire';
import { FOLD_ENGINE_REFUSAL_CODES } from './foldEngineWire';

const SINK: FoldSinkOp & FoldEngineSinkOp = {
  kind: 'open-sink',
  line: { via: 'free', through: [[0.35, 0.35], [0.2, 0.5]] },
  seed: { scope: 'flaps', at: [[0.4, 0.45]] },
};

describe('the sink wire', () => {
  it('names the document’s sink ops, and only those', () => {
    expect(FOLD_SINK_OP_KINDS.every((kind) => FOLD_OP_KINDS.includes(kind))).toBe(true);
    const valley: FoldOp = { kind: 'valley', line: SINK.line, seed: SINK.seed };
    expect(isFoldSinkOp(valley)).toBe(false);
    expect(FOLD_SINK_OP_KINDS.map((kind) => isFoldSinkOp({ ...SINK, kind }))).toEqual([true, true, true]);
  });

  it('lists the sink refusals among the engine’s, in its order', () => {
    const at = FOLD_ENGINE_REFUSAL_CODES.indexOf(FOLD_SINK_REFUSAL_CODES[0]);
    expect(FOLD_ENGINE_REFUSAL_CODES.slice(at, at + FOLD_SINK_REFUSAL_CODES.length)).toEqual([
      ...FOLD_SINK_REFUSAL_CODES,
    ]);
  });

  it('turns what a sink stores into the document’s choices, and stores nothing for nothing chosen', () => {
    const pocket = { above: [0.15, 0.4], below: [0.15, 0.6] } as const;
    const order = { faces: [[0.4, 0.45], [0.6, 0.45]], orders: [[1, 0, 1]] } as const;
    expect(pocketChoice(pocket)).toEqual([pocket.above, pocket.below]);
    expect(sinkStoredChoices({ pocket, order })).toEqual({ pocket: [pocket.above, pocket.below], completion: order });
    expect(sinkStoredChoices({})).toEqual({});
    expect(sinkStoredChoices({ order: { faces: [], orders: [] } })).toEqual({});
  });
});

describe('the sink calls', () => {
  const engine: FoldWasmSinkEngine & { asked: unknown[][] } = {
    asked: [],
    sink_orders(...args) {
      this.asked.push(['orders', ...args]);
      return { status: 'ok' };
    },
    sink_pick(...args) {
      this.asked.push(['pick', ...args]);
      return { status: 'ok' };
    },
    sunk_points(...args) {
      this.asked.push(['sunk', ...args]);
      return { status: 'ok' };
    },
  };
  const calls = createFoldEngineSinkCalls(engine);

  it('hands a checked sink op over unchanged, a pick as indices', () => {
    calls.sinkOrders(3, SINK);
    calls.sinkPick(3, SINK, [0, 2], { pocket: [[0.1, 0.1], [0.2, 0.2]] });
    expect(engine.asked[0]).toEqual(['orders', 3, SINK, undefined]);
    expect(engine.asked[1]?.[4]).toEqual(Uint32Array.from([0, 2]));
    const unsink: FoldEngineSinkOp = { ...SINK, kind: 'unsink' };
    calls.sunkPoints(4, unsink);
    expect(engine.asked[2]).toEqual(['sunk', 4, unsink, undefined]);
  });

  it('asks for sunk points of an unsink only', () => {
    expect(() => calls.sunkPoints(1, SINK)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });

  it('throws the caller’s mistakes before the engine sees them', () => {
    const valley = { ...SINK, kind: 'valley' } as unknown as FoldEngineSinkOp;
    for (const call of [
      () => calls.sinkOrders(0, SINK),
      () => calls.sinkOrders(1.5, SINK),
      () => calls.sinkOrders(1, valley),
      () => calls.sinkPick(1, SINK, [-1]),
      () => calls.sinkPick(1, SINK, [0.5]),
      () => calls.sinkOrders(1, SINK, 'first' as never),
    ]) {
      expect(call).toThrow(expect.objectContaining({ code: 'invalid_input' }));
    }
  });
});
