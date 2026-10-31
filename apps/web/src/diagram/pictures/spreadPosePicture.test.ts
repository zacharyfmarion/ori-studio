import { describe, expect, it } from 'vitest';
import type { ConnectedSpreadView } from '../../layer-spread/view';
import { spreadFrame } from '../../layer-spread/spreadFrame';
import { CAPTURE_PX_PER_UNIT } from '../capture/captureGeometry';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import { scenePicture } from '../document/diagramSteps.fixtures';
import { paintScene } from './paintDiagramStep';
import { stepPictureUrl } from './useStepPictureUrl';
import { spreadPosePicture, spreadPosePictureFrame } from './spreadPosePicture';

const view = { prepared: { source: {
  input: { xy: [[-1, -1], [1, 1]] },
  frame: { origin: [0, 0], ex: [1, 0], ey: [0, 1] },
} } } as ConnectedSpreadView;
const style = DEFAULT_DIAGRAM_STYLE;

describe('the final spread picture in a live viewport', () => {
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
  it('retains the existing image for captures kept as bitmaps', () => {
    const result = spreadPosePicture(null, style, 'raster.svg');
    expect(result).toEqual({ url: 'raster.svg', scene: null });
    expect(spreadPosePictureFrame(result, view, style, 0, false, {width: 900, height: 600}, 1)).toBeNull();
  });
});
