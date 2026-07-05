import { describe, expect, it } from 'vitest';
import {
  activeLineColorFromOrieditaMetadata,
  activeMouseModeFromOrieditaMetadata,
  foldedFigureModelFromOrieditaMetadata,
  orieditaNativeMetadataStatus,
} from './orieditaNativeMetadata';

describe('oriedita native metadata', () => {
  it('maps Oriedita ORI foldedFigureModel fields to the runtime model shape', () => {
    const model = foldedFigureModelFromOrieditaMetadata({
      'oriedita:ori:foldedFigureModel': {
        frontColor: 'ff010203',
        backColor: 'ff040506',
        lineColor: 'ff070809',
        scale: 1.75,
        rotation: 45,
        antiAlias: false,
        displayShadows: true,
        state: 'BACK_1',
        foldedCases: 3,
        transparentTransparency: 64,
        transparencyColor: true,
      },
    });

    expect(model).toMatchObject({
      front_color: { red: 1, green: 2, blue: 3 },
      back_color: { red: 4, green: 5, blue: 6 },
      line_color: { red: 7, green: 8, blue: 9 },
      scale: 1.75,
      rotation: 45,
      anti_alias: false,
      display_shadows: true,
      state: 'Back1',
      folded_cases: 3,
      transparent_transparency: 64,
      transparency_color: true,
    });
  });

  it('uses ORH folded color metadata with default non-color model fields', () => {
    const model = foldedFigureModelFromOrieditaMetadata({
      'oriedita:orh:oriagarizu_front_color': [10, 20, 30],
      'oriedita:orh:oriagarizu_back_color': [40, 50, 60],
      'oriedita:orh:oriagarizu_line_color': [70, 80, 90],
    });

    expect(model).toMatchObject({
      front_color: { red: 10, green: 20, blue: 30 },
      back_color: { red: 40, green: 50, blue: 60 },
      line_color: { red: 70, green: 80, blue: 90 },
      scale: 1,
      state: 'Front0',
    });
  });

  it('returns null when no folded model metadata is present', () => {
    expect(foldedFigureModelFromOrieditaMetadata({})).toBeNull();
  });

  it('restores the active canvas line color with Oriedita toggle semantics', () => {
    expect(
      activeLineColorFromOrieditaMetadata({
        'oriedita:ori:canvasModel': {
          lineColor: 'RED_1',
          toggleLineColor: true,
        },
      })
    ).toBe('Blue2');
    expect(
      activeLineColorFromOrieditaMetadata({
        'oriedita:ori:canvasModel': {
          lineColor: 'YELLOW_7',
          toggleLineColor: true,
        },
      })
    ).toBe('Yellow7');
  });

  it('returns null when canvas model line color is absent or unknown', () => {
    expect(activeLineColorFromOrieditaMetadata({})).toBeNull();
    expect(
      activeLineColorFromOrieditaMetadata({
        'oriedita:ori:canvasModel': {
          lineColor: 'FUTURE_COLOR_99',
        },
      })
    ).toBeNull();
  });

  it('restores the active Oriedita canvas mouse mode when present', () => {
    expect(
      activeMouseModeFromOrieditaMetadata({
        'oriedita:ori:canvasModel': {
          mouseMode: 'DRAW_CREASE_FREE_1',
        },
      })
    ).toBe('DRAW_CREASE_FREE_1');
  });

  it('returns null when canvas model mouse mode is absent or empty', () => {
    expect(activeMouseModeFromOrieditaMetadata({})).toBeNull();
    expect(
      activeMouseModeFromOrieditaMetadata({
        'oriedita:ori:canvasModel': {
          mouseMode: '   ',
        },
      })
    ).toBeNull();
  });

  it('summarizes restored and preserved native metadata fields', () => {
    expect(
      orieditaNativeMetadataStatus({
        'oriedita:ori:foldedFigureModel': {},
        'oriedita:ori:creasePatternCamera': {},
        'oriedita:ori:canvasModel': { lineColor: 'BLUE_2', mouseMode: 'DRAW_CREASE_FREE_1' },
        'oriedita:ori:unknownFutureField': {},
        'oriedita:orh:oriagarizu_front_color': [1, 2, 3],
      })
    ).toEqual({
      restored: ['Camera', 'Canvas line color', 'Canvas tool', 'Folded colors', 'Folded model'],
      preserved: ['Camera', 'Canvas', 'unknownFutureField'],
    });
  });

  it('does not report unsupported future mouse modes as restored', () => {
    expect(
      orieditaNativeMetadataStatus({
        'oriedita:ori:canvasModel': { mouseMode: 'FUTURE_MOUSE_MODE_999' },
      })
    ).toEqual({
      restored: [],
      preserved: ['Canvas'],
    });
  });

  it('returns null when metadata does not contain Oriedita-native fields', () => {
    expect(orieditaNativeMetadataStatus({ author: 'Ori Studio' })).toBeNull();
  });
});
