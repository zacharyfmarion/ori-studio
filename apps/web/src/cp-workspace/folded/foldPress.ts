/**
 * What a Layer order press found open, and whether it still holds.
 *
 * A press folds before the dialog opens, and the dialog stays open while the
 * user works, so what the press folded can be gone by the time its fold
 * lands or its Apply commits: a crease edited meanwhile, the document closed
 * or replaced (File ▸ New, Open), or every handle torn down with it. An Apply
 * that commits anyway folds the old creases into whatever is open now, and a
 * figure found by id may be another document's.
 *
 * So a press is marked when it is made, and both Layer order hosts in Edit
 * (Layer order… on a figure, Fold with layer order… on a selection) check the
 * mark before the dialog opens and again before Apply writes. When it moved,
 * nothing is written and the user is told why.
 *
 * The mark is three numbers the store already keeps: the crease pattern's
 * edit count, which load of a crease pattern is open, and the handles'
 * generation (`foldedFigureHandleEpoch`, bumped when a document's handles are
 * torn down). Store-free: the caller hands the state in.
 */
import type { TFunction } from 'i18next';
import type { WorkspaceState } from '../../store/workspaceStore/types';
import { foldedFigureHandleEpoch } from './foldedFigureHandles';

export interface FoldPress {
  /** The crease pattern's edit count (`oristudioCpRevision`). */
  readonly revision: number;
  /** Which load of a crease pattern was open (`loadSerial`); null with none. */
  readonly loadSerial: number | null;
  /** The handles' generation (`foldedFigureHandleEpoch`). */
  readonly epoch: number;
}

type FoldPressState = Pick<WorkspaceState, 'oristudioCpRevision' | 'oristudioCpDocument'>;

/** Mark a press on the state it is made in. */
export function markFoldPress(state: FoldPressState): FoldPress {
  return {
    revision: state.oristudioCpRevision,
    loadSerial: state.oristudioCpDocument?.loadSerial ?? null,
    epoch: foldedFigureHandleEpoch(),
  };
}

/** Whether the crease pattern a press was made on has changed or gone since. */
export function foldPressMoved(press: FoldPress, state: FoldPressState): boolean {
  const now = markFoldPress(state);
  return now.revision !== press.revision || now.loadSerial !== press.loadSerial || now.epoch !== press.epoch;
}

/** What a press that moved says, wherever it stops. */
export function foldPressMovedMessage(t: TFunction): string {
  return t('errors:cp.layerOrderPatternChanged', 'The crease pattern changed meanwhile, so Layer order changed nothing.');
}
