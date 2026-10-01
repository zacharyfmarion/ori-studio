import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_STYLE } from './paperStyle';
import { legacyPaperStyleOverrides } from './paperStyleMigration';

const ORIEDITA = {
  front_color: { red: 255, green: 255, blue: 50 },
  back_color: { red: 233, green: 233, blue: 233 },
  line_color: { red: 0, green: 0, blue: 0 },
};

describe('legacyPaperStyleOverrides', () => {
  it('reads Oriedita’s default colours as following the app style', () => {
    expect(legacyPaperStyleOverrides(ORIEDITA)).toBeUndefined();
    expect(legacyPaperStyleOverrides(undefined)).toBeUndefined();
  });

  it('pins only the colours that were changed', () => {
    expect(
      legacyPaperStyleOverrides({ ...ORIEDITA, back_color: { red: 0, green: 128, blue: 255 } })
    ).toEqual({ 'paper.back': '#0080ff' });
  });

  it('pins the whole edge pen for a changed line colour', () => {
    expect(
      legacyPaperStyleOverrides({ ...ORIEDITA, line_color: { red: 255, green: 0, blue: 0 } })
    ).toEqual({ edges: { ...DEFAULT_PAPER_STYLE.edges, color: '#ff0000' } });
  });
});
