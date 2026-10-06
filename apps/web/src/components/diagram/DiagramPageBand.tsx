import { memo, useMemo } from 'react';
import { bandPath } from '../../diagram/pages/composeDiagramPage';
import type { Lane } from '../../diagram/pages/flowLane';
import type { PrintPaper } from '../../diagram/pages/printPaper';
import { useLivePathColor } from '../../diagram/pages/usePathColorPick';
import { PT_PER_MM } from '../../lib/paper/paperSvg';

/**
 * A page's flow band in the Pages view, under the page's composed image,
 * which leaves it out (`composedPageUrl`'s `band: false`). It is the file's
 * band — the same path (`bandPath`), width, caps and joins, in the page's pt —
 * so the page still looks as it prints.
 *
 * Its own layer so that the colour is all a colour pick repaints: the colour
 * being picked while the picker is open (`pathColorPick.ts`), the diagram's
 * otherwise — never a new layout, and no page composed or decoded again.
 */
export const DiagramPageBand = memo(function DiagramPageBand({
  lane,
  widthMm,
  paper,
  color,
  className,
}: {
  lane: Lane;
  widthMm: number;
  paper: PrintPaper;
  /** The diagram's path colour, as it is now. */
  color: string;
  /** Placement only: over the page, under its image. */
  className?: string;
}) {
  const live = useLivePathColor();
  const d = useMemo(() => bandPath(lane), [lane]);
  return (
    <svg
      className={className}
      data-page-band=""
      aria-hidden="true"
      viewBox={`0 0 ${paper.widthMm * PT_PER_MM} ${paper.heightMm * PT_PER_MM}`}
    >
      <path
        d={d}
        fill="none"
        stroke={live ?? color}
        strokeWidth={widthMm * PT_PER_MM}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
});
