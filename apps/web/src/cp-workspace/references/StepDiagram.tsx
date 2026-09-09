import { useMemo } from 'react';
import type { Diagram } from './referenceFinder/solution';
import {
  referenceFinderDiagramToPrimitives,
  type StepDiagramModel,
} from './referenceFinderDiagramToPrimitives';
import { diagramPrimitiveShape } from './diagram/DiagramPrimitives';
import { seenFromTheBack } from './diagram/diagramModel';
import { createDiagramProjector } from './stepDiagramGeometry';

export type StepDiagramProps = {
  /** The viewBox side; the element itself scales to its box. */
  size?: number;
  className?: string;
  /** Accessible name; the drawing is otherwise decorative. */
  label?: string;
  /**
   * Draw the paper's back, mirrored, as the view beside the strip does. A card
   * for a fold made after a turn-over shows what the folder is looking at.
   */
  mirrored?: boolean;
} & (
  | {
      /** A ReferenceFinder diagram, adapted here. */
      diagram: Diagram;
      primitives?: undefined;
    }
  | {
      /**
       * Primitives built elsewhere — the planner's steps, which ship
       * witnesses rather than diagrams (`plannerStepToPrimitives.ts`).
       */
      primitives: StepDiagramModel | null;
      diagram?: undefined;
    }
);

export function StepDiagram({
  diagram,
  primitives,
  size = 100,
  className,
  label,
  mirrored = false,
}: StepDiagramProps) {
  const model = useMemo<StepDiagramModel | null>(() => {
    if (diagram === undefined) return primitives ?? null;
    try {
      return referenceFinderDiagramToPrimitives(diagram);
    } catch {
      // A diagram the adapter refuses is a wire-shape change; the row keeps its
      // sentence and simply shows no picture rather than a wrong one.
      return null;
    }
  }, [diagram, primitives]);
  const project = useMemo(
    () => createDiagramProjector(model?.sheet ?? { width: 1, height: 1 }, size, mirrored),
    [model, size, mirrored]
  );

  if (!model) {
    return (
      <svg
        className={['step-diagram', 'step-diagram--unavailable', className].filter(Boolean).join(' ')}
        viewBox={project.viewBox}
        role="img"
        aria-label={label}
        data-diagram-error="true"
      />
    );
  }

  return (
    <svg
      className={['step-diagram', className].filter(Boolean).join(' ')}
      viewBox={project.viewBox}
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {(mirrored ? seenFromTheBack(model.primitives) : model.primitives).map(
        (primitive, index) => diagramPrimitiveShape(primitive, index, project, model.sheet)
      )}
    </svg>
  );
}
