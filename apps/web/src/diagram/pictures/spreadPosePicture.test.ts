import { describe, expect, it } from 'vitest';
import type { ConnectedSpreadView } from '../../layer-spread/view';
import { spreadFrame } from '../../layer-spread/spreadFrame';
import { CAPTURE_PX_PER_UNIT } from '../capture/captureGeometry';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import { scenePicture } from '../document/diagramSteps.fixtures';
import { paintScene } from './paintDiagramStep';
import { stepPictureUrl } from './useStepPictureUrl';
import { posePictureBounds, spreadPosePicture, spreadPosePictureFrame } from './spreadPosePicture';
import { diagramScenePaintStyle } from './diagramPaperStyle';

const view = { prepared: { source: {
  input: { xy: [[-1, -1], [1, 1]] },
  frame: { origin: [0, 0], ex: [1, 0], ey: [0, 1] },
} } } as ConnectedSpreadView;
const style = DEFAULT_DIAGRAM_STYLE;

describe('the final spread picture in a live viewport', () => {
  it.each([1, 2])('matches the ordinary flat picture fit before spread is enabled (pixel ratio %s)', (pixelRatio) => {
    const flatView = { prepared: { source: { ...view.prepared.source,
      input: { xy: [[-120, -50], [120, 50]] },
    } } } as ConnectedSpreadView;
    const picture = scenePicture('flat');
    const scene = JSON.parse(picture.sceneJson);
    scene.bounds = { minX: -120 * CAPTURE_PX_PER_UNIT, minY: -50 * CAPTURE_PX_PER_UNIT,
      maxX: 120 * CAPTURE_PX_PER_UNIT, maxY: 50 * CAPTURE_PX_PER_UNIT };
    const source = { kind: 'scene' as const, picture: { ...picture, sceneJson: JSON.stringify(scene) }, pattern: false };
    const painted = paintScene(source, style)!;
    for (const [width, height] of [[900,600], [400,800]]) {
      const fitted = Math.min((width!-40)/painted.widthPx, (height!-84)/painted.heightPx);
      const expectedWidth = painted.frame.width * fitted * pixelRatio;
      const frame = spreadFrame(flatView, 0, false, width!*pixelRatio, height!*pixelRatio, 1,
        diagramScenePaintStyle(style, false), pixelRatio);
      expect(240 * frame.scale).toBeCloseTo(expectedWidth);
      expect(frame.x).toBeCloseTo(width!*pixelRatio/2);
      expect(frame.y).toBeCloseTo((height!/2-22)*pixelRatio);
    }
  });
  it('uses the same painted scene as Pages', () => {
    const source = { kind: 'scene' as const, picture: scenePicture('scene'), pattern: false };
    const result = spreadPosePicture(source, style, 'annotated-fallback.svg');
    expect(result.url).toBe(stepPictureUrl(source, style));
    expect(result.scene).not.toBeNull();
  });
  it.each([false, true])('keeps final ink aligned with live geometry (perspective: %s)', (spatial) => {
    const source = { kind: 'scene' as const, picture: scenePicture('scene'), pattern: false };
    const result = spreadPosePicture(source, style, null);
    const painted = paintScene(source, style)!;
    for (const ratio of [1, 2]) for (const zoom of [0.5, 2]) {
      const size = { width: 900 * ratio, height: 600 * ratio };
      const box = spreadPosePictureFrame(result, view, style, 35, spatial, size, zoom)!;
      const width = parseFloat(box.width) * size.width / 100;
      const height = parseFloat(box.height) * size.height / 100;
      const inkX = parseFloat(box.left) * size.width / 100 + width * painted.frame.x / painted.widthPx;
      const inkY = parseFloat(box.top) * size.height / 100 + height * painted.frame.y / painted.heightPx;
      const frame = spreadFrame(view, 35, spatial, size.width, size.height, zoom);
      expect(inkX).toBeCloseTo(frame.x + result.scene!.bounds.minX * frame.scale / CAPTURE_PX_PER_UNIT, 3);
      expect(inkY).toBeCloseTo(frame.y + result.scene!.bounds.minY * frame.scale / CAPTURE_PX_PER_UNIT, 3);
    }
  });
  it('uses unannotated raster ink and keeps ghosts in its padded frame', () => {
    const sceneFrame: [number, number, number, number] = [-12, 5, 80, 50];
    const source = { kind: 'asset' as const, asset: {
      id: 'raster', kind: 'raster' as const, src: 'data:image/png;base64,AA==', widthPx: 800, heightPx: 500, bytes: 1,
    }, pose: { rotationQuarterTurns: 0 as const, mirrored: false }, sceneFrame };
    const picture = spreadPosePicture(source, style, 'annotated.svg');
    expect(picture.url).toBe(stepPictureUrl(source, style));
    expect(picture.sceneFrame).toEqual(sceneFrame);
    expect(posePictureBounds({ kind: 'asset', assetId: 'raster', key: 'raster', paperScale: null, sceneFrame }))
      .toEqual({ minX: -12, minY: 5, maxX: 68, maxY: 55 });
  });
  it.each([false, true])('keeps a raster fallback in the live camera frame (perspective: %s)', (spatial) => {
    const picture = { url: 'raster.svg', scene: null, sceneFrame: [-12, 5, 80, 50] as [number, number, number, number] };
    for (const zoom of [0.5, 2]) {
      const size = { width: 900, height: 600 };
      const box = spreadPosePictureFrame(picture, view, style, 35, spatial, size, zoom)!;
      const frame = spreadFrame(view, 35, spatial, size.width, size.height, zoom);
      const k = frame.scale / CAPTURE_PX_PER_UNIT;
      expect(parseFloat(box.left) * size.width / 100).toBeCloseTo(frame.x - 12 * k);
      expect(parseFloat(box.top) * size.height / 100).toBeCloseTo(frame.y + 5 * k);
      expect(parseFloat(box.width) * size.width / 100).toBeCloseTo(80 * k);
      expect(parseFloat(box.height) * size.height / 100).toBeCloseTo(50 * k);
    }
  });
  it('retains the existing image for captures kept as bitmaps', () => {
    const result = spreadPosePicture(null, style, 'raster.svg');
    expect(result).toEqual({ url: 'raster.svg', scene: null });
    expect(spreadPosePictureFrame(result, view, style, 0, false, {width: 900, height: 600}, 1)).toBeNull();
  });
});
