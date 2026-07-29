import type { AnnotationBox } from '../annotations/annotationTransform';

/**
 * Where a window sits on screen, split into the part that survives a camera move
 * and the part that does not.
 *
 * The layout box is sized at `renderedPxPerModel` — the scale the window's
 * bitmap was last drawn for — and everything the camera has done since is a
 * transform. That is what keeps a pan or zoom off the layout path: at twenty
 * windows, writing `left`/`top`/`width`/`height` per frame relaid out the whole
 * layer, and because a canvas whose box changes wakes its ResizeObserver, it
 * also made every window re-render. Measured at 640 bitmaps a second.
 */
export interface InlineSimulationPlacement {
  /** Layout size in CSS px. Changes only when the camera settles. */
  width: number;
  height: number;
  /** The whole camera-varying part. Changes every frame; costs no layout. */
  transform: string;
}

export function inlineSimulationPlacement(options: {
  box: AnnotationBox;
  /** Box centre in CSS px under the live camera. */
  center: { x: number; y: number };
  /** Screen-space rotation of the box under the live camera, in radians. */
  angle: number;
  /** Live camera scale. */
  pxPerModel: number;
  /** Camera scale the layout box — and the bitmap in it — were built for. */
  renderedPxPerModel: number;
}): InlineSimulationPlacement {
  const { box, center, angle, pxPerModel, renderedPxPerModel } = options;
  const base = renderedPxPerModel > 0 ? renderedPxPerModel : pxPerModel;
  const scale = base > 0 ? pxPerModel / base : 1;
  return {
    width: box.width * base,
    height: box.height * base,
    // Right-to-left: centre the box on its own origin, scale and rotate about
    // that centre, then put the centre where the camera says. Paired with
    // `transform-origin: 0 0`.
    transform:
      `translate(${center.x}px, ${center.y}px) ` +
      `rotate(${angle}rad) scale(${scale}) translate(-50%, -50%)`,
  };
}

/**
 * The size a window actually paints at — layout box times the transform's scale.
 *
 * Exists for the test that matters: this must not depend on
 * `renderedPxPerModel`, or settling would move the window rather than just
 * sharpen it.
 */
export function paintedSize(placement: InlineSimulationPlacement): {
  width: number;
  height: number;
} {
  const scale = Number(/scale\(([-\d.e]+)\)/.exec(placement.transform)?.[1] ?? 1);
  return { width: placement.width * scale, height: placement.height * scale };
}
