import { describe, expect, it } from 'vitest';
import {
  activeLineColorFromOrieditaMetadata,
  activeMouseModeFromOrieditaMetadata,
  canvasToolOptionsFromOrieditaMetadata,
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

  it('restores supported canvas custom line-type filters from Oriedita metadata', () => {
    expect(
      canvasToolOptionsFromOrieditaMetadata({
        'oriedita:ori:canvasModel': {
          customFromLineType: 'MANDV',
          customToLineType: 'VALLEY',
          delLineType: 'AUX',
        },
      })
    ).toEqual({
      customFromLineType: 'MountainAndValley',
      customToLineType: 'Valley',
      customLineType: 'Aux',
    });

    expect(
      canvasToolOptionsFromOrieditaMetadata({
        'oriedita:ori:canvasModel': {
          customFromLineType: -1,
          customToLineType: 0,
          delLineType: 2,
        },
      })
    ).toEqual({
      customFromLineType: 'Any',
      customToLineType: 'Edge',
      customLineType: 'Mountain',
    });
  });

  // Oriedita seeds the folded figure's scale/rotation from the crease-pattern
  // camera on every fold, so they are in that camera's units. Ori Studio draws
  // the pattern at 1x, so the camera has to come back out or the figure lands
  // oversized beside a pattern that did not grow with it.
  it('reads folded scale and rotation relative to the saved crease-pattern camera', () => {
    const model = foldedFigureModelFromOrieditaMetadata({
      'oriedita:ori:foldedFigureModel': { scale: 3.291611450853266, rotation: 180 },
      'oriedita:ori:creasePatternCamera': { cameraZoomX: 1.641504066038247, cameraAngle: 30 },
    });
    // The author zoomed the folded view to twice the crease pattern.
    expect(model!.scale).toBeCloseTo(2.005, 3);
    expect(model!.rotation).toBeCloseTo(150);
  });

  it('leaves folded scale and rotation alone for a default or absent camera', () => {
    const saved = { 'oriedita:ori:foldedFigureModel': { scale: 2.5, rotation: 90 } };
    expect(foldedFigureModelFromOrieditaMetadata(saved)).toMatchObject({
      scale: 2.5,
      rotation: 90,
    });
    expect(
      foldedFigureModelFromOrieditaMetadata({
        ...saved,
        'oriedita:ori:creasePatternCamera': { cameraZoomX: 1, cameraAngle: 0 },
      })
    ).toMatchObject({ scale: 2.5, rotation: 90 });
  });

  it('ignores a zero camera zoom rather than scaling the figure to nothing', () => {
    expect(
      foldedFigureModelFromOrieditaMetadata({
        'oriedita:ori:foldedFigureModel': { scale: 2 },
        'oriedita:ori:creasePatternCamera': { cameraZoomX: 0 },
      })!.scale
    ).toBe(2);
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
      // The camera is preserved for round-tripping but no longer *restored*: it
      // describes the view its author last had, not the document, and applying
      // it to the canvas transform is what misplaced folded figures.
      restored: ['Canvas line color', 'Canvas tool', 'Folded colors', 'Folded model'],
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
