import {
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import type { ReferencesDiagramView } from './ReferencesCpView';
import {
  createDiagramRenderContext,
  diagramShapes,
  type DiagramRenderContext,
} from './diagram/DiagramPrimitives';
import {
  canvasDiagramInk,
  canvasDiagramPens,
  REFERENCES_VIEW_MARKS,
  withReferencesViewFloors,
} from './diagram/diagramInk';
import type { FoldPose } from './fold/foldPlayback';
import { foldPosePaper } from './fold/foldPoseGeometry';
import type { FoldScene } from './fold/foldScene';
import { symbolFlaps, symbolOpacity } from './fold/foldSymbolFade';
import type { FoldPoseSink } from './fold/foldTransport';
import {
  createOverlayProjector,
  offPaperPathData,
  paperRingPoints,
  type SheetPoint,
} from './stepDiagramGeometry';

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
 * group's opacity in place (`foldSymbolFade`). The paper the marks are clipped
 * to moves with it: the flap is paper wherever it has swung, and the place it
 * lifted from is ground (`foldPosePaper`), so the clip's rings are set in place
 * too.
 */
export interface ReferencesDiagramLayerProps {
  /** The step's symbols, in model space, and the sheet they were measured against. */
  model: StepDiagramModel | null;
  /**
   * The outline the canvas fills the paper inside, in model space
   * (`ReferencesDiagramScene.outline`): where a mark takes the style's ink, and
   * where a letter's halo is the paper's.
   */
  outline: readonly SheetPoint[];
  /**
   * The picture is of the paper's back, as the canvas under it is: which face
   * a letter on the paper is haloed in. Said here rather than read off the
   * camera, whose model space is left-handed — its `mirrored` is true on the
   * front (`DiagramRenderOptions.back`).
   */
  mirrored: boolean;
  /** The canvas's live camera, or null before the first frame. */
  camera: ReferencesDiagramView | null;
  /** The reader's crease width, which is also this drawing's pen. */
  lineWidth: number;
  /** The paper style's arrow pen, in CSS px (`ReferencesPaperStyle.arrowWidth`). */
  arrowWidth: number;
  /** The card's fold, so the symbols on its moving paper can fade with it. */
  fold?: FoldScene | null;
}

export type ReferencesDiagramLayerHandle = FoldPoseSink;

/** What a pose is applied against: the render in force. */
interface LayerLive {
  context: DiagramRenderContext | null;
  outline: readonly SheetPoint[];
  fold: FoldScene | null;
}

export const ReferencesDiagramLayer = forwardRef<
  ReferencesDiagramLayerHandle,
  ReferencesDiagramLayerProps
>(function ReferencesDiagramLayer(
  { model, outline, mirrored, camera, lineWidth, arrowWidth, fold = null },
  ref
) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const poseRef = useRef<FoldPose | null>(null);
  const liveRef = useRef<LayerLive>({ context: null, outline, fold });
  // The clip pair's ids: this layer shares its document with every card.
  const id = useId();
  const project = useMemo(
    () =>
      camera
        ? createOverlayProjector(
            camera.view,
            canvasDiagramInk(lineWidth),
            // The full-screen view, not a page: its own floors under the paper's sizes.
            withReferencesViewFloors(canvasDiagramPens(lineWidth, arrowWidth)),
            REFERENCES_VIEW_MARKS
          )
        : null,
    [camera, lineWidth, arrowWidth]
  );
  // No bounds and nothing reserved: the canvas has no edge of its own and no
  // number over its corner, so a letter goes wherever its mark is.
  const context = useMemo(
    () =>
      model && project
        ? createDiagramRenderContext(model.primitives, model.sheet, project, {
            outline,
            id: `references-diagram-${id}`,
            back: mirrored,
          })
        : null,
    [model, project, outline, id, mirrored]
  );
  // Each symbol's flaps, as the group's tag: `"0"`, `"0 1"` for one riding both
  // halves of a twin, or nothing for one that stays put.
  const flaps = useMemo(
    () =>
      model && fold
        ? model.primitives.map((primitive) => symbolFlaps(primitive, fold).join(' '))
        : null,
    [model, fold]
  );

  const applyPose = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const pose = poseRef.current;
    for (const group of svg.querySelectorAll<SVGGElement>('g[data-fold-flap]')) {
      const riding = (group.dataset.foldFlap ?? '').split(' ').map(Number);
      group.style.opacity = String(symbolOpacity(riding, pose));
    }
    const live = liveRef.current;
    const clip = live.context?.clip;
    if (!live.context || !clip) return;
    const { project: at } = live.context;
    const resting = live.outline.map(([x, y]) => ({ x, y }));
    const rings = foldPosePaper(resting, live.fold, pose).map((ring) =>
      ring.map((p) => at([p.x, p.y]))
    );
    const inside = svg.querySelectorAll<SVGPolygonElement>(`[id="${clip.inside}"] polygon`);
    inside.forEach((polygon, index) => {
      polygon.setAttribute('points', paperRingPoints(rings[index] ?? []));
    });
    svg.querySelector(`[id="${clip.outside}"] path`)?.setAttribute('d', offPaperPathData(rings));
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
  // and the fresh group knows nothing of the pose in force; nor does a clip
  // drawn for a new camera.
  useLayoutEffect(() => {
    liveRef.current = { context, outline, fold };
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
      {diagramShapes(model.primitives, context, {
        // Two rings, the second empty at rest: a pose adds the lifted flap.
        rings: [context.paper, []],
        wrap: (shape, index) => {
          const riding = flaps?.[index] ?? '';
          return riding === '' ? (
            shape
          ) : (
            <g key={index} data-fold-flap={riding}>
              {shape}
            </g>
          );
        },
      })}
    </svg>
  );
});
