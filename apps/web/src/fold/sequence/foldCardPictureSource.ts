import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import type { FoldEngineStateHandle } from '../engine/foldEnginePort';

/** What a card's picture is of. */
export interface FoldCardPictureSource {
  /** The state, to ask its scene of. */
  readonly state: FoldEngineStateHandle;
  /** What names the state whatever its handle: its fingerprint, else its handle. */
  readonly key: string;
  /** The layer spread the card shows the state with, as the folded pane would (`foldStepSpread`); null for none. */
  readonly spread: LayerSpreadOptions | null;
}

/** What names a state with no fingerprint yet — the step a tool is folding — in a picture's key. */
export function foldCardHandleKey(state: FoldEngineStateHandle): string {
  return `handle:${state.generation}:${state.id}`;
}

/** A state's picture source: by its fingerprint when it has one, spread by `spread`. Null for no state. */
export function foldCardPictureSource(
  state: FoldEngineStateHandle | null,
  fingerprint: string | null = null,
  spread: LayerSpreadOptions | null = null
): FoldCardPictureSource | null {
  if (!state) return null;
  return { state, key: fingerprint ?? foldCardHandleKey(state), spread };
}

