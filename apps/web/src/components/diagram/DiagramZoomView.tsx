import { useMemo } from 'react';
import { CARD_FRAME_PX } from '../../diagram/annotate/canvasInk';
import type { AnnotateLayout } from '../../diagram/annotate/useAnnotateCanvas';
import type { DiagramStyle } from '../../diagram/document/diagramDocument';
import { paintedFrameLongerPx } from '../../diagram/pictures/pictureFrame';
import { closeUpPictureUrl, zoomedPictureUrl, type CloseUpPictureUrl } from '../../diagram/pictures/useStepPictureUrl';
import {
  ZOOM_SURROUND_DIM,
  zoomBoundary,
  zoomEdgePen,
  zoomPlacement,
  type ZoomedSource,
} from '../../diagram/zoom/paintZoomed';
import { zoomEdgePaths } from '../../diagram/zoom/zoomEdge';
import type { PictureBox } from '../../diagram/zoom/zoomModel';
import { DEFAULT_PAPER_SIZE_MM } from '../../lib/paper/paperPage';
import styles from './DiagramZoomView.module.css';

/**
 * An enlarged step on the Annotate canvas (Revision 2): its window as its
 * card paints it — its own picture painted again so its pens have their
 * print weight against the marks over it, only what lies near the window,
 * clipped to its frame, with the boundary as its pages print it — laid on the
 * canvas's frame, and a hairline round the frame, where the picture's units
 * are measured, as the canvas marks any picture's frame. The window is the
 * canvas's frame, so the marks drawn over it are in their own units. Its
 * image is no larger than the window, however small the window is.
 *
 * With `surround` — the frame selected — the whole picture shows instead,
 * painted at the window's scale, the picture round the frame dimmed by the
 * page's white so what lies outside it can be seen, and the boundary over it.
 *
 * In the canvas's world px, under its marks; it takes no press.
 */
export function DiagramZoomView({
  zoomed,
  layout,
  style,
  surround = false,
}: {
  zoomed: ZoomedSource;
  layout: AnnotateLayout;
  style: DiagramStyle;
  surround?: boolean;
}) {
  const { view, source, pictureFrame, silhouette } = zoomed;
  const placement = useMemo(() => zoomPlacement(view, pictureFrame, layout.frame), [view, pictureFrame, layout.frame]);
  // The window as its card has it, 50 mm across: one picture per frame, cached.
  const windowImage = useMemo(() => {
    if (surround) return null;
    const painted = zoomedPictureUrl(zoomed, style, 1);
    return painted && imageOn(painted, layout.frame);
  }, [surround, zoomed, style, layout.frame]);
  // The whole picture at the scale its window is painted at, for the surround.
  const windowLonger = Math.max(view.window.width, view.window.height);
  const wholeImage = useMemo(() => {
    const atOne = surround ? paintedFrameLongerPx(source) : null;
    if (!atOne || !(windowLonger > 0)) return null;
    const painted = closeUpPictureUrl(source, style, CARD_FRAME_PX / windowLonger / atOne);
    return painted && imageOn(painted, placement.pictureFrame);
  }, [surround, source, style, windowLonger, placement.pictureFrame]);
  // The boundary as a card draws it, at its 50 mm: the canvas is a card's view, larger.
  const paths = useMemo(
    () => (wholeImage ? zoomEdgePaths(placement.outline, zoomBoundary(view, silhouette, DEFAULT_PAPER_SIZE_MM)) : []),
    [wholeImage, placement, view, silhouette]
  );
  const [outline] = useMemo(() => zoomEdgePaths(placement.outline, { kind: 'whole' }), [placement]);
  const pen = zoomEdgePen(style, layout.unit / CARD_FRAME_PX);
  const { world } = layout;
  // The page's white over all the picture round the frame: past the world too, where a small window's picture reaches.
  const shade = wholeImage && {
    x: Math.min(world.x, wholeImage.x),
    y: Math.min(world.y, wholeImage.y),
    right: Math.max(world.x + world.width, wholeImage.x + wholeImage.width),
    bottom: Math.max(world.y + world.height, wholeImage.y + wholeImage.height),
  };
  return (
    <svg
      className={styles.view}
      width={world.width}
      height={world.height}
      viewBox={`0 0 ${world.width} ${world.height}`}
      aria-hidden="true"
      data-zoom-view=""
      data-surround={surround || undefined}
    >
      {windowImage && <image {...windowImage} preserveAspectRatio="none" data-zoom-window-picture="" />}
      {wholeImage && shade && (
        <g data-zoom-surround="">
          <image {...wholeImage} preserveAspectRatio="none" />
          {outline && (
            <path
              className={styles.dim}
              fillOpacity={ZOOM_SURROUND_DIM}
              d={`M ${shade.x} ${shade.y} H ${shade.right} V ${shade.bottom} H ${shade.x} Z ${outline}`}
            />
          )}
        </g>
      )}
      {paths.map((d, index) => (
        <path
          key={index}
          d={d}
          fill="none"
          stroke={pen.color}
          strokeWidth={pen.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-zoom-boundary=""
        />
      ))}
      {outline && <path className={styles.hairline} d={outline} />}
    </svg>
  );
}

/** A painted picture as an SVG image placed so its frame lies on `target`. */
function imageOn(painted: CloseUpPictureUrl, target: PictureBox) {
  const m = Math.max(target.width, target.height) / Math.max(painted.frame.width, painted.frame.height);
  return {
    href: painted.url,
    x: target.x - painted.frame.x * m,
    y: target.y - painted.frame.y * m,
    width: painted.widthPx * m,
    height: painted.heightPx * m,
  };
}
