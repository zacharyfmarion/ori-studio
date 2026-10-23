import { isRecord } from '../../lib/documentFile';

/** Normalize only the landing spelling. Preserve every other field so callers
 * can still detect unsupported inputs that the file writer would discard. */
export function normalizeFoldLandingOp(op: unknown): unknown {
  if (!isRecord(op)) return op;
  if (op.kind === 'repeat' && Array.isArray(op.steps)) return { ...op, steps: op.steps.map((entry) =>
    isRecord(entry) ? { ...entry, op: normalizeFoldLandingOp(entry.op) } : entry) };
  if (op.kind === 'valley' || op.kind === 'mountain') {
    return { ...op, landing: op.landing ?? { kind: 'outer' } };
  }
  if (op.kind !== 'tuck') return op;
  const { direction, target, additionalTargets, ...rest } = op;
  return {
    ...rest,
    kind: direction,
    landing: { kind: 'against', targets: [target, ...(Array.isArray(additionalTargets) ? additionalTargets : [])] },
  };
}

/** fh1 names the original operation semantics, not their serialization revision.
 * Keep existing unfold source guards and diagram links stable through migration. */
export function foldHistoryOp(op: unknown): unknown {
  if (!isRecord(op) || (op.kind !== 'valley' && op.kind !== 'mountain') || !isRecord(op.landing)) return op;
  const { landing, ...plain } = op;
  if (landing.kind === 'outer' && Object.keys(landing).length === 1) return plain;
  if (landing.kind !== 'against' || !Array.isArray(landing.targets) || Object.keys(landing).length !== 2) return op;
  const targets = landing.targets;
  return { ...plain, kind: 'tuck', direction: op.kind, target: targets[0],
    ...(targets.length > 1 ? { additionalTargets: targets.slice(1) } : {}) };
}
