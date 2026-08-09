import { useMemo, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  OristudioBpCoverageRegion,
  OristudioBpRiver,
  OristudioBpSheet,
} from '../../engine/oristudioBpTypes';
import { bpRiverIdFromGraphicsId } from '../../lib/bpPackingRivers';
import { bpPackingCoveragePath } from '../../lib/bpPackingViewport';
import type { PlotRect } from '../../lib/geometry';

/**
 * A river's *band* — the paper it actually takes up — as its shade and its hit
 * target.
 *
 * This is Box Pleating Studio's `River` control: it fills the node's contours
 * with their children punched out as holes (`fillContours`, `beginHole`) and
 * makes that fill the hit area (`$setupHit(this._shade)`), shading it while
 * hovered or selected. The band being the target is what makes the geometry
 * inside a river — nested rivers, flaps, creases, gadgets — reachable: they sit
 * in the holes, which are not part of the fill and so are not hit.
 *
 * Before this layer the target was the river's closed contour drawn as a filled
 * primitive, which had neither property: a click in a hole selected the
 * enclosing river, and two nested rivers were resolved by draw order rather
 * than by containment.
 *
 * Hover is CSS, not state: a React hover would re-render the pane on every
 * pointer move across the canvas.
 */
export function BpPackingRiverBandLayer({
  coverage,
  rivers,
  sheet,
  paperRect,
  selectedRiverIds,
  shadeSelected,
  onPointerDown,
}: {
  coverage: OristudioBpCoverageRegion[];
  rivers: OristudioBpRiver[];
  sheet: OristudioBpSheet;
  paperRect: PlotRect;
  selectedRiverIds: ReadonlySet<number>;
  /** Whether a selected band is tinted, following the selection-shade layer. */
  shadeSelected: boolean;
  onPointerDown: (event: PointerEvent<SVGGElement>, riverId: number) => void;
}) {
  const { t } = useTranslation();
  // One group per river, not per contour: a river may be drawn as several
  // contours (a band split by the sheet edge), and they are one thing to click.
  const bands = useMemo(() => {
    const byRiver = new Map<number, string[]>();
    for (const region of coverage) {
      const riverId = bpRiverIdFromGraphicsId(region.id, rivers);
      if (riverId === null) continue;
      const paths = byRiver.get(riverId);
      const d = bpPackingCoveragePath(region, sheet, paperRect);
      if (paths) paths.push(d);
      else byRiver.set(riverId, [d]);
    }
    return [...byRiver].map(([id, paths]) => ({ id, paths }));
  }, [coverage, rivers, sheet, paperRect]);

  if (bands.length === 0) return null;

  return (
    <g className="bp-packing-river-bands">
      {bands.map((band) => (
        // Labelled but not focusable, like every other target on this canvas: a
        // focus ring here would be drawn over the geometry being grabbed.
        <g
          key={band.id}
          className={
            shadeSelected && selectedRiverIds.has(band.id)
              ? 'bp-packing-river-band-group bp-packing-river-band-group--selected'
              : 'bp-packing-river-band-group'
          }
          aria-label={t('panels:bpPacking.selectRiverShort', 'Select BP river {{id}}', {
            id: band.id,
          })}
          data-bp-select={`river:${band.id}`}
          onPointerDown={(event) => onPointerDown(event, band.id)}
        >
          {band.paths.map((d, index) => (
            <path
              key={index}
              className="bp-packing-river-band"
              d={d}
              // The rule the path is built for: a node's own rings are disjoint
              // and properly nested, so even-odd punches the children out
              // exactly (see bpPackingCoveragePath).
              fillRule="evenodd"
            />
          ))}
        </g>
      ))}
    </g>
  );
}
