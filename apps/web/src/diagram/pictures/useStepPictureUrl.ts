import { useEffect, useMemo, useState, type RefObject } from 'react';
import type {
  DiagramAsset,
  DiagramStep,
  DiagramStyle,
  KnownDiagramAsset,
} from '../document/diagramDocument';
import { diagramStyleKey } from './diagramPaperStyle';
import {
  paintAsset,
  paintScene,
  paintSource,
  stepPictureSource,
  type PicturePose,
  type StepPictureSource,
} from './paintDiagramStep';
import { cachedPictureUrl, objectSerial, svgDataUrl } from './stepPictureCache';

/** How far outside the view a card starts painting, so a scroll lands on pictures. */
const PAINT_AHEAD = '400px';

/**
 * The URL a card shows its step's picture from, or `null` while it has none or
 * has not come near the view yet.
 *
 * Painting waits until the card is within {@link PAINT_AHEAD} of being seen
 * (IntersectionObserver), and is cached ({@link stepPictureUrl}), so a long
 * diagram costs only the cards looked at, and a remount costs nothing.
 */
export function useStepPictureUrl(
  element: RefObject<Element | null>,
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  style: DiagramStyle
): string | null {
  const seen = useSeen(element);
  const source = useMemo(() => stepPictureSource(step, assets), [step, assets]);
  return useMemo(() => (seen && source ? stepPictureUrl(source, style) : null), [seen, source, style]);
}

/**
 * A step's picture as a URL an `<img>` can show, through the cache: keyed by
 * the picture object — two opens of one project are two objects, and a file
 * edited between them must not show the first one's picture — and by what
 * else the painting reads: the pose, and for a scene the diagram's pens.
 * `null` only for a scene that does not read.
 */
export function stepPictureUrl(source: StepPictureSource, style: DiagramStyle): string | null {
  switch (source.kind) {
    case 'asset':
      return posedAssetUrl(source.asset, source.pose);
    case 'scene': {
      const { picture, measure } = source;
      const key = `scene|${objectSerial(picture)}|${measure}|${diagramStyleKey(style)}`;
      return cachedPictureUrl(key, () => {
        const painted = paintScene(picture, measure, style);
        return painted ? svgDataUrl(painted.svg) : null;
      });
    }
    case 'fixed': {
      const { picture } = source;
      const paint = () => svgDataUrl(picture.svg);
      return cachedPictureUrl(`fixed|${objectSerial(picture)}`, paint) ?? paint();
    }
    case 'step-diagram': {
      const key = `step-diagram|${objectSerial(source.picture)}|${diagramStyleKey(style)}`;
      const paint = () => svgDataUrl(paintSource(source, style)!.svg);
      return cachedPictureUrl(key, paint) ?? paint();
    }
  }
}

/**
 * An asset in a pose as a URL an `<img>` can show, through the cache. An
 * upright bitmap is its own data URL: wrapping it would only encode it again.
 */
export function posedAssetUrl(asset: KnownDiagramAsset, pose: PicturePose): string {
  const { rotationQuarterTurns: turns, mirrored } = pose;
  if (asset.kind === 'raster' && turns === 0 && !mirrored) return asset.src;
  const key = `${objectSerial(asset)}|${turns}|${mirrored ? 'm' : ''}`;
  const paint = () => svgDataUrl(paintAsset(asset, pose).svg);
  // Never null: this paint always draws something, and only "nothing" goes uncached.
  return cachedPictureUrl(key, paint) ?? paint();
}

/** Whether the element has come near the view; stays true once it has. */
function useSeen(element: RefObject<Element | null>): boolean {
  // Without an observer (a test environment) everything counts as seen.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen) return undefined;
    const target = element.current;
    if (!target) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      // The margin grows only the root; with the viewport as root, the pane's
      // own scroller would still clip a card until it was on screen.
      { root: scrollingAncestor(target), rootMargin: PAINT_AHEAD }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [element, seen]);
  return seen;
}

/** The nearest ancestor that scrolls, or `null` for the viewport. */
function scrollingAncestor(element: Element): Element | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}
