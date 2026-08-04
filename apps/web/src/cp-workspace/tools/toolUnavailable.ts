/**
 * What a tool says about the pick you are making — why it has no answer, and
 * when its answer overrides what you asked for.
 *
 * The kernel reports a code rather than a sentence — the same division
 * {@link foldabilityViolationMessage} uses, and for the same reason: eight
 * locales are gated in CI and a Rust string literal cannot pass that gate.
 *
 * # These are answers, not errors
 *
 * The vertex-completion solve is overdetermined (three closure constraints
 * against a new crease's two parameters), so "no single crease closes this
 * vertex" is the *ordinary* result on a freely-angled vertex, not a failure. It
 * still has to be said: a tool that draws nothing and explains nothing reads as
 * broken. Each code names a different next move — add two creases, adjust the
 * angles, split the crease that runs through — which is why they stay four
 * messages rather than collapsing into one.
 */
import type { TFunction } from 'i18next';

/**
 * `solve_spatial::NoCompletion` and `solve_fold_angles::NoSolution`, as they
 * cross the wasm boundary. The two solvers share this table because they share
 * two codes exactly — a boundary vertex and an indeterminate fan mean the same
 * thing and want the same next move whichever tool you reached for.
 */
export const CP_TOOL_UNAVAILABLE_CODES = [
  'BoundaryVertex',
  'Indeterminate',
  'AlreadyClosed',
  'ExceedsFullFold',
  'Overdetermined',
  'NotEnoughCreases',
  'CreaseNotInFan',
  'AnglesUnreachable',
] as const;

export type CpToolUnavailableCode = (typeof CP_TOOL_UNAVAILABLE_CODES)[number];

function isCode(value: string | null | undefined): value is CpToolUnavailableCode {
  return CP_TOOL_UNAVAILABLE_CODES.includes(value as CpToolUnavailableCode);
}

/**
 * The sentence for a kernel code, or `null` when there is nothing to say — which
 * includes a code this table does not recognise, so an older frontend against a
 * newer kernel stays quiet rather than showing a raw identifier.
 */
export function cpToolUnavailableMessage(
  t: TFunction,
  code: string | null | undefined
): string | null {
  if (!isCode(code)) return null;
  switch (code) {
    case 'BoundaryVertex':
      return t(
        'tools:cpContext.completion.boundaryVertex',
        'This point is on the edge of the paper, so there is nothing to close — pick a vertex inside the sheet.'
      );
    case 'Indeterminate':
      return t(
        'tools:cpContext.completion.indeterminate',
        'Cannot tell: a crease here is unassigned, or another crease passes through without ending here.'
      );
    case 'AlreadyClosed':
      return t(
        'tools:cpContext.completion.alreadyClosed',
        'This vertex already folds consistently — no crease is missing.'
      );
    case 'ExceedsFullFold':
      return t(
        'tools:cpContext.completion.exceedsFullFold',
        'No single crease can close this vertex: it would have to fold past 180°.'
      );
    case 'Overdetermined':
      return t(
        'tools:cpContext.completion.overdetermined',
        'No single crease closes this vertex — at least two would be needed.'
      );
    case 'NotEnoughCreases':
      return t(
        'tools:cpContext.solveAngles.notEnoughCreases',
        'Fewer than three creases meet here, so there are no three angles to solve.'
      );
    case 'CreaseNotInFan':
      return t(
        'tools:cpContext.solveAngles.creaseNotInFan',
        'Pick three different creases that all meet at the same vertex.'
      );
    // Not a failure: three creases chosen at random cannot close a freely-angled
    // vertex about 62% of the time. The next move is a different three, which is
    // why the tool marks which ones work.
    case 'AnglesUnreachable':
      return t(
        'tools:cpContext.solveAngles.unreachable',
        'These three creases cannot close this vertex at any fold angles — try a different three.'
      );
  }
}

/**
 * The note shown when the tool's answer overrides the active line type.
 *
 * The completion solve determines the mountain/valley, and on a flat vertex that
 * is Maekawa forcing it — so the crease can come out the opposite colour to the
 * one selected in the rail. Correct, and surprising if unexplained: the whole
 * editor otherwise obeys the active line type without exception.
 *
 * Only spoken when *every* candidate agrees. A spatial vertex can offer a
 * mountain in one gap and a valley in another, and "this must be a valley" would
 * then be false for half of what is on screen.
 */
export function forcedAssignmentNotice(
  t: TFunction,
  candidates: readonly { crease?: { color: string } }[],
  activeColor: string
): string | null {
  const assigned = candidates
    .map((candidate) => candidate.crease?.color)
    .filter((color): color is string => color === 'Red1' || color === 'Blue2');
  if (assigned.length === 0 || assigned.length !== candidates.length) return null;
  const forced = assigned[0];
  if (assigned.some((color) => color !== forced) || forced === activeColor) return null;
  return forced === 'Red1'
    ? t(
        'tools:cpContext.completion.forcedMountain',
        'This crease has to be a mountain — drawn as one, not in the selected line type.'
      )
    : t(
        'tools:cpContext.completion.forcedValley',
        'This crease has to be a valley — drawn as one, not in the selected line type.'
      );
}
