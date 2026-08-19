import type { OristudioBpPackingView, OristudioBpSheet } from '../engine/oristudioBpTypes';
import { bpPackingFlapClearanceRect, bpPackingRectToSvg } from './bpPackingViewport';
import type { PlotRect } from './geometry';

export interface BpPatternlessStretchVisual {
  id: string;
  active: boolean;
  /** Clearance rings of the flaps taking part, in SVG space. */
  flaps: (PlotRect & { radius: number })[];
  /** The stretch's own span, one rect per junction, in SVG space. */
  regions: PlotRect[];
}

/**
 * What the "no crease pattern" warning points at, in canvas space.
 *
 * Nothing else on the canvas distinguishes an overlap with no pattern from
 * ordinary empty paper — the flaps look normal and the region simply comes out
 * without creases. The flaps taking part are what the user has to move, so they
 * are what gets ringed.
 *
 * `regions` is kept separate because it is the gap *between the flap tips*: for
 * point flaps at opposite ends of the sheet that is a large box, so a pane
 * should reveal it on selection rather than draw it unasked.
 */
export function bpPatternlessStretchVisuals(
  packing: Pick<OristudioBpPackingView, 'stretches' | 'flaps'>,
  sheet: OristudioBpSheet,
  paperRect: PlotRect,
  selectedStretchIds: ReadonlySet<string>,
): BpPatternlessStretchVisual[] {
  return packing.stretches
    .filter((stretch) => stretch.patternFound === false)
    .map((stretch) => ({
      id: stretch.id,
      active: selectedStretchIds.has(stretch.id),
      flaps: stretch.flapIds.flatMap((id) => {
        const flap = packing.flaps.find((candidate) => candidate.id === id);
        return flap ? [bpPackingFlapClearanceRect(flap, sheet, paperRect)] : [];
      }),
      regions: stretch.regions.map((region) => bpPackingRectToSvg(region, sheet, paperRect)),
    }));
}
