/**
 * Unfold to step as a tool (plan `fold-sequence-tools`): the steps it may
 * return to, the one it returns to, and the step it adds — the stored
 * `unfold-to` op, unchanged, which keeps every crease the steps since made.
 *
 * Pure.
 */
import type { FoldReturnOp } from '../document/foldSequenceDocument';
import type { FoldSessionNode } from '../session/foldSessionState';
import type { FoldPathEntry } from '../sequence/foldSequencePath';

/**
 * The entries Unfold to step may return to from the step on screen: every
 * earlier entry of the path, the flat sheet among them, whose state has
 * landed — latest first, the nearest being the likeliest. None at the sheet.
 */
export function unfoldTargets(entries: readonly FoldPathEntry[], cursor: number): FoldPathEntry[] {
  return entries
    .slice(0, Math.max(0, cursor))
    .filter((entry) => entry.session.state !== null)
    .reverse();
}

/**
 * The target in use: the one the folder chose while it is offered, else the
 * entry just before the step on screen — unfolding the last step — or, while
 * that one has not landed, the nearest that has.
 */
export function unfoldTargetOf(
  targets: readonly FoldPathEntry[],
  chosen: { id: string | null } | null,
  previous: FoldPathEntry | undefined
): FoldPathEntry | null {
  const kept = chosen ? targets.find((entry) => entry.id === chosen.id) : undefined;
  if (kept) return kept;
  return (previous && targets.includes(previous) ? previous : targets[0]) ?? null;
}

/**
 * The step that returns the step on screen (`source`, its replay) to
 * `target`'s pose, or null until both have the identities it records.
 */
export function unfoldOp(source: FoldSessionNode, target: FoldPathEntry): FoldReturnOp | null {
  const targetState = target.session.fingerprint;
  if (!source.path || !source.fingerprint || !targetState) return null;
  return { kind: 'unfold-to', target: target.id, source: { path: source.path, state: source.fingerprint, targetState } };
}
