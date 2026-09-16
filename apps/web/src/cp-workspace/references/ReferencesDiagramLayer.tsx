import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import type { ReferencesDiagramView } from './ReferencesCpView';
import { createDiagramRenderContext, diagramPrimitiveShape } from './diagram/DiagramPrimitives';
import { canvasDiagramInk } from './diagram/diagramInk';
import type { FoldPose } from './fold/foldPlayback';
import type { FoldScene } from './fold/foldScene';
import { symbolFlap, symbolOpacity } from './fold/foldSymbolFade';
import type { FoldPoseSink } from './fold/foldTransport';
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
 *
 * The fold reaches it the way it reaches the canvas: as a pose pushed through
 * the handle each frame, never as React state. A symbol that rides the moving
 * paper is wrapped in a group tagged with its flap, and a pose sets the
 * group's opacity in place (`foldSymbolFade`).
 */
export interface ReferencesDiagramLayerProps {
  /** The step's symbols, in model space, and the sheet they were measured against. */
  model: StepDiagramModel | null;
  /** The canvas's live camera, or null before the first frame. */
  camera: ReferencesDiagramView | null;
  /** The reader's crease width, which is also this drawing's pen. */
  lineWidth: number;
  /** The card's fold, so the symbols on its moving paper can fade with it. */
  fold?: FoldScene | null;
}

export type ReferencesDiagramLayerHandle = FoldPoseSink;

export const ReferencesDiagramLayer = forwardRef<
  ReferencesDiagramLayerHandle,
  ReferencesDiagramLayerProps
>(function ReferencesDiagramLayer({ model, camera, lineWidth, fold = null }, ref) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const poseRef = useRef<FoldPose | null>(null);
  const project = useMemo(
    () =>
      camera ? createOverlayProjector(camera.view, canvasDiagramInk(lineWidth)) : null,
    [camera, lineWidth]
  );
  // No bounds and nothing reserved: the canvas has no edge of its own and no
  // number over its corner, so a letter goes wherever its mark is.
  const context = useMemo(
    () =>
      model && project ? createDiagramRenderContext(model.primitives, model.sheet, project) : null,
    [model, project]
  );
  const flaps = useMemo(
    () => (model && fold ? model.primitives.map((primitive) => symbolFlap(primitive, fold)) : null),
    [model, fold]
  );

  const applyPose = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const pose = poseRef.current;
    for (const group of svg.querySelectorAll<SVGGElement>('g[data-fold-flap]')) {
      group.style.opacity = String(symbolOpacity(Number(group.dataset.foldFlap), pose));
    }
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      setFoldPose: (pose) => {
        poseRef.current = pose;
        applyPose();
      },
    }),
    [applyPose]
  );
  // A render can mount a fresh group — a new camera, a re-themed picture —
  // and the fresh group knows nothing of the pose in force.
  useLayoutEffect(() => {
    applyPose();
  });

  if (!model || !context || model.primitives.length === 0) return null;

  return (
    <svg
      ref={svgRef}
      className="references-diagram-layer"
      // Above the WebGL canvas, below anything the reader can click.
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
      aria-hidden="true"
    >
      {model.primitives.map((primitive, index) => {
        const shape = diagramPrimitiveShape(primitive, index, context);
        const flap = flaps?.[index] ?? null;
        return flap === null ? (
          shape
        ) : (
          <g key={index} data-fold-flap={flap}>
            {shape}
          </g>
        );
      })}
    </svg>
  );
});
