import type { CpCheckClass } from '../annotations/suppressionRegion';
import { useCpRegions } from './useCpRegions';
import { SuppressionRegionChip } from './SuppressionRegionChip';
import {
  SolveRegionChip,
  CP_REGION_SOLVE_IDLE,
  type CpRegionSolveState,
} from './SolveRegionChip';

/** How a host runs a solve and settles its outcome, keyed by region. */
export interface CpRegionSolveBinding {
  /**
   * Where this region's solve has got to. `undefined` for one that has not run,
   * so a host holding a `Map` can pass its `get` straight in.
   */
  stateFor: (regionId: string) => CpRegionSolveState | undefined;
  onSolve: (regionId: string) => void;
  onAccept: (regionId: string) => void;
  onTryAgain: (regionId: string) => void;
}

export interface CpRegionLayerProps {
  /**
   * Element the canvas is positioned against — the anchor's viewport offset and
   * each chip's collision boundary. Null renders nothing, which is what a
   * viewport that has not laid out yet should do.
   */
  container: HTMLElement | null;
  /**
   * How to run and settle a solve. Omitted, no chip offers Solve at all.
   *
   * Two separate questions, kept separate on purpose: **whether a region can be
   * solved** is the attachment's presence and nothing else, and **whether this
   * host can service one** is this prop. A region with an attachment mounted
   * without a binding gets the base chip rather than a dead button — a control
   * that does nothing is worse than an absent one, and the region is still a
   * perfectly good suppressor meanwhile.
   */
  solve?: CpRegionSolveBinding | null;
}

/**
 * Every check-suppression region's chip, mounted for as long as the region
 * exists.
 *
 * `CpTextAnnotationLayer` is the precedent for always-mounted per-object DOM, and
 * the reason here is the same shape but a stronger one: a text box has to be
 * readable without being selected because that is what a text box is *for*, and a
 * region has to be visible without being selected because it is **hiding
 * findings**. The chip carries the count of what it hides, which is the safety
 * affordance the whole scoped-filter design rests on.
 *
 * Structurally simpler than the text layer, though, because each chip is a
 * `FloatingToolbar` that portals itself to `body`: there is no positioned wrapper
 * here and no `zIndex` to pick, so the layer is a plain fragment and costs
 * nothing wherever it is mounted in the tree.
 *
 * It takes only what the panel uniquely owns — the element the canvas is
 * positioned against — and reads everything else from {@link useCpRegions}, the
 * way `CpDiagnosticHud` reads `useCpDiagnosticList`. The panel is a composition
 * site; it should not be assembling a region list, counting hidden findings, or
 * adapting eight callbacks on this layer's behalf.
 */
export function CpRegionLayer({ container, solve }: CpRegionLayerProps) {
  const {
    regions,
    selectRegion,
    toggleRegionCheckClass,
    setRegionOpacity,
    bringRegionToFront,
    sendRegionToBack,
    removeRegion,
    beginGesture,
    commitGesture,
  } = useCpRegions();

  return (
    <>
      {regions.map(({ region, selected, hiddenCount, solvable }) => {
        const base = {
          region,
          container,
          expanded: selected,
          hiddenCount,
          onSelect: () => selectRegion(region.id),
          onToggleCheckClass: (cpCheckClass: CpCheckClass) =>
            toggleRegionCheckClass(region.id, cpCheckClass),
          onOpacity: (value: number) => setRegionOpacity(region.id, value),
          onGestureStart: beginGesture,
          // The label comes from whoever opened the gesture — `AnnotationActions`
          // already names its own opacity drag, and a second name for the same
          // control would only make the undo list disagree with the image case.
          onGestureCommit: commitGesture,
          onBringToFront: () => bringRegionToFront(region.id),
          onSendToBack: () => sendRegionToBack(region.id),
          onDelete: () => removeRegion(region.id),
        };
        if (!solvable || !solve) {
          return <SuppressionRegionChip key={region.id} {...base} />;
        }
        return (
          <SolveRegionChip
            key={region.id}
            {...base}
            state={solve.stateFor(region.id) ?? CP_REGION_SOLVE_IDLE}
            onSolve={() => solve.onSolve(region.id)}
            onAccept={() => solve.onAccept(region.id)}
            onTryAgain={() => solve.onTryAgain(region.id)}
          />
        );
      })}
    </>
  );
}
