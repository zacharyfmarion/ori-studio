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
  'TooManyUnknowns',
  'CreasesDoNotMeet',
  'PropagationNothingFree',
  'PropagationNothingDecidable',
  // The four scope codes. Each names a different next move, which is the bar for
  // a code of its own: pick a scope, pick a different point, select different
  // creases, or select creases that still exist. Collapsing them into one
  // "nothing to propagate" would answer none of those.
  'PropagationNoScope',
  'PropagationNoComponentAtPoint',
  'PropagationSelectionNothingFree',
  'PropagationNothingInScope',
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
    // Not "pick a different three". The vertex has a fourth crease with no angle
    // either, so there are four unknowns against closure's three equations and
    // nothing could be isolated. Measured, that crease is itself solvable at
    // k = 1 from the current state, so propagating is the actual next move.
    case 'TooManyUnknowns':
      return t(
        'tools:cpContext.completion.tooManyUnknowns',
        'Another crease here has no fold angle yet, so there is more than one unknown too many. Give it an angle, or run Propagate fold angles.'
      );
    case 'CreasesDoNotMeet':
      return t(
        'tools:cpContext.completion.creasesDoNotMeet',
        'These creases do not all meet at one point, so there is no single vertex to close.'
      );
    case 'PropagationNothingFree':
      return t(
        'tools:cpContext.propagation.nothingFree',
        'Every crease already has a fold angle. Make some unassigned first, then propagate.'
      );
    // Deliberately an instruction rather than an error. Nothing was decidable
    // means "you have not told me enough", which is a conversation.
    case 'PropagationNothingDecidable':
      return t(
        'tools:cpContext.propagation.nothingDecidable',
        'Nothing could be worked out from the angles already set. Give one more crease an angle and try again.'
      );
    // The kernel declines rather than falling back to the whole document, so
    // this is the sentence that stands where "propagate everything" used to be.
    case 'PropagationNoScope':
      return t(
        'tools:cpContext.propagation.noScope',
        'Click a crease or vertex to propagate from, or select the creases to solve.'
      );
    case 'PropagationNoComponentAtPoint':
      return t(
        'tools:cpContext.propagation.noComponentAtPoint',
        'Nothing to propagate here. Click on a crease or a vertex of the pattern you want.'
      );
    // Not `PropagationNothingFree`: "every crease already has a fold angle" is a
    // lie when the rest of the canvas is full of unassigned creases and the user
    // simply selected the wrong ones. Different next move, different sentence.
    case 'PropagationSelectionNothingFree':
      return t(
        'tools:cpContext.propagation.selectionNothingFree',
        'Every crease in the selection already has a fold angle. Select some unassigned creases, or clear the selection and click a pattern.'
      );
    case 'PropagationNothingInScope':
      return t(
        'tools:cpContext.propagation.nothingInScope',
        'The selection no longer names any creases. Select some again, or clear the selection and click a pattern.'
      );
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
