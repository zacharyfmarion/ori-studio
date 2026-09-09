import { useMemo } from 'react';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import type { ReferencesDiagramView } from './ReferencesCpView';
import { diagramPrimitiveShape } from './diagram/DiagramPrimitives';
import { DIAGRAM_INK_PER_SHEET } from './diagram/diagramInk';
import { createOverlayProjector } from './stepDiagramGeometry';

/**
 * The half of a step's diagram the crease-pattern renderer cannot draw.
 *
 * Arcs, arrowheads, the turn-over glyph, the rings round the marks and the
 * lettered references — all of it in screen space over the WebGL canvas, drawn
 * by the same code and the same stylesheet the filmstrip card uses. The lines
 * go to the GPU; these do not, because the renderer has no glyph atlas and
 * cannot express a curve. `CpMeasureLayer` is the same layer for the same
 * reason, and says so.
 *
 * The object count is what makes that safe: a step's symbols are bounded by its
 * axiom's arity — at most about a dozen — whatever the size of the pattern
 * underneath.
 *
 * It subscribes to nothing. The canvas hands its camera to the panel, the panel
 * hands it here, and a camera that has not moved does not re-render this at all
 * (`ReferencesCpView` de-dupes before it reports).
 */
export interface ReferencesDiagramLayerProps {
  /** The step's symbols, in model space, and the sheet they were measured against. */
  model: StepDiagramModel | null;
  /** The canvas's live camera, or null before the first frame. */
  camera: ReferencesDiagramView | null;
}

export function ReferencesDiagramLayer({ model, camera }: ReferencesDiagramLayerProps) {
  const project = useMemo(() => {
    if (!camera || !model) return null;
    // The pen is set by the paper at fit, not by the live camera: the geometry
    // it draws — an arrowhead, a mark's ring — is a share of the paper and must
    // grow with the zoom, while the pen itself must not.
    const paper = Math.max(model.sheet.width, model.sheet.height);
    const ink = paper * camera.cssPerModelAtFit * DIAGRAM_INK_PER_SHEET;
    return createOverlayProjector(camera.view, ink);
  }, [camera, model]);

  if (!model || !project || model.primitives.length === 0) return null;

  return (
    <svg
      className="references-diagram-layer"
      // Above the WebGL canvas, below anything the reader can click.
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
      aria-hidden="true"
    >
      {model.primitives.map((primitive, index) =>
        diagramPrimitiveShape(primitive, index, project, model.sheet)
      )}
    </svg>
  );
}
