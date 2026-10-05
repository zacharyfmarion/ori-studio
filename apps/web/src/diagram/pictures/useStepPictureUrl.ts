import { useEffect, useMemo, useState, type RefObject } from 'react';
import type {
  DiagramAnnotation,
  DiagramAsset,
  DiagramStep,
  DiagramStyle,
  KnownDiagramAsset,
} from '../document/diagramDocument';
import { annotatedPicture, hasDrawnAnnotations } from '../annotate/paintAnnotations';
import { pictureGeometry, type PictureLayers } from '../annotate/pictureGeometry';
import { diagramStyleKey } from './diagramPaperStyle';
import {
  paintAsset,
  paintScene,
  paintSource,
  poseTransform,
  stepPictureSource,
  type PictureBox,
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
  const seen = useNearView(element);
  const source = useMemo(() => stepPictureSource(step, assets), [step, assets]);
  // A flat fold's layers: a mark behind a flap is dotted under it (15e).
  const layers = useMemo(() => pictureGeometry(step, assets, style).layers, [step, assets, style]);
  const { annotations } = step;
  return useMemo(
    () => (seen && source ? annotatedStepUrl(source, annotations, style, 1, true, layers) : null),
    [seen, source, annotations, style, layers]
  );
}

/**
 * A step's picture with its annotations drawn on it (D8), through the cache:
 * the picture's own URL when none draws. `opacity` ghosts them, as Pose
 * shows them. Keyed by the picture as {@link stepPictureUrl} is, and by the
 * annotations' list, which an edit replaces rather than changes. A picture
 * shown for a moment — a drag's preview — is painted and not `kept`: every
 * frame of a drag is a new picture, and the cache would give up the cards'
 * for them. `layers`, the picture's, dot a mark behind a flap (15e). A
 * close-up's inside is the picture painted again larger (15f) — but not
 * ghosted, as Pose shows the marks over a picture being posed: there a
 * close-up is its rings, as its inside would show the picture before the
 * pose.
 */
export function annotatedStepUrl(
  source: StepPictureSource,
  annotations: readonly DiagramAnnotation[],
  style: DiagramStyle,
  opacity = 1,
  kept = true,
  layers: PictureLayers | null = null
): string | null {
  if (!hasDrawnAnnotations(annotations)) return stepPictureUrl(source, style, kept);
  const key = `annotated|${sourceKey(source)}|${objectSerial(annotations)}|${diagramStyleKey(style)}|${opacity}|${layers ? 'layers' : ''}`;
  return throughCache(key, kept, () => {
    const painted = paintSource(source, style);
    const paintAt = opacity < 1 ? null : (scale: number) => paintSource(source, style, undefined, scale);
    return painted ? svgDataUrl(annotatedPicture(painted, annotations, style, opacity, layers, paintAt)) : null;
  });
}

/** `paint`'s URL, through the cache when it is to be `kept`. */
function throughCache(key: string, kept: boolean, paint: () => string | null): string | null {
  return kept ? cachedPictureUrl(key, paint) : paint();
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
 * `null` only for a scene that does not read. A scene not `kept` is painted
 * and not cached ({@link annotatedStepUrl}).
 */
export function stepPictureUrl(source: StepPictureSource, style: DiagramStyle, kept = true): string | null {
  switch (source.kind) {
    case 'asset':
      return posedAssetUrl(source.asset, source.pose);
    case 'scene': {
      const key = `${sourceKey(source)}|${diagramStyleKey(style)}`;
      return throughCache(key, kept, () => {
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

/** A picture painted for a close-up's inside on the canvas (15f): its URL, its size and where its frame is on it. */
export interface CloseUpPictureUrl {
  url: string;
  widthPx: number;
  heightPx: number;
  frame: PictureBox;
}

/** What a scene or a References step painted at a scale measures, by picture object and style and scale. */
const closeUpSizes = new WeakMap<object, Map<string, Omit<CloseUpPictureUrl, 'url'>>>();

/**
 * A step's picture `scale` times the size every picture opens at, for a
 * close-up's inside on the canvas (15f), through the cache: a scene or a
 * References step painted afresh, its pens at their print weight; an upload
 * or a fixed picture its own URL, drawn larger whole. Null for a scene that
 * does not read.
 */
export function closeUpPictureUrl(source: StepPictureSource, style: DiagramStyle, scale: number): CloseUpPictureUrl | null {
  if (source.kind === 'asset' || source.kind === 'fixed') {
    // Its own picture, its frame the whole of it, at `scale` times its size.
    const url = stepPictureUrl(source, style);
    const { widthPx, heightPx } =
      source.kind === 'asset' ? poseTransform(source.asset.widthPx, source.asset.heightPx, source.pose) : source.picture;
    const [width, height] = [widthPx * scale, heightPx * scale];
    return url ? { url, widthPx: width, heightPx: height, frame: { x: 0, y: 0, width, height } } : null;
  }
  const at = `${diagramStyleKey(style)}|${scale}`;
  let sizes = closeUpSizes.get(source.picture);
  if (!sizes) {
    sizes = new Map();
    closeUpSizes.set(source.picture, sizes);
  }
  const url = cachedPictureUrl(`close-up|${sourceKey(source)}|${at}`, () => {
    const painted = paintSource(source, style, undefined, scale);
    if (!painted) return null;
    sizes.set(at, { widthPx: painted.widthPx, heightPx: painted.heightPx, frame: painted.frame });
    return svgDataUrl(painted.svg);
  });
  const size = sizes.get(at);
  return url && size ? { url, ...size } : null;
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

/**
 * Whether the element has come near the view (within the paint-ahead margin
 * of its scroller); stays true once it has. What a card waits for before it
 * paints a picture.
 */
export function useNearView(element: RefObject<Element | null>): boolean {
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
