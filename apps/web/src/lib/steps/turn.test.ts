import { describe, expect, it } from 'vitest';
import {
  formatTurnDegrees,
  readTurnRotation,
  sameTurnKind,
  turnRotationDegrees,
  turnRotationGlyphText,
  turnRotationOfDegrees,
  withTurnDirection,
  withTurnPreset,
  writeTurnRotation,
  type TurnKind,
  type TurnRotation,
} from './turn';

describe('sameTurnKind', () => {
  const sideToSide: TurnKind = { kind: 'turn-over', axis: 'vertical' };
  const topToBottom: TurnKind = { kind: 'turn-over', axis: 'horizontal' };
  const quarterCw: TurnKind = { kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } };
  const thirtyCw: TurnKind = { kind: 'rotate', rotate: { amount: 'degrees', degrees: 30, direction: 'cw' } };

  it('matches a turn field by field, not by identity', () => {
    expect(sameTurnKind(sideToSide, { kind: 'turn-over', axis: 'vertical' })).toBe(true);
    expect(sameTurnKind(quarterCw, { kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } })).toBe(true);
    expect(sameTurnKind(thirtyCw, { kind: 'rotate', rotate: { amount: 'degrees', degrees: 30, direction: 'cw' } })).toBe(true);
  });

  it('tells turns apart by kind, axis, amount, angle and direction', () => {
    expect(sameTurnKind(sideToSide, topToBottom)).toBe(false);
    expect(sameTurnKind(sideToSide, quarterCw)).toBe(false);
    expect(sameTurnKind(quarterCw, sideToSide)).toBe(false);
    expect(sameTurnKind(quarterCw, { kind: 'rotate', rotate: { amount: 'half', direction: 'cw' } })).toBe(false);
    expect(sameTurnKind(quarterCw, { kind: 'rotate', rotate: { amount: 'quarter', direction: 'ccw' } })).toBe(false);
    expect(sameTurnKind(thirtyCw, { kind: 'rotate', rotate: { amount: 'degrees', degrees: 31, direction: 'cw' } })).toBe(false);
    expect(sameTurnKind(thirtyCw, quarterCw)).toBe(false);
  });
});

describe('a rotation by an exact angle', () => {
  const exact = (degrees: number, direction: 'cw' | 'ccw' = 'cw'): TurnRotation => ({ amount: 'degrees', degrees, direction });

  it('is a finite angle that turns the model at all: none for no number, 0 or a whole turn', () => {
    expect(turnRotationOfDegrees(30, 'cw')).toEqual(exact(30));
    expect(turnRotationOfDegrees(Number.NaN, 'cw')).toBeNull();
    expect(turnRotationOfDegrees(Number.POSITIVE_INFINITY, 'cw')).toBeNull();
    expect(turnRotationOfDegrees(0, 'cw')).toBeNull();
    expect(turnRotationOfDegrees(-0, 'ccw')).toBeNull();
    expect(turnRotationOfDegrees(360, 'cw')).toBeNull();
    expect(turnRotationOfDegrees(-720, 'cw')).toBeNull();
  });

  it('is normalised: a turn’s worth at most, the other way when negative or past a half turn', () => {
    expect(turnRotationOfDegrees(390, 'cw')).toEqual(exact(30));
    expect(turnRotationOfDegrees(-30, 'cw')).toEqual(exact(30, 'ccw'));
    expect(turnRotationOfDegrees(-30, 'ccw')).toEqual(exact(30, 'cw'));
    expect(turnRotationOfDegrees(300, 'cw')).toEqual(exact(60, 'ccw'));
    expect(turnRotationOfDegrees(-300, 'cw')).toEqual(exact(60, 'cw'));
    expect(turnRotationOfDegrees(179.5, 'ccw')).toEqual(exact(179.5, 'ccw'));
    // Kept to a millionth of a degree: what is typed, without the noise of reducing it.
    expect(turnRotationOfDegrees(400.1, 'cw')).toEqual(exact(40.1));
  });

  it('is a preset at a preset’s angle, so every rotation has one spelling', () => {
    expect(turnRotationOfDegrees(45, 'cw')).toEqual({ amount: 'eighth', direction: 'cw' });
    expect(turnRotationOfDegrees(90, 'ccw')).toEqual({ amount: 'quarter', direction: 'ccw' });
    expect(turnRotationOfDegrees(270, 'cw')).toEqual({ amount: 'quarter', direction: 'ccw' });
    expect(turnRotationOfDegrees(180, 'ccw')).toEqual({ amount: 'half', direction: 'ccw' });
    expect(turnRotationOfDegrees(-180, 'cw')).toEqual({ amount: 'half', direction: 'ccw' });
  });

  it('says how far it turns, and changes amount or direction keeping the rest', () => {
    expect(turnRotationDegrees({ amount: 'eighth', direction: 'cw' })).toBe(45);
    expect(turnRotationDegrees({ amount: 'half', direction: 'ccw' })).toBe(180);
    expect(turnRotationDegrees(exact(22.5))).toBe(22.5);
    expect(withTurnPreset(exact(30, 'ccw'), 'quarter')).toEqual({ amount: 'quarter', direction: 'ccw' });
    expect(withTurnDirection(exact(30), 'ccw')).toEqual(exact(30, 'ccw'));
    expect(withTurnDirection({ amount: 'half', direction: 'cw' }, 'ccw')).toEqual({ amount: 'half', direction: 'ccw' });
  });

  it('is written with its degrees between, a preset exactly as before, and read back only as written', () => {
    expect(JSON.stringify(writeTurnRotation({ amount: 'quarter', direction: 'cw' }))).toBe('{"amount":"quarter","direction":"cw"}');
    expect(JSON.stringify(writeTurnRotation(exact(30, 'ccw')))).toBe('{"amount":"degrees","degrees":30,"direction":"ccw"}');
    for (const rotation of [{ amount: 'eighth', direction: 'ccw' } as const, exact(30), exact(179.25, 'ccw')]) {
      expect(readTurnRotation(writeTurnRotation(rotation))).toEqual(rotation);
    }
    // Not as this build writes one: no rotation.
    expect(readTurnRotation({ amount: 'degrees', direction: 'cw' })).toBeNull();
    expect(readTurnRotation({ amount: 'degrees', degrees: '30', direction: 'cw' })).toBeNull();
    expect(readTurnRotation({ amount: 'degrees', degrees: 0, direction: 'cw' })).toBeNull();
    expect(readTurnRotation({ amount: 'degrees', degrees: -30, direction: 'cw' })).toBeNull();
    expect(readTurnRotation({ amount: 'degrees', degrees: 200, direction: 'cw' })).toBeNull();
    expect(readTurnRotation({ amount: 'degrees', degrees: 90, direction: 'cw' })).toBeNull();
    expect(readTurnRotation({ amount: 'quarter', degrees: 90, direction: 'cw' })).toBeNull();
    expect(readTurnRotation({ amount: 'third', direction: 'cw' })).toBeNull();
    expect(readTurnRotation({ amount: 'quarter', direction: 'up' })).toBeNull();
  });

  it('is printed in degrees, to two places at most, where a preset prints its fraction', () => {
    expect(formatTurnDegrees(30)).toBe('30');
    expect(formatTurnDegrees(22.5)).toBe('22.5');
    expect(formatTurnDegrees(100 / 3)).toBe('33.33');
    expect(turnRotationGlyphText(exact(30))).toBe('30°');
    expect(turnRotationGlyphText({ amount: 'eighth', direction: 'cw' })).toBe('1/8');
  });
});
