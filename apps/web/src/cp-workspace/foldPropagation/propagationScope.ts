/**
 * The scope a propagation draft ran in, and the one sentence the drawing about
 * it cannot carry.
 *
 * # The scope is reported, not re-derived
 *
 * Propagation used to run across every crease pattern on the canvas at once, so
 * the thing a user got wrong was never the *count* — it was the scope. The
 * kernel now resolves the scope for the preview and the commit together and
 * reports it back, and nothing on this side second-guesses that report.
 *
 * The window no longer *titles* itself with the scope. It frames the creases it
 * changed and they are redrawn in their solved colours, so the frame answers
 * "which creases" better than a sentence did. What survives here is the part
 * the drawing genuinely cannot show: creases still undecided, vertices that
 * need creases outside the scope, and vertices that stopped closing.
 *
 * React-free and store-free on purpose: it is copy and comparison over a plain
 * descriptor, which is what makes both testable without mounting anything.
 */
import type { TFunction } from 'i18next';

import type { OristudioCpCommandPreview } from '../../engine/oristudioCpTypes';
import { cpToolUnavailableMessage } from '../tools/toolUnavailable';

/**
 * `unknown` is not a kernel kind — it is what an older frontend calls a scope a
 * newer kernel invented. Same discipline as `cpToolUnavailableMessage`: fall
 * back to wording that is still true rather than show a raw identifier.
 */
export type PropagationScopeKind = 'selection' | 'component' | 'document' | 'unknown';

/**
 * What a draft was allowed to write to — the full mirror of the kernel's scope
 * report, though only `outOfScope` currently has a reader (the note).
 */
export interface PropagationScopeSummary {
  readonly kind: PropagationScopeKind;
  /** Creases the scope names. */
  readonly creases: number;
  /** Vertices propagation was allowed to visit. */
  readonly vertices: number;
  /** Unassigned creases still inside the scope. Scope-relative, not a document total. */
  readonly free: number;
  /** Vertices skipped because some of their unknowns were outside the scope. */
  readonly outOfScope: number;
}

function scopeKind(kind: string): PropagationScopeKind {
  return kind === 'selection' || kind === 'component' || kind === 'document' ? kind : 'unknown';
}

/** The scope a preview reports, or null when it reported none. */
export function propagationScopeSummary(
  preview: OristudioCpCommandPreview
): PropagationScopeSummary | null {
  const scope = preview.propagation_scope;
  if (!scope) return null;
  return {
    kind: scopeKind(scope.kind),
    creases: scope.creases,
    vertices: scope.vertices,
    free: scope.free,
    outOfScope: scope.out_of_scope,
  };
}

/**
 * Do two id lists name the same creases, in the same order?
 *
 * Used to tell whether the selection a held draft was computed against is still
 * the selection on screen. Order counts because the selection is a list the
 * kernel receives in order, and a reordering that meant nothing would only ever
 * cost one extra recompute.
 */
export function sameLineIds(a: readonly number[], b: readonly number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

/**
 * The one sentence the drawing cannot carry. First match wins.
 *
 * `outOfScope` outranks the free count because it is the only finding with an
 * action attached — select those creases too, or clear the selection and click
 * the pattern. A vertex is reported there rather than solved because half of a
 * simultaneous answer is not an answer, so this is the user's move to make.
 */
export function propagationWindowNote(
  t: TFunction,
  draft: { conflicts: number; free: number; scope: PropagationScopeSummary | null }
): string | null {
  if (draft.conflicts > 0) {
    return t(
      'tools:cpContext.propagation.conflicts',
      'Vertices that no longer close: {{vertices}} — something this rests on disagrees.',
      { vertices: draft.conflicts }
    );
  }
  const outOfScope = propagationOutOfScopeNote(t, draft.scope?.outOfScope ?? 0);
  if (outOfScope) return outOfScope;
  // "here" is load-bearing: the number is scope-relative, and without it the
  // sentence reads as a document total.
  if (draft.free > 0) {
    return t('tools:cpContext.propagation.partial', 'Still undecided here: {{creases}}', {
      creases: draft.free,
    });
  }
  return null;
}

/**
 * "Some vertices here need creases you did not select", or null when none do.
 *
 * One sentence, two callers — the note on a held draft, and the toast for a run
 * that produced no draft at all. The second is the case it was written for and
 * the one it could not reach: the note only renders inside the draft window, and
 * a run that solves nothing opens none, so the user got the generic "give one
 * more crease an angle" instead of the move that actually works. That is the
 * *default* outcome of Propagate in selection on a small selection.
 */
export function propagationOutOfScopeNote(t: TFunction, vertices: number): string | null {
  if (vertices <= 0) return null;
  return t(
    'tools:cpContext.propagation.outOfScope',
    'Vertices needing creases you did not select: {{vertices}} — select those too, or clear the selection and click the pattern.',
    { vertices }
  );
}

/**
 * The sentence for a propagation that worked nothing out.
 *
 * Everything is the shared code table's, except the one code whose sentence
 * needs a number: `PropagationOutOfScope` carries its count in the scope report
 * rather than in the code, so it is answered from there. That is also why it is
 * not in `CP_TOOL_UNAVAILABLE_CODES` — an entry there would be a second,
 * countless copy of a sentence that already exists in eight locales.
 */
export function propagationUnavailableMessage(
  t: TFunction,
  code: string | null | undefined,
  scope: PropagationScopeSummary | null
): string | null {
  if (code !== 'PropagationOutOfScope') return cpToolUnavailableMessage(t, code);
  // A kernel that reports this code reports the count with it, from the same
  // list of stalls. The fallback is for the payload that somehow does not: a
  // less specific sentence beats a silent toast.
  return (
    propagationOutOfScopeNote(t, scope?.outOfScope ?? 0) ??
    cpToolUnavailableMessage(t, 'PropagationNothingDecidable')
  );
}
