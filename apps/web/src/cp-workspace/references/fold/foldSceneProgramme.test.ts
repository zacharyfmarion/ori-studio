import { describe, expect, it } from 'vitest';
import { FOLD_PACE, TURN_OVER_PACE, foldLegs } from '../../../lib/foldMotion/foldPlayback';
import type { FoldScene, FoldSceneKind } from './foldScene';
import { foldSceneProgramme, legPace } from './foldSceneProgramme';

const FLAP: FoldScene['flaps'][number] = {
  chord: [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
  ],
  side: 1,
  polygon: [],
  creased: [],
};

function scene(kind: FoldSceneKind = 'cp', flaps = 1): FoldScene {
  return { kind, flaps: Array.from({ length: flaps }, () => FLAP), sheetShortSide: 1, reach: 1 };
}

describe('legPace', () => {
  it('turns the sheet over at its own pace, and folds every other card at the fold’s', () => {
    expect(legPace('turn-over')).toBe(TURN_OVER_PACE);
    expect(legPace('cp')).toBe(FOLD_PACE);
    expect(legPace('reference')).toBe(FOLD_PACE);
  });
});

describe('foldSceneProgramme', () => {
  it('plays each of the card’s flaps in turn, at its kind’s pace', () => {
    expect(foldSceneProgramme(scene('cp', 2))).toEqual({
      kind: 'cp',
      legs: foldLegs(2, FOLD_PACE),
      arrival: 'auto-play',
    });
    expect(foldSceneProgramme(scene('reference')).legs).toEqual(foldLegs(1, FOLD_PACE));
  });

  it('turns the sheet over on every arrival, and waits to be asked on a fold', () => {
    expect(foldSceneProgramme(scene('turn-over'))).toEqual({
      kind: 'turn-over',
      legs: foldLegs(1, TURN_OVER_PACE),
      arrival: 'always',
    });
    for (const kind of ['cp', 'aux', 'press', 'reference'] as const) {
      expect(foldSceneProgramme(scene(kind)).arrival).toBe('auto-play');
    }
  });

  it('carries which way a card with other ways is folded, and nothing on one without', () => {
    expect(foldSceneProgramme({ ...scene(), way: 'alternative' }).way).toBe('alternative');
    expect(foldSceneProgramme({ ...scene(), way: 'recommended' }).way).toBe('recommended');
    expect(foldSceneProgramme(scene())).not.toHaveProperty('way');
  });
});
