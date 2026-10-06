import { useMemo } from 'react';
import {
  isKnownAnnotation,
  type DiagramAnnotation,
  type DiagramStyle,
} from '../document/diagramDocument';
import type { StepPictureSource } from '../pictures/paintDiagramStep';
import { closeUpPictureUrl, zoomedPictureUrl } from '../pictures/useStepPictureUrl';
import type { ZoomedSource } from '../zoom/paintZoomed';
import { closeUpScale, type PictureFrame } from './annotationModel';
import { annotationDrawing, closeUpMarks, type AnnotationDrawing } from './annotationPrimitives';
import type { PictureLayers } from './pictureGeometry';

/** A close-up's inside as the Annotate canvas draws it (15f), in the drawing's px. */
export interface CloseUpInside {
  id: string;
  /** The close-up's ring, its inside clipped to it. */
  clip: { x: number; y: number; r: number };
  /** What the inside is filled with under the picture: the page's white. */
  ground: string;
  /** The picture painted again, larger, and where its box lands. */
  picture: { url: string; x: number; y: number; width: number; height: number } | null;
  /** The step's other marks drawn larger, and where their drawing's frame lands. */
  marks: { drawing: AnnotationDrawing; x: number; y: number };
}

/** What a canvas's close-ups' insides are drawn from. */
export interface CloseUpInsidesInput {
  /** The canvas's drawing, compiled with the frame `framePx` across. */
  drawing: AnnotationDrawing | null;
  /** The annotations as the canvas draws them, a drag's included. */
  shown: readonly DiagramAnnotation[];
  /** The step's, as the store has them: the scale each close-up's picture is painted at. */
  committed: readonly DiagramAnnotation[];
  source: StepPictureSource | null;
  /** An enlarged step's window: what its close-ups show of its picture (Revision 2). */
  zoomed?: ZoomedSource | null;
  style: DiagramStyle;
  layers: PictureLayers | null;
  pictureFrame: PictureFrame | null;
  framePx: number;
}

/**
 * Each close-up's inside on the Annotate canvas (15f), as a page paints it:
 * the picture painted again at the close-up's scale, its pens at their print
 * weight, and the step's other marks — `shown`, a drag's included — drawn
 * larger with it. The picture is painted at the scale the step has the
 * close-up at (`committed`): a ring dragged stretches the picture it has
 * until the drag lands and it is painted again at the new one, and a move
 * only shifts it. On an enlarged step, its window painted again, clipped to
 * its frame with its boundary, as its card's close-ups are.
 */
export function closeUpInsides({
  drawing,
  shown,
  committed,
  source,
  zoomed = null,
  style,
  layers,
  pictureFrame,
  framePx,
}: CloseUpInsidesInput): readonly CloseUpInside[] {
  if (!drawing || drawing.closeUps.length === 0 || !pictureFrame) return [];
  const others = closeUpMarks(shown);
  return drawing.closeUps.map((closeUp): CloseUpInside => {
    const stored = committed.find((annotation) => annotation.id === closeUp.id);
    const paintedAt = stored && isKnownAnnotation(stored) ? closeUpScale(stored) : closeUp.scale;
    const painted = zoomed
      ? zoomedPictureUrl(zoomed, style, paintedAt)
      : source
        ? closeUpPictureUrl(source, style, paintedAt)
        : null;
    const { frame } = closeUp;
    // Its frame on the close-up's: a pixel for a pixel, unless painted at another scale.
    const m = painted ? Math.max(frame.width, frame.height) / Math.max(painted.frame.width, painted.frame.height) : 1;
    return {
      id: closeUp.id,
      clip: closeUp.inset,
      ground: closeUp.ground,
      picture: painted && {
        url: painted.url,
        x: frame.x - painted.frame.x * m,
        y: frame.y - painted.frame.y * m,
        width: painted.widthPx * m,
        height: painted.heightPx * m,
      },
      marks: { drawing: annotationDrawing(others, pictureFrame, framePx * closeUp.scale, style, layers), x: frame.x, y: frame.y },
    };
  });
}

/** {@link closeUpInsides}, worked out again only when what it is drawn from changes. */
export function useCloseUpInsides(input: CloseUpInsidesInput): readonly CloseUpInside[] {
  const { drawing, shown, committed, source, zoomed = null, style, layers, pictureFrame, framePx } = input;
  return useMemo(
    () => closeUpInsides({ drawing, shown, committed, source, zoomed, style, layers, pictureFrame, framePx }),
    [drawing, shown, committed, source, zoomed, style, layers, pictureFrame, framePx]
  );
}
