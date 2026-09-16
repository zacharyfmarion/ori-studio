/**
 * A ReferenceFinder step's diagram — the one its card draws — placed on the
 * crease pattern.
 *
 * The Find tab's canvas used to draw a step from a summary of it: the new
 * crease as the sheet's full chord, the earlier ones as context, the inputs
 * picked out, one arrow. The card beside it drew ReferenceFinder's own
 * diagram of the same step, which says more — the pinch as the short press
 * it is with the rest of the line dotted, every fold as a valley, a letter on
 * each reference — and said it differently, so the two pictures of one step
 * did not match while the planner's steps, drawn from one description on both
 * surfaces, did. Zach: "why are they different? It already works perfectly
 * in the precreasing sequence view."
 *
 * So the canvas now draws the card's primitives, mapped from the unit sheet
 * ReferenceFinder works in into model space. The map is the sheet's frame — a
 * similarity, a scale and a rotation and possibly a flip — applied here in
 * plain arithmetic rather than round-tripped through the planner worker, and
 * an arc goes through three points and comes back as the arc through their
 * images, which is what keeps its direction right under a flip.
 *
 * Pure, and the one place the two surfaces meet: the card projects the same
 * primitives onto a square viewBox, this projects them onto the pattern.
 */
import type { RawSolution } from './referenceFinder/solution';
import type { ExtractedSolution } from './referenceFinder/extractor';
import {
  referenceFinderDiagramToPrimitives,
  stepDiagram,
  type StepDiagramModel,
  type StepDiagramPrimitive,
} from './referenceFinderDiagramToPrimitives';
import type { PrecreaseFrame } from './sheetFrames';
import {
  arcSamplePoints,
  arcThroughPoints,
  dashRulerAlong,
  type DiagramArc,
} from './stepDiagramGeometry';

type Pair = readonly [number, number];

/**
 * A point of ReferenceFinder's unit sheet in model space: `Frame::rf_to_model`
 * in `crates/oristudio-precrease/src/frame.rs`, whose sheet coordinates are the
 * unit rectangle scaled by the frame's longer side and laid along its axes
 * from its origin.
 */
export function rfToModel(frame: PrecreaseFrame, point: Pair): [number, number] {
  const longer = Math.max(frame.width, frame.height);
  const sx = point[0] * longer;
  const sy = point[1] * longer;
  return [
    frame.origin[0] + sx * frame.x_axis[0] + sy * frame.y_axis[0],
    frame.origin[1] + sx * frame.x_axis[1] + sy * frame.y_axis[1],
  ];
}

/**
 * A diagram in ReferenceFinder's sheet coordinates, in model space.
 *
 * The sheet primitive is dropped: the pattern's own border is on the canvas.
 * A line is re-rulered so its dashes measure from the line's own zero, as
 * every crease drawn over the pattern is; an arc, a fold arrow's included,
 * is refitted through the images of three of its points.
 */
export function diagramInModel(model: StepDiagramModel, frame: PrecreaseFrame): StepDiagramModel {
  const map = (point: Pair): [number, number] => rfToModel(frame, point);
  const mapArc = (arc: DiagramArc): DiagramArc | null => {
    const [from, middle, to] = arcSamplePoints(arc).map(map);
    return arcThroughPoints(from, middle, to);
  };
  const primitives: StepDiagramPrimitive[] = [];
  for (const primitive of model.primitives) {
    switch (primitive.kind) {
      case 'sheet':
        break;
      case 'line': {
        const from = map(primitive.from);
        const to = map(primitive.to);
        const ruler = dashRulerAlong(from[0], from[1], to[0], to[1]);
        primitives.push({
          kind: 'line',
          from: [ruler.ax, ruler.ay],
          to: [ruler.bx, ruler.by],
          style: primitive.style,
          dashPhase: ruler.phase,
        });
        break;
      }
      case 'arc': {
        const arc = mapArc(primitive);
        if (arc) primitives.push({ kind: 'arc', style: primitive.style, ...arc });
        break;
      }
      case 'fold-arrow': {
        const out = mapArc(primitive.out);
        if (out) primitives.push({ kind: 'fold-arrow', out });
        break;
      }
      case 'turn-over':
        primitives.push({ kind: 'turn-over', at: map(primitive.at) });
        break;
      case 'region':
        primitives.push({ kind: 'region', corners: primitive.corners.map(map) });
        break;
      case 'point':
        primitives.push({ ...primitive, at: map(primitive.at) });
        break;
      case 'label':
        primitives.push({ ...primitive, at: map(primitive.at) });
        break;
    }
  }
  const longer = Math.max(frame.width, frame.height);
  return {
    sheet: {
      width: model.sheet.width * longer,
      height: model.sheet.height * longer,
      centre: map([model.sheet.width / 2, model.sheet.height / 2]),
    },
    primitives,
  };
}

/**
 * The diagram the card draws for step `index` of a candidate, on the pattern:
 * null when the core printed none for it.
 */
export function referenceFinderStepInModel(
  raw: RawSolution,
  solution: ExtractedSolution,
  index: number,
  frame: PrecreaseFrame
): StepDiagramModel | null {
  const diagram = stepDiagram(raw, solution, index);
  if (!diagram) return null;
  return diagramInModel(referenceFinderDiagramToPrimitives(diagram), frame);
}
