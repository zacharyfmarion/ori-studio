import { scenePoint } from '../cp-workspace/folded/connectedSpreadSource';
import { turnClockwise } from '../lib/geometry';
import type { ConnectedSpreadView } from './view';
import { pageMarginPt, pagePtPerPx } from '../lib/paper/paperSvg';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../lib/paper/paperStyle';
import { DEFAULT_PAPER_SIZE_MM } from '../lib/paper/paperPage';
import { STEP_CARD_PADDING_MM } from '../diagram/pictures/pictureMetrics';

/** Stable framing uses only the flat paper, not another full render of it. */
export function spreadFrame(
  view: ConnectedSpreadView,
  rotationDeg: number,
  spatial: boolean,
  width: number,
  height: number,
  zoom = 1,
  style: PaperStyle = DEFAULT_PAPER_STYLE,
  pixelRatio = 1,
) {
  const turn = turnClockwise(rotationDeg);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const xy of view.prepared.source.input.xy) {
    const p = turn(scenePoint(view.prepared.source, xy));
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  // Match the ordinary Pose picture's contain fit, including its print margin
  // and toolbar clearance. Spread changes positions, never this flat frame.
  const page = { sheet: { mm: DEFAULT_PAPER_SIZE_MM }, paddingMm: STEP_CARD_PADDING_MM, background: null, keepHiddenFaces: false };
  const flat = { items: [], sheet: 1, bounds: { minX, minY, maxX, maxY } };
  const margin = pageMarginPt(style, page) / pagePtPerPx(flat, page, 'figure');
  const horizontal = 40 * pixelRatio, vertical = 84 * pixelRatio;
  const scale = spatial
    ? Math.min(width, height) / Math.max(1.2 * Math.hypot(maxX - minX, maxY - minY), 1e-9)
    : Math.min(Math.max(1, width - horizontal) / Math.max(maxX - minX + 2 * margin, 1e-9),
      Math.max(1, height - vertical) / Math.max(maxY - minY + 2 * margin, 1e-9)) * zoom;
  return {
    scale,
    x: width / 2 - (spatial ? 0 : (minX + maxX) / 2) * scale,
    y: height / 2 - (spatial ? 0 : 22 * pixelRatio + (minY + maxY) / 2 * scale),
  };
}
