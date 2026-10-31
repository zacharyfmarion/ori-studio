import type { ConnectedSpreadView } from '../../layer-spread/view';
import { spreadFrame } from '../../layer-spread/spreadFrame';
import { pageMarginPt, pagePtPerPx } from '../../lib/paper/paperSvg';
import { CAPTURE_PX_PER_UNIT } from '../capture/captureGeometry';
import type { DiagramStyle } from '../document/diagramDocument';
import { diagramScenePaintStyle } from './diagramPaperStyle';
import { STEP_CARD_PADDING_MM, stepScenePage, type StepPictureSource } from './paintDiagramStep';
import { storedScene } from './pictureFrame';
import { stepPictureUrl } from './useStepPictureUrl';

/** The same ink Pages paints, without Pose's ghost annotations. A bitmap or
 * fixed picture has no retained scene frame, so uses the normal picture fit. */
export function spreadPosePicture(source: StepPictureSource | null, style: DiagramStyle, fallbackUrl: string | null) {
  const scene = source?.kind === 'scene' ? storedScene(source.picture) : null;
  return { url: scene && source ? stepPictureUrl(source, style) : fallbackUrl, scene };
}
export type SpreadPosePicture = ReturnType<typeof spreadPosePicture>;

/** Place the saved vector ink in the live viewport's coordinates. Fitting the
 * image to the panel would jump in size at rest and undo the camera's zoom.
 * This uses only cached bounds and print margins, never polygon clipping. */
export function spreadPosePictureFrame(
  picture: SpreadPosePicture,
  view: ConnectedSpreadView,
  style: DiagramStyle,
  rotationDeg: number,
  spatial: boolean,
  size: { width: number; height: number },
  zoom: number,
) {
  if (!picture.scene) return null;
  const page = stepScenePage(STEP_CARD_PADDING_MM);
  const margin = pageMarginPt(diagramScenePaintStyle(style, false), page) / pagePtPerPx(picture.scene, page, 'figure');
  const frame = spreadFrame(view, rotationDeg, spatial, size.width, size.height, zoom);
  const k = frame.scale / CAPTURE_PX_PER_UNIT;
  const b = picture.scene.bounds;
  return {
    left: `${100 * (frame.x + (b.minX - margin) * k) / size.width}%`,
    top: `${100 * (frame.y + (b.minY - margin) * k) / size.height}%`,
    width: `${100 * (b.maxX - b.minX + 2 * margin) * k / size.width}%`,
    height: `${100 * (b.maxY - b.minY + 2 * margin) * k / size.height}%`,
  };
}
