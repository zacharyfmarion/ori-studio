import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { DiagramAsset, DiagramStep, KnownDiagramAsset } from '../document/diagramDocument';
import { paintAsset, stepPictureSource, type PicturePose } from './paintDiagramStep';
import { cachedPictureUrl, objectSerial, svgDataUrl } from './stepPictureCache';

/** How far outside the view a card starts painting, so a scroll lands on pictures. */
const PAINT_AHEAD = '400px';

/**
 * The URL a card shows its step's picture from, or `null` while it has none or
 * has not come near the view yet.
 *
 * Painting waits until the card is within {@link PAINT_AHEAD} of being seen
 * (IntersectionObserver), and is cached by the asset object and the pose, so a
 * long diagram costs only the cards looked at, and a remount costs nothing.
 * An upright bitmap is shown from its own data URL: wrapping it would only
 * encode it a second time.
 */
export function useStepPictureUrl(
  element: RefObject<Element | null>,
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>
): string | null {
  const seen = useSeen(element);
  const source = stepPictureSource(step, assets);
  const asset = source?.asset ?? null;
  const turns = source?.pose.rotationQuarterTurns ?? 0;
  const mirrored = source?.pose.mirrored ?? false;
  return useMemo(
    () => (seen && asset ? posedAssetUrl(asset, { rotationQuarterTurns: turns, mirrored }) : null),
    [seen, asset, turns, mirrored]
  );
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
