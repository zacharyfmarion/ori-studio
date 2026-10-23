/** History dependencies for an append-only return. No store or engine calls. */
import type { FoldNodeReplay } from './foldReplay';
import type { FoldReturnOp, FoldSequenceDocument } from './foldSequenceDocument';
import { foldStepTree, pathTo } from './foldStepTree';

export type FoldReturnDependencyCode = 'return_target_invalid' | 'return_state_unavailable' | 'return_source_changed';
type ReturnNode<S> = Omit<Pick<FoldNodeReplay<S>, 'state' | 'fingerprint' | 'status' | 'path'>, 'path'> & { path: string | null };
export function foldReturnPath(sequence: FoldSequenceDocument, parent: string | null, target: string | null) {
  if (parent === null || target === parent) return null;
  const path = pathTo(foldStepTree(sequence.steps), parent);
  return path && (target === null || path.slice(0, -1).some((n) => n.id === target)) ? path : null;
}

/**
 * The states a return rebuilds its creases from, oldest first, out of the
 * `states` on its path (the last is the one it unfolds): from the target, or
 * from the last state an Import CP made (`replaced`) when that is later. An
 * import replaces the model, so a crease from before it is not on the paper.
 * The one rule for every return: a step, its preview, its replay, and a
 * Repeat's, which holds no import and so passes no `replaced`.
 */
export function foldReturnHistory<S>(states: readonly S[], target: number, replaced: (index: number) => boolean = () => false): S[] {
  let start = target;
  for (let i = states.length - 1; i > target; i -= 1) {
    if (replaced(i)) {
      start = i;
      break;
    }
  }
  return states.slice(start);
}

export function resolveFoldReturn<S>(
  sequence: FoldSequenceDocument,
  parent: string | null,
  op: FoldReturnOp,
  sheet: ReturnNode<S>,
  nodes: ReadonlyMap<string, ReturnNode<S>>
): { target: S; history: S[] } | { code: FoldReturnDependencyCode } {
  const path = foldReturnPath(sequence, parent, op.target);
  if (!path || parent === null) {
    return { code: 'return_target_invalid' };
  }
  const source = nodes.get(parent);
  const target = op.target === null ? sheet : nodes.get(op.target);
  if (source?.state == null || target?.state == null || source.status === 'broken' || target.status === 'broken') {
    return { code: 'return_state_unavailable' };
  }
  if (source.path !== op.source.path || source.fingerprint !== op.source.state ||
      target.fingerprint !== op.source.targetState) return { code: 'return_source_changed' };
  const onPath = [sheet, ...path.map((n) => nodes.get(n.id))];
  const at = op.target === null ? 0 : path.findIndex((n) => n.id === op.target) + 1;
  const history: S[] = [];
  for (const node of foldReturnHistory(onPath, at, (i) => path[i - 1]?.op?.kind === 'cp-jump')) {
    if (node?.state === null || node?.state === undefined) return { code: 'return_state_unavailable' };
    history.push(node.state);
  }
  return { target: target.state, history };
}
