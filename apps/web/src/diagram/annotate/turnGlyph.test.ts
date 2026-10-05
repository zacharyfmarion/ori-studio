import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE, type DiagramTurnKind } from '../document/diagramDocument';
import { paintTurnGlyph, turnFollowsReading } from './turnGlyph';

const sideToSide: DiagramTurnKind = { kind: 'turn-over', axis: 'vertical' };
const topToBottom: DiagramTurnKind = { kind: 'turn-over', axis: 'horizontal' };
const rotate: DiagramTurnKind = { kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } };
const box = { x: 100, y: 40, width: 56.7, height: 56.7 };

describe('a turn’s glyph in a row read right to left', () => {
  it('mirrors a turn-over side to side about its frame’s middle, so its arrow leads on', () => {
    const ahead = paintTurnGlyph(sideToSide, box, DEFAULT_DIAGRAM_STYLE, 'turn-a')!;
    const back = paintTurnGlyph(sideToSide, box, DEFAULT_DIAGRAM_STYLE, 'turn-a', { rightToLeft: true })!;
    const across = 2 * box.x + box.width;
    expect(back.markup).toBe(`<g transform="matrix(-1 0 0 1 ${across} 0)">${ahead.markup}</g>`);
    expect(back.bounds).toEqual({
      ...ahead.bounds,
      x: expect.closeTo(across - ahead.bounds.x - ahead.bounds.width, 9),
    });
  });

  it('leaves a turn-over top to bottom pointing down, and a rotation turning the way it says', () => {
    for (const turn of [topToBottom, rotate]) {
      expect(turnFollowsReading(turn)).toBe(false);
      expect(paintTurnGlyph(turn, box, DEFAULT_DIAGRAM_STYLE, 't', { rightToLeft: true })).toEqual(
        paintTurnGlyph(turn, box, DEFAULT_DIAGRAM_STYLE, 't')
      );
    }
    expect(turnFollowsReading(sideToSide)).toBe(true);
  });
});
