/** Sequential composite replay over the ordinary public engine operations. */
import { foldReturnHistory } from '../document/foldReturn';
import type { FoldChoices, FoldRepeatOp } from '../document/foldSequenceDocument';
import type {
  FoldEngineOp,
  FoldEngineOutcome,
  FoldEngineRefused,
  FoldStepLanded,
} from '../engine/foldEngineWire';
import type { FoldWasmEngine } from '../engine/foldEngineCalls';

export function repeatRefusal(reason: string, step = 0): FoldEngineRefused {
  return {
    status: 'refused',
    refusal: { code: 'repeat_failed', reason, step },
    fixes: [],
    faces: [],
    vertices: [],
  };
}

export function createRepeatExecution(
  engine: FoldWasmEngine,
  fingerprint: (state: number) => string,
  apply: (state: number, op: FoldEngineOp, choices?: FoldChoices) => FoldEngineOutcome<FoldStepLanded>,
  onRelease: (states: readonly number[]) => void = () => {},
) {
  const children = new Map<number, number[]>();
  const history = (state: number): number[] => [...(children.get(state) ?? []).flatMap(history), state];
  const release = (states: readonly number[]) => {
    const all = [...new Set(states.flatMap(history))];
    all.forEach((s) => children.delete(s));
    onRelease(all);
    return engine.release(Uint32Array.from(all));
  };
  return {
    has: (state: number) => children.has(state),
    history,
    hold: (state: number, intermediates: number[]) => children.set(state, intermediates),
    release,
    clear: () => children.clear(),
    apply(parent: number, op: FoldRepeatOp): FoldEngineOutcome<FoldStepLanded> {
      let budget = 256;
      const bounded = (recipe: FoldRepeatOp, depth: number): boolean =>
        depth <= 4 &&
        recipe.steps.length > 0 &&
        recipe.steps.length <= 128 &&
        recipe.steps.every(
          (entry, i) =>
            --budget >= 0 &&
            (entry.op.kind !== 'unfold-to' ||
              (Number.isInteger(entry.returnTo) && entry.returnTo! >= 0 && entry.returnTo! <= i)) &&
            (entry.op.kind !== 'repeat' || bounded(entry.op, depth + 1)),
        );
      if (!bounded(op, 0)) return repeatRefusal('repeat_limit');
      if (fingerprint(parent) !== op.parentState) return repeatRefusal('repeat_parent_changed');
      if (!op.steps.length || op.steps.length > 128) return repeatRefusal('repeat_limit');
      const owned: number[] = [];
      let current = parent;
      try {
        for (let i = 0; i < op.steps.length; i++) {
          const entry = op.steps[i]!;
          const answer =
            entry.op.kind === 'unfold-to'
              ? (engine.return_to(
                  current,
                  [parent, ...owned][entry.returnTo!]!,
                  Uint32Array.from(foldReturnHistory([parent, ...owned], entry.returnTo!).flatMap(history)),
                ) as FoldEngineOutcome<FoldStepLanded>)
              : apply(current, entry.op, entry.choices);
          if (answer.status !== 'ok') {
            release(owned);
            return repeatRefusal(answer.refusal.code, i);
          }
          current = answer.state;
          owned.push(current);
          if (fingerprint(current) !== entry.expect) {
            release(owned);
            return repeatRefusal('repeat_step_changed', i);
          }
        }
        children.set(current, [...owned.slice(0, -1), ...(children.get(current) ?? [])]);
        return {
          status: 'ok',
          state: current,
          report: null,
          summary: engine.summary(current) as FoldStepLanded['summary'],
        };
      } catch (error) {
        release(owned);
        throw error;
      }
    },
  };
}
