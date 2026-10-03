import { useEffect, useMemo, useState, type RefObject } from 'react';
import type {
  DiagramAnnotation,
  DiagramAsset,
  DiagramStep,
  DiagramStyle,
  KnownDiagramAsset,
} from '../document/diagramDocument';
import { annotatedPicture, hasDrawnAnnotations } from '../annotate/paintAnnotations';
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
  const { annotations } = step;
  return useMemo(
    () => (seen && source ? annotatedStepUrl(source, annotations, style) : null),
    [seen, source, annotations, style]
  );
}

/**
 * A step's picture with its annotations drawn on it (D8), through the cache:
 * the picture's own URL when none draws. `opacity` ghosts them, as Pose
 * shows them. Keyed by the picture as {@link stepPictureUrl} is, and by the
 * annotations' list, which an edit replaces rather than changes.
 */
export function annotatedStepUrl(
  source: StepPictureSource,
  annotations: readonly DiagramAnnotation[],
  style: DiagramStyle,
  opacity = 1
): string | null {
  if (!hasDrawnAnnotations(annotations)) return stepPictureUrl(source, style);
  const key = `annotated|${sourceKey(source)}|${objectSerial(annotations)}|${diagramStyleKey(style)}|${opacity}`;
  return cachedPictureUrl(key, () => {
    const painted = paintSource(source, style);
    return painted ? svgDataUrl(annotatedPicture(painted, annotations, style, opacity)) : null;
  });
}

/** What a source's picture is, for a key: the object it is drawn from, and how. */
function sourceKey(source: StepPictureSource): string {
  switch (source.kind) {
    case 'asset':
      return `asset|${objectSerial(source.asset)}|${source.pose.rotationQuarterTurns}|${source.pose.mirrored ? 'm' : ''}`;
    case 'scene':
      return `scene|${objectSerial(source.picture)}|${source.pattern ? 'pattern' : 'figure'}`;
    case 'fixed':
      return `fixed|${objectSerial(source.picture)}`;
    case 'step-diagram':
      return `step-diagram|${objectSerial(source.picture)}`;
  }
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
      const key = `${sourceKey(source)}|${diagramStyleKey(style)}`;
      return cachedPictureUrl(key, () => {
        const painted = paintScene(source, style);
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
