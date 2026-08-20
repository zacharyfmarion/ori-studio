/**
 * The scope a propagation draft ran in, and what the window calls it.
 *
 * # Why the window has to name the scope
 *
 * Propagation used to run across every crease pattern on the canvas at once. The
 * thing the user got wrong was therefore never the *count* — it was the scope —
 * so a window titled only "12 solved" cannot say whether that twelve is this
 * pattern, the selection, or the whole sheet. The kernel resolves the scope for
 * the preview and the commit together and reports it back; this turns that
 * report into a sentence, and nothing on this side re-derives it.
 *
 * React-free and store-free on purpose: it is copy and comparison over a plain
 * descriptor, which is what makes both testable without mounting anything.
 */
import type { TFunction } from 'i18next';

import type { OristudioCpCommandPreview } from '../../engine/oristudioCpTypes';

/**
 * `unknown` is not a kernel kind — it is what an older frontend calls a scope a
 * newer kernel invented. Same discipline as `cpToolUnavailableMessage`: fall
 * back to wording that is still true rather than show a raw identifier.
 */
export type PropagationScopeKind = 'selection' | 'component' | 'document' | 'unknown';

/** What a draft was allowed to write to, as the tool needs it. */
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
 * The window title, which leads with the scope rather than the count.
 *
 * Deliberately not `{{count}}`: that name is i18next's plural trigger, and it
 * would demand a full set of plural forms per locale for a readout that is a
 * bare number.
 */
export function propagationWindowTitle(
  t: TFunction,
  creases: number,
  scope: PropagationScopeSummary | null
): string {
  switch (scope?.kind) {
    case 'selection':
      return t(
        'tools:cpContext.propagation.titleSelection',
        'Selection — {{creases}} fold angles solved',
        { creases }
      );
    case 'component':
      return t(
        'tools:cpContext.propagation.titleComponent',
        'This pattern — {{creases}} fold angles solved',
        { creases }
      );
    case 'document':
      return t(
        'tools:cpContext.propagation.titleDocument',
        'Whole document — {{creases}} fold angles solved',
        { creases }
      );
    default:
      return t('tools:cpContext.propagation.title', 'Fold angles — {{creases}} solved', {
        creases,
      });
  }
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
  const outOfScope = draft.scope?.outOfScope ?? 0;
  if (outOfScope > 0) {
    return t(
      'tools:cpContext.propagation.outOfScope',
      'Vertices needing creases you did not select: {{vertices}} — select those too, or clear the selection and click the pattern.',
      { vertices: outOfScope }
    );
  }
  // "here" is load-bearing: the number is scope-relative, and without it the
  // sentence reads as a document total.
  if (draft.free > 0) {
    return t('tools:cpContext.propagation.partial', 'Still undecided here: {{creases}}', {
      creases: draft.free,
    });
  }
  return null;
}
