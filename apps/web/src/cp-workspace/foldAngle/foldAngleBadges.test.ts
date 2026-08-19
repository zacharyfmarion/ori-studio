import { describe, expect, it } from 'vitest';
import {
  DOT_MIN_SCREEN_LENGTH,
  MAX_BADGES,
  NUMBER_MIN_SCREEN_LENGTH,
  badgeOverflowCount,
  planFoldAngleBadges,
  type FoldAngleBadgeInput,
} from './foldAngleBadges';

function horizontal(lineId: number, length: number, degrees = 90): FoldAngleBadgeInput {
  return { lineId, a: { x: 0, y: lineId }, b: { x: length, y: lineId }, degrees };
}

describe('fold angle badge planning', () => {
  it('draws the number when the crease has room for it', () => {
    const [badge] = planFoldAngleBadges([horizontal(1, NUMBER_MIN_SCREEN_LENGTH + 1)]);
    expect(badge.detail).toBe('number');
    expect(badge.degrees).toBe(90);
  });

  it('degrades to a dot when there is only a little room', () => {
    const [badge] = planFoldAngleBadges([horizontal(1, NUMBER_MIN_SCREEN_LENGTH - 1)]);
    expect(badge.detail).toBe('dot');
  });

  it('drops the badge entirely when a dot would be noise', () => {
    expect(planFoldAngleBadges([horizontal(1, DOT_MIN_SCREEN_LENGTH - 1)])).toEqual([]);
  });

  it('is blind to the sign of the angle', () => {
    // The layer feeds in signed rho so a mountain reads -90. Nothing here may
    // react to that: every decision is screen length, and `degrees` is payload.
    // Without this, a negative angle could plausibly be read as "no room".
    const lengths = [
      DOT_MIN_SCREEN_LENGTH - 1,
      DOT_MIN_SCREEN_LENGTH + 1,
      NUMBER_MIN_SCREEN_LENGTH + 1,
    ];
    for (const length of lengths) {
      const positive = planFoldAngleBadges([horizontal(1, length, 90)]);
      const negative = planFoldAngleBadges([horizontal(1, length, -90)]);
      expect(negative.map((b) => ({ ...b, degrees: Math.abs(b.degrees) }))).toEqual(positive);
    }
  });

  it('carries the sign through to the badge unchanged', () => {
    const [badge] = planFoldAngleBadges([horizontal(1, NUMBER_MIN_SCREEN_LENGTH + 1, -135)]);
    expect(badge.degrees).toBe(-135);
  });

  it('places the badge at the screen-space midpoint', () => {
    const [badge] = planFoldAngleBadges([
      { lineId: 1, a: { x: 10, y: 20 }, b: { x: 50, y: 60 }, degrees: 45 },
    ]);
    expect(badge.at).toEqual({ x: 30, y: 40 });
  });

  it('caps the badge count, keeping the longest creases', () => {
    const creases = Array.from({ length: MAX_BADGES + 50 }, (_, i) => horizontal(i + 1, 40 + i));
    const badges = planFoldAngleBadges(creases);
    expect(badges).toHaveLength(MAX_BADGES);
    // The 50 shortest were dropped, so the lowest surviving id is 51.
    expect(badges[0].lineId).toBe(51);
    expect(badgeOverflowCount(creases.length, badges)).toBe(50);
  });

  it('returns a stable id order whether or not the cap applied', () => {
    const few = planFoldAngleBadges([horizontal(3, 60), horizontal(1, 90), horizontal(2, 40)]);
    expect(few.map((badge) => badge.lineId)).toEqual([1, 2, 3]);

    const many = planFoldAngleBadges(
      Array.from({ length: MAX_BADGES + 10 }, (_, i) => horizontal(i + 1, 40 + i)),
    );
    expect(many.map((badge) => badge.lineId)).toEqual(
      [...many].sort((l, r) => l.lineId - r.lineId).map((badge) => badge.lineId),
    );
  });

  it('reports nothing to draw for an empty pattern', () => {
    expect(planFoldAngleBadges([])).toEqual([]);
    expect(badgeOverflowCount(0, [])).toBe(0);
  });
});
