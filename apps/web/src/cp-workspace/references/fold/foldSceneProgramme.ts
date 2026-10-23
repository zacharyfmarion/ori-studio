/**
 * A References card's fold as the shared transport plays it: the legs its
 * flaps make, how fast they go, and whether the card plays on arrival.
 */
import {
  FOLD_PACE,
  TURN_OVER_PACE,
  foldLegs,
  type FoldLegPace,
} from '../../../lib/foldMotion/foldPlayback';
import type { FoldProgramme } from '../../../lib/foldMotion/foldTransport';
import type { FoldScene, FoldSceneKind } from './foldScene';

/** A card's programme, carrying the scene's facts the analytics event reports. */
export interface FoldSceneProgramme extends FoldProgramme<FoldSceneKind> {
  way?: FoldScene['way'];
}

/** How a card of this kind goes. */
export function legPace(kind: FoldSceneKind): FoldLegPace {
  return kind === 'turn-over' ? TURN_OVER_PACE : FOLD_PACE;
}

/**
 * What a card plays: each of its flaps in turn, at its kind's pace.
 *
 * A fold card plays on arrival only with auto-play on: the animation is
 * there to be asked for, and a reader stepping through with the arrow keys
 * should not have the paper moving under every card. A turn-over plays
 * regardless: it has no crease to read and nothing to line up, and the sheet
 * turning over *is* the card — left flat, it is a symbol on an unchanged
 * sheet (Zach, 2026-09-16).
 */
export function foldSceneProgramme(scene: FoldScene): FoldSceneProgramme {
  return {
    kind: scene.kind,
    legs: foldLegs(scene.flaps.length, legPace(scene.kind)),
    arrival: scene.kind === 'turn-over' ? 'always' : 'auto-play',
    ...(scene.way ? { way: scene.way } : {}),
  };
}
