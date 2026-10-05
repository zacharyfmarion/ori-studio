import { useId } from 'react';
import type { CloseUpInside } from '../../diagram/annotate/useCloseUpInsides';
import type { DiagramStyle } from '../../diagram/document/diagramDocument';
import { DiagramAnnotationLayer } from './DiagramAnnotationLayer';

/**
 * The close-ups' insides on the Annotate canvas (15f), under the marks, as a
 * page paints them (`paintAnnotations`): the page's white, the picture
 * painted again, larger, and the step's other marks with it, clipped to the
 * close-up's ring, which the marks draw over its edge. In the drawing's px,
 * as the marks are. Nothing here is named by an annotation's id: a press
 * finds a close-up by where it is, not by what it shows.
 */
export function DiagramCloseUpInsides({ insides, style }: { insides: readonly CloseUpInside[]; style: DiagramStyle }) {
  const base = `close-up-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  if (insides.length === 0) return null;
  return (
    <g data-close-up-insides="">
      {insides.map((inside, index) => {
        const id = `${base}-${index}`;
        const { clip, picture, marks } = inside;
        return (
          <g key={inside.id} data-close-up-inside={inside.id}>
            <clipPath id={id}>
              <circle cx={clip.x} cy={clip.y} r={clip.r} />
            </clipPath>
            <g clipPath={`url(#${id})`}>
              <circle cx={clip.x} cy={clip.y} r={clip.r} fill={inside.ground} />
              {picture && (
                <image
                  href={picture.url}
                  x={picture.x}
                  y={picture.y}
                  width={picture.width}
                  height={picture.height}
                  preserveAspectRatio="none"
                />
              )}
              <g transform={`translate(${marks.x} ${marks.y})`}>
                <DiagramAnnotationLayer drawing={marks.drawing} style={style} named={false} />
              </g>
            </g>
          </g>
        );
      })}
    </g>
  );
}
