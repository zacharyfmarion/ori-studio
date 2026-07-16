import type { OristudioCpFoldedFigureState } from '../engine/oristudioCpTypes';

/**
 * Order + wraparound of Oriedita's `FoldedFigure.State.advance()`, which its
 * `FlipAction` invokes: Front → Back → Both → Transparent → Front. Keeping this
 * faithful is what makes the folded-form "Flip" match the reference app.
 */
export const FOLDED_STATE_CYCLE: readonly OristudioCpFoldedFigureState[] = [
  'Front0',
  'Back1',
  'Both2',
  'Transparent3',
];

/** The next side to show, cycling per {@link FOLDED_STATE_CYCLE}. */
export function advanceFoldedState(
  state: OristudioCpFoldedFigureState
): OristudioCpFoldedFigureState {
  const index = FOLDED_STATE_CYCLE.indexOf(state);
  return FOLDED_STATE_CYCLE[(index + 1) % FOLDED_STATE_CYCLE.length] ?? 'Front0';
}
