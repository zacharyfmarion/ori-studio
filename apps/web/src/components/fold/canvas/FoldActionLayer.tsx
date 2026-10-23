import { useId, useMemo } from 'react';
import type { CpOverlayView } from '../../../cp-workspace/CreasePatternWebglCanvas';
import { referencesMarkupTokens } from '../../../cp-workspace/references/usePaperStyleTokens';
import type { FoldLetteredReference } from '../../../fold/canvas/foldStepLetters';
import type { FoldActionGeometry } from '../../../fold/engine/foldEngineWire';
import { convexHull, type Point } from '../../../lib/geometry';
import { applyPaperStylePolicy, PAPER_STYLE_POLICIES } from '../../../lib/paper/paperStyleResolve';
import { PT_TO_CSS_PX, type PaperStyle } from '../../../lib/paper/paperStyle';
import { createDiagramRenderContext, diagramShapes } from '../../../lib/stepDiagram/DiagramPrimitives';
import { diagramInlineInk } from '../../../lib/stepDiagram/diagramColors';
import { DEFAULT_ORISTUDIO_CP_LINE_WIDTH } from '../../../lib/creasePatternViewport';
import {
  canvasDiagramInk,
  canvasDiagramPens,
  CP_CREASE_WIDTH_FACTOR,
  DIAGRAM_MARKS,
  REFERENCES_VIEW_MARKS,
  type DiagramMarks,
} from '../../../lib/stepDiagram/diagramInk';
import {
  createOverlayProjector,
  foldArrowArc,
  type SheetPoint,
} from '../../../lib/stepDiagram/stepDiagramGeometry';
import type { StepDiagramPrimitive } from '../../../lib/stepDiagram/stepDiagramModel';
import styles from './FoldCanvas.module.css';

const NO_LETTERS: readonly FoldLetteredReference[] = [];

/**
 * The marks the folded pane letters its references with, at `ink` (the
 * style's edge pen, which the arrow is drawn with): References' and the
 * Diagram's step-diagram letters and rings, at the size the References view
 * draws them — on screen, whatever the paper style's pens — so a letter on
 * the folded pane reads as one in the step diagrams does. A print pen of the
 * style's would draw them a few px tall beside the paper.
 */
export function foldActionMarks(ink: number): DiagramMarks {
  const scale = canvasDiagramInk(DEFAULT_ORISTUDIO_CP_LINE_WIDTH) / ink;
  return {
    ...DIAGRAM_MARKS,
    ringRadius: REFERENCES_VIEW_MARKS.ringRadius * scale,
    labelSize: REFERENCES_VIEW_MARKS.labelSize * scale,
  };
}

/**
 * A located fold's arrow over the folded pane (plan D11): from the grip on
 * the moving paper to where the fold puts it, drawn by the step diagram's own
 * primitives (`lib/stepDiagram`) — a valley's filled head or a mountain's
 * hollow one, and a precrease's out-and-back — in the paper style's arrow
 * pen, through the pane's camera. The fold line itself is painted with the
 * paper (`withFoldLine`); the renderer has no curve or arrowhead, so the
 * arrow is this one SVG over it, as References' marks are.
 *
 * A compound fold adds the arrows its picture carries: a push, a pleat.
 *
 * With it, the letters the step's sentence names its references by
 * (`useFoldStepLetters`), as References' cards letter theirs: a point ringed
 * and lettered, a line lettered on itself, each letter placed clear of the
 * others by the diagram's own label layout.
 */
export function FoldActionLayer({
  action,
  letters = NO_LETTERS,
  view,
  style,
  outline,
  ground,
}: {
  action: FoldActionGeometry | null;
  /** The references the step's sentence names by letter, in the pane's frame. */
  letters?: readonly FoldLetteredReference[];
  /** The pane's camera: its frame → CSS px of the canvas box. */
  view: CpOverlayView;
  style: PaperStyle;
  /** The paper in the pane's frame: where the arrow takes the style's ink rather than the ground's. */
  outline: readonly Point[];
  /** The canvas's ground, as a CSS colour: what an arrow off the paper is inked against. */
  ground: string;
}) {
  const id = useId();
  const seen = useMemo(() => applyPaperStylePolicy(style, PAPER_STYLE_POLICIES.fold), [style]);
  const model = useMemo(() => {
    const grip = action?.grip ?? null;
    const push = action?.push ?? null;
    const pleat = action?.pleat ?? null;
    if (!grip && !push && !pleat && letters.length === 0) return null;
    const hull = convexHull(outline);
    const centre: SheetPoint | null = hull.length
      ? [hull.reduce((sum, p) => sum + p.x, 0) / hull.length, hull.reduce((sum, p) => sum + p.y, 0) / hull.length]
      : grip
        ? [grip.at.x, grip.at.y]
        : null;
    if (!centre) return null;
    const primitives: StepDiagramPrimitive[] = [];
    const out = grip ? foldArrowArc([grip.at.x, grip.at.y], [grip.image.x, grip.image.y], centre) : null;
    if (action && out) {
      primitives.push(
        action.kind === 'precrease' ? { kind: 'fold-arrow', out } : { kind: 'one-way-arrow', out, fold: action.direction }
      );
    }
    // A compound fold's push — a reverse fold's, the hollow arrow at the
    // spine, pushing it in — and its pleat, the lightning bolt across a
    // crimp's or a pleat's lines: whichever its engine fills.
    if (push) primitives.push({ kind: 'push-arrow', from: [push.at.x, push.at.y], to: [push.toward.x, push.toward.y] });
    if (pleat) {
      primitives.push({
        kind: 'pleat-arrow',
        from: [pleat.from.x, pleat.from.y],
        to: [pleat.to.x, pleat.to.y],
        kinks: pleat.kinks,
        mirrored: false,
      });
    }
    for (const { kind, at, letter } of letters) {
      if (kind === 'point') primitives.push({ kind: 'point', at: [at.x, at.y], style: 'highlight' });
      primitives.push({ kind: 'label', at: [at.x, at.y], text: letter, style: 'highlight' });
    }
    if (primitives.length === 0) return null;
    const xs = hull.map((p) => p.x);
    const ys = hull.map((p) => p.y);
    const width = xs.length ? Math.max(...xs) - Math.min(...xs) : 1;
    const height = ys.length ? Math.max(...ys) - Math.min(...ys) : 1;
    return { primitives, sheet: { width, height, centre }, hull };
  }, [action, letters, outline]);

  const context = useMemo(() => {
    if (!model) return null;
    // The pen every diagram stroke is measured from: the style's edge pen, as
    // References' view measures its own.
    const lineWidth = (seen.edges.width * PT_TO_CSS_PX) / CP_CREASE_WIDTH_FACTOR;
    const ink = canvasDiagramInk(lineWidth);
    const project = createOverlayProjector(
      view,
      ink,
      canvasDiagramPens(lineWidth, seen.arrows.width * PT_TO_CSS_PX),
      foldActionMarks(ink)
    );
    return createDiagramRenderContext(model.primitives, model.sheet, project, {
      outline: model.hull.map((p): SheetPoint => [p.x, p.y]),
      id: `fold-action-${id}`,
      back: false,
      inline: diagramInlineInk({ ...referencesMarkupTokens(seen), '--bg-primary': ground }),
    });
  }, [model, view, seen, id, ground]);

  if (!model || !context) return null;
  return (
    // Over the canvas, under anything that takes a press.
    <svg className={styles.layer} aria-hidden="true" data-fold-action="">

      {diagramShapes(model.primitives, context)}
    </svg>
  );
}
