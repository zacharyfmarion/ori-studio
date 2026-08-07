import { useId, useMemo } from 'react';
import type { OristudioBpCoverageRegion, OristudioBpSheet } from '../../engine/oristudioBpTypes';
import { bpPackingCoveragePath, bpPackingSheetBorderPoints } from '../../lib/bpPackingViewport';
import type { PlotRect } from '../../lib/geometry';

/**
 * Shades the paper no flap and no river takes up.
 *
 * Drawn as a luminance mask rather than one even-odd path over the sheet,
 * because coverage regions overlap wherever the packing is invalid — that
 * overlap is what makes it invalid — and an even-odd or winding fill would
 * cancel there and paint the most-covered paper as empty. Masking is idempotent:
 * black over black is still black. Even-odd is still used *within* a region,
 * where it is exact, so a river's hole reads as empty unless a child covers it.
 *
 * Nothing is shaded when there are no coverage regions at all. A layout that has
 * not been computed is not evidence that the paper is empty.
 */
export function BpPackingEmptySpaceLayer({
  coverage,
  sheet,
  paperRect,
}: {
  coverage: OristudioBpCoverageRegion[];
  sheet: OristudioBpSheet;
  paperRect: PlotRect;
}) {
  const maskId = useId();
  const hatchId = useId();
  const paths = useMemo(
    () =>
      coverage.map((region) => ({
        id: region.id,
        d: bpPackingCoveragePath(region, sheet, paperRect),
      })),
    [coverage, paperRect, sheet]
  );
  const sheetPoints = useMemo(
    () =>
      bpPackingSheetBorderPoints(sheet, paperRect)
        .map((point) => `${point.x},${point.y}`)
        .join(' '),
    [paperRect, sheet]
  );

  if (paths.length === 0) return null;

  return (
    <g className="bp-packing-empty-space" aria-hidden="true">
      <defs>
        {/* Diagonal hatch, laid over the tint. The tint alone reads as "another
            region"; the hatch says "nothing lives here", which is what empty
            paper is. Fills only — neither shape is outlined, because a box drawn
            around each gap reads as a region of its own rather than as paper
            going unused. */}
        <pattern
          id={hatchId}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line className="bp-packing-empty-space-hatch" x1="0" y1="0" x2="0" y2="8" />
        </pattern>
        {/* A mask is luminance-keyed, so these two fills are the mask's on and
            off values and not theme colours. Everything a theme gets to style is
            on the shapes below. */}
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <polygon points={sheetPoints} fill="#fff" />
          {paths.map((path) => (
            <path key={path.id} d={path.d} fill="#000" fillRule="evenodd" />
          ))}
        </mask>
      </defs>
      {/* Two shapes rather than a tinted pattern tile: a background inside the
          tile would be rotated with it, and the seams between rotated tiles show
          as hairlines. Masking the group applies the cut-out to both at once. */}
      <g mask={`url(#${maskId})`}>
        <polygon className="bp-packing-empty-space-fill" points={sheetPoints} />
        <polygon
          className="bp-packing-empty-space-lines"
          points={sheetPoints}
          fill={`url(#${hatchId})`}
        />
      </g>
    </g>
  );
}
