import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import type { TurnKind } from './turn';
import { turnCardWords, turnDegreesLabel, turnLabel, turnName, turnPlace } from './turnWords';

const t = ((_key: string, fallback: string, values?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''))) as unknown as TFunction;

const sideToSide: TurnKind = { kind: 'turn-over', axis: 'vertical' };
const eighthCcw: TurnKind = { kind: 'rotate', rotate: { amount: 'eighth', direction: 'ccw' } };
const newer = { ...sideToSide, unknown: { kind: 'spin' } };

describe('turn words', () => {
  it('names a turn by how it turns, and a newer build’s only as one', () => {
    expect(turnName(sideToSide, t)).toBe('Turn over, side to side');
    expect(turnName(eighthCcw, t)).toBe('Rotate 1/8 turn counterclockwise');
    expect(turnName(newer, t)).toBe('Turn from a newer Ori Studio');
  });

  it('says where a turn stands, between two steps or at either end', () => {
    expect(turnLabel(sideToSide, { before: 3, after: 4 }, t)).toBe('Turn over, side to side, between steps 3 and 4');
    expect(turnLabel(sideToSide, { before: null, after: 1 }, t)).toBe('Turn over, side to side, before step 1');
    expect(turnLabel(eighthCcw, { before: 2, after: null }, t)).toBe('Rotate 1/8 turn counterclockwise, after step 2');
    // A sequence of turns alone: there is nowhere to say.
    expect(turnLabel(sideToSide, { before: null, after: null }, t)).toBe('Turn over, side to side');
    expect(turnPlace({ before: 3, after: 4 }, t)).toBe('Between steps 3 and 4');
    expect(turnPlace({ before: null, after: 1 }, t)).toBe('Before step 1');
    expect(turnPlace({ before: 2, after: null }, t)).toBe('After step 2');
    expect(turnPlace({ before: null, after: null }, t)).toBeNull();
  });

  it('gives a card its title and how it turns', () => {
    expect(turnCardWords(sideToSide, t)).toEqual({ title: 'Turn over', how: 'Side to side' });
    expect(turnCardWords({ kind: 'turn-over', axis: 'horizontal' }, t)).toEqual({ title: 'Turn over', how: 'Top to bottom' });
    expect(turnCardWords(eighthCcw, t)).toEqual({ title: 'Rotate', how: '1/8 turn counterclockwise' });
    expect(turnCardWords(newer, t)).toEqual({ title: 'Turn', how: 'Turn from a newer Ori Studio' });
  });

  it('says an exact angle in degrees, either way round, wherever a turn is named', () => {
    const thirtyCw: TurnKind = { kind: 'rotate', rotate: { amount: 'degrees', degrees: 30, direction: 'cw' } };
    const halfDegreeCcw: TurnKind = { kind: 'rotate', rotate: { amount: 'degrees', degrees: 22.5, direction: 'ccw' } };
    expect(turnName(thirtyCw, t)).toBe('Rotate 30° clockwise');
    expect(turnName(halfDegreeCcw, t)).toBe('Rotate 22.5° counterclockwise');
    expect(turnCardWords(thirtyCw, t)).toEqual({ title: 'Rotate', how: '30° clockwise' });
    expect(turnCardWords(halfDegreeCcw, t)).toEqual({ title: 'Rotate', how: '22.5° counterclockwise' });
    expect(turnLabel(thirtyCw, { before: 3, after: 4 }, t)).toBe('Rotate 30° clockwise, between steps 3 and 4');
  });

  it('labels an exact angle as a choice beside the presets, as its card says it', () => {
    expect(turnDegreesLabel(30, t)).toBe('30°');
    expect(turnDegreesLabel(100 / 3, t)).toBe('33.33°');
  });
});
