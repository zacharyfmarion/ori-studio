import { memo, useId, type ReactNode } from 'react';
import { annotationMarks, type AnnotationDrawing, type AnnotationLine } from '../../diagram/annotate/annotationPrimitives';
import type { DiagramStyle } from '../../diagram/document/diagramDocument';
import { diagramSurfaceStyle } from '../../diagram/pictures/diagramPaperStyle';
import { PT_TO_CSS_PX, type PaperStyle } from '../../lib/paper/paperStyle';
import { centredDashOffset, penDashPt, penForRole } from '../../lib/paper/paperSvg';

/**
 * One annotation line as the painter draws it (`lineElement`): its role's
 * pen at its pt width, its dash centred on it. In the drawing's own px,
 * where a pt is {@link PT_TO_CSS_PX} of them.
 */
function AnnotationLineShape({ line, style }: { line: AnnotationLine; style: PaperStyle }) {
  const pen = penForRole(style, line.role);
  const length = Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]);
  if (!pen || !(length > 0)) return null;
  const dash = penDashPt(pen)?.map((run) => run * PT_TO_CSS_PX) ?? null;
  return (
    <line
      x1={line.a[0]}
      y1={line.a[1]}
      x2={line.b[0]}
      y2={line.b[1]}
      stroke={pen.color}
      strokeWidth={pen.width * PT_TO_CSS_PX}
      strokeLinecap={pen.cap}
      strokeDasharray={dash?.join(' ')}
      strokeDashoffset={dash ? centredDashOffset(dash, length) : undefined}
    />
  );
}

/**
 * Annotations drawn live, as React, exactly as a picture is painted with them
 * (`paintAnnotations`): the lines in the style's pens, then the marks and
 * labels. In the drawing's px; the canvas places it on the picture's frame.
 * Each annotation is a group named by its id — but not drawn again inside a
 * close-up (`named` false), where they are only what the close-up shows.
 *
 * Drawn again only for a new drawing: the canvas's zoom, its selection and
 * whatever it shows over the marks for a moment re-render the canvas, not
 * the marks.
 *
 * A halo's pattern across a sheet's edge (rf6) is named for this layer too,
 * as the close-ups' clips are (`DiagramCloseUpInsides`): the canvas shares
 * one document with every other surface, and a `url(#…)` takes the first
 * element of its id there.
 */
export const DiagramAnnotationLayer = memo(function DiagramAnnotationLayer({
  drawing,
  style,
  named = true,
}: {
  drawing: AnnotationDrawing;
  style: DiagramStyle;
  named?: boolean;
}) {
  const surface = diagramSurfaceStyle(style);
  const scope = `-${useId().replace(/[^\w-]/g, '')}`;
  const wrap = (shape: ReactNode, id: string) => (
    <g key={id} data-annotation-id={named ? id : undefined}>
      {shape}
    </g>
  );
  return (
    <g strokeLinejoin="round">
      {drawing.lines.map((line) => (
        // A line behind a flap is drawn in pieces: one group each, all named by the line.
        <g key={`${line.id}:${line.part ?? 0}`} data-annotation-id={named ? line.id : undefined}>
          <AnnotationLineShape line={line} style={surface} />
        </g>
      ))}
      {annotationMarks(drawing, wrap, scope)}
    </g>
  );
});
