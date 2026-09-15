import { CpImageInspector } from '../CpImageInspector';
import { InlineSimulationInspector } from '../InlineSimulationInspector';
import type { useCpAnnotations } from '../annotations/useCpAnnotations';
import { CpFoldedFigureToolbar } from '../folded/CpFoldedFigureToolbar';
import type { FoldedFigureActionDeps } from '../folded/foldedFigureActions';
import type { useInlineSimulations } from '../inlineSimulation/useInlineSimulations';
import type { CanvasObjectTarget } from './canvasObjectKinds';

/**
 * The floating surface the selected canvas object gets: one exhaustive switch
 * over the resolver's union, in place of the hand-written mutual-exclusion
 * cascade the crease-pattern panel carried (four clauses, each guarding
 * against the others by hand, and a new kind costing a fifth condition on
 * every one of them).
 *
 * Deliberately a switch here rather than a column of the property registry:
 * floating chrome needs the panel's viewport element and the canvas hooks'
 * verbs, and threading those through a data-module registry would put React
 * and panel deps in it. A kind added to `CanvasObjectKind` without a clause
 * fails to typecheck, which is the guarantee that matters.
 *
 * A text box's surface is its editing toolbar, mounted by the text layer; a
 * region's is its chip, mounted for as long as the region exists. Both return
 * null here.
 */
export function CpFloatingInspectors({
  target,
  container,
  editingTextId,
  annotationsInteractive,
  annotations,
  foldedFigureActionDeps,
  inlineSimulations,
}: {
  target: CanvasObjectTarget | null;
  /** Element the canvas is positioned against — what the toolbars anchor to. */
  container: HTMLElement | null;
  /** A text box under edit owns the corner; every other toolbar stands down. */
  editingTextId: string | null;
  /** False while a drawing tool is mid-gesture, when annotations must not take clicks. */
  annotationsInteractive: boolean;
  annotations: Pick<
    ReturnType<typeof useCpAnnotations>,
    'bringSelectedImageToFront' | 'sendSelectedImageToBack' | 'deleteSelectedImage'
  >;
  foldedFigureActionDeps: Omit<FoldedFigureActionDeps, 't'>;
  inlineSimulations: Pick<
    ReturnType<typeof useInlineSimulations>,
    | 'playing'
    | 'staleIds'
    | 'togglePlay'
    | 'scrub'
    | 'setUpright'
    | 'replay'
    | 'exportView'
    | 'refresh'
    | 'remove'
  >;
}) {
  if (!target || editingTextId) return null;
  switch (target.kind) {
    case 'image':
      if (!annotationsInteractive) return null;
      return (
        <CpImageInspector
          image={target.annotation}
          container={container}
          onBringToFront={annotations.bringSelectedImageToFront}
          onSendToBack={annotations.sendSelectedImageToBack}
          onDelete={annotations.deleteSelectedImage}
        />
      );
    case 'text':
    case 'suppressionRegion':
      return null;
    case 'folded-figure':
      return (
        <CpFoldedFigureToolbar
          figure={target.figure}
          container={container}
          deps={foldedFigureActionDeps}
        />
      );
    case 'inline-simulation': {
      const simulation = target.simulation;
      return (
        <InlineSimulationInspector
          simulation={simulation}
          container={container}
          playing={inlineSimulations.playing}
          stale={inlineSimulations.staleIds.has(simulation.id)}
          onTogglePlay={inlineSimulations.togglePlay}
          onScrub={(percent) => inlineSimulations.scrub(simulation.id, percent)}
          onSetUpright={inlineSimulations.setUpright}
          onReplay={inlineSimulations.replay}
          onExport={inlineSimulations.exportView}
          onRefresh={() => inlineSimulations.refresh(simulation.id)}
          onDelete={() => inlineSimulations.remove(simulation.id)}
        />
      );
    }
  }
}
