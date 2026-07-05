import { describe, expect, it } from 'vitest';
import { CP_PAPER_RECT, ORIEDITA_PAPER_BOUNDS, modelPointToCpSvg } from './creasePatternViewport';
import {
  DEFAULT_ORIEDITA_CAMERA,
  isDefaultOrieditaCamera,
  orieditaCameraFromMetadata,
  orieditaCameraFromValue,
  orieditaCameraSvgScale,
  orieditaObjectToSvg,
  orieditaObjectToTv,
  orieditaSvgToObject,
  orieditaSvgToTv,
  orieditaTvToObject,
  orieditaTvToSvg,
} from './orieditaCamera';

describe('Oriedita camera helpers', () => {
  it('keeps the default Oriedita camera visually identical to the existing CP paper mapping', () => {
    const points = [
      { x: -200, y: -200 },
      { x: 0, y: 0 },
      { x: 200, y: 200 },
    ];

    for (const point of points) {
      const cameraPoint = orieditaObjectToSvg(point, DEFAULT_ORIEDITA_CAMERA);
      const existingPoint = modelPointToCpSvg(point, ORIEDITA_PAPER_BOUNDS);
      expect(cameraPoint.x).toBeCloseTo(existingPoint.x);
      expect(cameraPoint.y).toBeCloseTo(existingPoint.y);
    }
  });

  it('matches Oriedita object2TV transform order for rotation', () => {
    const camera = {
      ...DEFAULT_ORIEDITA_CAMERA,
      cameraAngle: 90,
    };
    const tv = orieditaObjectToTv({ x: 10, y: 0 }, camera);

    expect(tv.x).toBeCloseTo(350);
    expect(tv.y).toBeCloseTo(340);
  });

  it('matches Oriedita object2TV transform order for mirror and non-uniform zoom', () => {
    const camera = {
      ...DEFAULT_ORIEDITA_CAMERA,
      cameraMirror: -1,
      cameraZoomX: 2,
      cameraZoomY: 3,
    };

    expect(orieditaObjectToTv({ x: 10, y: 20 }, camera)).toEqual({ x: 330, y: 410 });
    expect(orieditaObjectToSvg({ x: 10, y: 20 }, camera)).toEqual({
      x: CP_PAPER_RECT.x + ((330 - 150) / 400) * CP_PAPER_RECT.width,
      y: CP_PAPER_RECT.y + ((410 - 150) / 400) * CP_PAPER_RECT.height,
    });
    expect(orieditaCameraSvgScale(camera)).toEqual({
      x: (2 * CP_PAPER_RECT.width) / 400,
      y: (3 * CP_PAPER_RECT.height) / 400,
    });
  });

  it('round-trips object, TV, and local SVG coordinates through the inverse transform', () => {
    const camera = {
      cameraPositionX: 12.5,
      cameraPositionY: -7.25,
      cameraAngle: 37,
      cameraMirror: -1,
      cameraZoomX: 1.75,
      cameraZoomY: 0.5,
      displayPositionX: 390,
      displayPositionY: 310,
    };
    const objectPoint = { x: -45.25, y: 83.5 };
    const tvPoint = orieditaObjectToTv(objectPoint, camera);
    const svgPoint = orieditaTvToSvg(tvPoint);

    expect(orieditaTvToObject(tvPoint, camera).x).toBeCloseTo(objectPoint.x);
    expect(orieditaTvToObject(tvPoint, camera).y).toBeCloseTo(objectPoint.y);
    expect(orieditaSvgToTv(svgPoint).x).toBeCloseTo(tvPoint.x);
    expect(orieditaSvgToTv(svgPoint).y).toBeCloseTo(tvPoint.y);
    expect(orieditaSvgToObject(svgPoint, camera).x).toBeCloseTo(objectPoint.x);
    expect(orieditaSvgToObject(svgPoint, camera).y).toBeCloseTo(objectPoint.y);
  });

  it('parses saved Oriedita camera metadata with defaults and cameraPosition fallback', () => {
    expect(
      orieditaCameraFromMetadata({
        'oriedita:ori:creasePatternCamera': {
          cameraPosition: '3.0,4.5',
          cameraAngle: 12,
          cameraMirror: -1,
          cameraZoomX: 2,
          displayPositionY: 375,
        },
      })
    ).toEqual({
      cameraPositionX: 3,
      cameraPositionY: 4.5,
      cameraAngle: 12,
      cameraMirror: -1,
      cameraZoomX: 2,
      cameraZoomY: 1,
      displayPositionX: 350,
      displayPositionY: 375,
    });
    expect(orieditaCameraFromMetadata({})).toBeNull();
    expect(isDefaultOrieditaCamera(orieditaCameraFromValue({}))).toBe(true);
  });
});
