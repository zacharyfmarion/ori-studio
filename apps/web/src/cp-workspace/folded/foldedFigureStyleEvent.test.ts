import { describe, expect, it } from 'vitest';
import { foldedFigureStyleOptions } from './foldedFigureStyleEvent';

describe('foldedFigureStyleOptions', () => {
  it('names the row a patch came from', () => {
    expect(foldedFigureStyleOptions({ state: 'Back1' })).toEqual(['side']);
    expect(foldedFigureStyleOptions({ front_color: { red: 1, green: 2, blue: 3 } })).toEqual([
      'front_color',
    ]);
    expect(foldedFigureStyleOptions({ back_color: { red: 1, green: 2, blue: 3 } })).toEqual([
      'back_color',
    ]);
    expect(foldedFigureStyleOptions({ line_color: { red: 1, green: 2, blue: 3 } })).toEqual([
      'line_color',
    ]);
    expect(foldedFigureStyleOptions({ display_shadows: true })).toEqual(['shadow']);
  });

  it('sends nothing for a field the menu does not edit', () => {
    expect(foldedFigureStyleOptions({ scale: 2, rotation: 90, anti_alias: true })).toEqual([]);
    expect(foldedFigureStyleOptions({})).toEqual([]);
  });

  it('never carries a value, only the row', () => {
    const options = foldedFigureStyleOptions({ front_color: { red: 9, green: 9, blue: 9 } });
    expect(JSON.stringify(options)).not.toContain('9');
  });
});
