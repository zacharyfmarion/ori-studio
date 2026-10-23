import { useMemo } from 'react';
import type { FoldDirection } from '../../document/foldSequenceDocument';
import { isVertexTool } from '../../tools/foldToolCatalog';
import type { FoldToolState } from '../../tools/foldToolState';
import {
  fanGivenCreases,
  fanGivenOnFolded,
  fanRegionAt,
  fanRegionOnFolded,
  fanRegionOnSheet,
  type FoldFanCreasePiece,
  type FoldFanGiven,
} from '../../tools/vertex/fanGeometry';
import { fanGiven, fanHingeRegion, picksFanHinge } from '../../tools/vertex/vertexStep';
import type { FoldOverlayRegions } from '../foldPaneOverlays';
import type { FoldPendingCreases } from '../foldPaneScenes';
import type { FoldHit, FoldPaneId, FoldPickIndex } from '../foldPicking';

/** What a fan fold's clicks draw on the panes before the engine has said anything of it. */
export interface FoldFanMarks {
  /** The given creases on each layer the fan cuts: the paper's pending creases (`fanGivenCreases`). */
  creases: readonly FoldFanCreasePiece[];
  /** The way they fold, as the viewer sees it. */
  direction: FoldDirection;
  /**
   * The same creases as the panes draw them: on the folded pane each ray as
   * far as any layer it cuts reaches, in the pen of the direction; on the
   * crease pattern each layer's piece, by the letter it has from the front.
   */
  pending: FoldPendingCreases;
  /** While the hinge region is being picked, or picked again: its regions on each pane, and the one picked. */
  regions: Readonly<Record<FoldPaneId, FoldOverlayRegions>> | null;
}

/** The region a hit names: the paper under it, where it lies on the folded form. */
function regionOfHit(fan: FoldFanGiven): (hit: FoldHit) => number | null {
  return (hit) => (hit.pick?.kind === 'free' && hit.pick.sheet ? fanRegionAt(fan, hit.pick.scene) : null);
}

/**
 * A fan fold's marks from its clicks (`tools/vertex/fanGeometry`): once a
 * rabbit ear's corners are in, its given creases on every layer it cuts,
 * folded the way the direction says; and while the hinge region is
 * picked, the regions between them on both panes, the one picked lit, and
 * the one under the pointer. Null for any other tool, and before those
 * clicks are in.
 *
 * The regions are cut from the folded form once per click; a pointer move
 * only asks which one it is over.
 */
export function useFoldFanMarks(
  index: FoldPickIndex | null,
  tools: Pick<FoldToolState, 'tool' | 'picks' | 'vertexDirection' | 'compound'>
): FoldFanMarks | null {
  const { tool, picks, vertexDirection: direction } = tools;
  const { fanLayers } = tools.compound;
  const fan = useMemo(() => (isVertexTool(tool) ? fanGiven({ tool, picks }) : null), [tool, picks]);
  const pickingRegion = picksFanHinge(tool, picks.length);
  const creases = useMemo(
    () => (index && fan ? fanGivenCreases(index, fan, direction, fanLayers) : []),
    [index, fan, direction, fanLayers]
  );
  const pending = useMemo<FoldPendingCreases>(
    () => ({
      folded: fanGivenOnFolded(creases).map((line) => ({ line, letter: direction })),
      creasePattern: creases.map(({ sheet: [a, b], letter }) => ({ a, b, letter })),
    }),
    [creases, direction]
  );
  const regions = useMemo<FoldFanMarks['regions']>(() => {
    if (!index || !fan || !pickingRegion || !isVertexTool(tool)) return null;
    const picked = fanHingeRegion({ tool, picks }, fan);
    const at = regionOfHit(fan);
    return {
      folded: { polygons: fan.rays.map((_, k) => fanRegionOnFolded(index, fan, k)), picked, at },
      'crease-pattern': { polygons: fan.rays.map((_, k) => fanRegionOnSheet(index, fan, k)), picked, at },
    };
  }, [index, fan, pickingRegion, tool, picks]);
  return useMemo(
    () => (fan ? { creases, direction, pending, regions } : null),
    [fan, creases, direction, pending, regions]
  );
}
