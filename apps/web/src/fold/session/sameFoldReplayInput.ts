import { isLockedStep, type FoldSequenceDocument } from '../document/foldSequenceDocument';

/** Documents are immutable. Presentation edits retain these engine inputs;
 * they must not rehash/replay a large imported CP on every pointer move.
 * A false result is conservative: equivalent deserialized inputs may replay,
 * but an operation, choice, topology or drift-expectation edit never skips it. */
export function sameFoldReplayInput(a: FoldSequenceDocument, b: FoldSequenceDocument): boolean {
  if (a === b) return true;
  if (a.formatVersion !== b.formatVersion || a.id !== b.id || a.paper !== b.paper || a.steps.length !== b.steps.length) return false;
  return a.steps.every((step, i) => {
    const other = b.steps[i]!;
    if (step === other) return true;
    if (step.id !== other.id || step.parent !== other.parent) return false;
    if (isLockedStep(step) || isLockedStep(other)) return step.unknown === other.unknown;
    return step.op === other.op && step.choices === other.choices && step.expect === other.expect;
  });
}
