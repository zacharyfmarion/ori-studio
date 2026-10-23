/**
 * A source step's mirror: its inputs translated across the axis, never a
 * second folding algorithm.
 *
 * Every sheet point maps through the sheet reflection, every model-frame
 * direction and root through the frame the mirror's paper is placed in. What
 * the step says as the viewer sees it — a valley or a mountain, the layers on
 * top — turns where the viewer sees the mirrored paper from the other side:
 * behind, or after a turn-over between the source and the repeat, but not
 * both (`flipsView`). That is the prediction `mirrorOperation` makes; the
 * preparation also tries the other way (`otherDirection`) and keeps the one
 * whose result passes Repeat's test of a mirrored step (`verifyMaterial`).
 */
import { invertIsometry, polygonCentroid, toPair, transformLine } from '../canvas/foldCanvasGeometry';
import type {
  FoldPleatPlacement,
  FoldChoices,
  FoldLineInput,
  FoldLocatedLine,
  FoldOp,
  FoldRef,
  FoldSeed,
  SheetPoint,
} from '../document/foldSequenceDocument';
import type { FoldIsometry, FoldScene } from '../engine/foldEngineWire';
import { compose, correspondingFrame, mappedPoint, RepeatFailure, sheetRing, sideSign, type RepeatSide } from './repeatGeometry';

/** A mirrored step: its op and choices, as the engine is asked to fold them. */
export interface RepeatMirrored {
  op: FoldOp;
  choices?: FoldChoices;
}

/**
 * Whether the viewer sees the mirrored paper from the other side than the
 * source's: behind, or across a turn-over between the two states, but not
 * both.
 */
export function flipsView(source: FoldScene, target: FoldScene, side: RepeatSide): boolean {
  return (side === 'behind') !== (source.view.flipped !== target.view.flipped);
}

/**
 * The same mirrored step folded the other way as the viewer sees it — a
 * valley for a mountain — or null for an op that has no way to turn: a
 * reverse fold, a crimp or a sink, whose kind is the paper's own; a turn or a
 * rotation; a pleat or a swivel by its valley and mountain, which turn by
 * trading their lines and are refused instead (`mirrorOperation`).
 */
export function otherDirection(mirrored: RepeatMirrored): RepeatMirrored | null {
  const { op } = mirrored;
  if (op.kind === 'valley' || op.kind === 'mountain')
    return { ...mirrored, op: { ...op, kind: op.kind === 'valley' ? 'mountain' : 'valley' } };
  if ('direction' in op) return { ...mirrored, op: { ...op, direction: op.direction === 'valley' ? 'mountain' : 'valley' } };
  return null;
}

export function mirrorOperation(
  op: FoldOp,
  choices: FoldChoices | undefined,
  source: FoldScene,
  target: FoldScene,
  map: FoldIsometry,
  side: RepeatSide,
  material?: readonly SheetPoint[],
): RepeatMirrored {
  const turned = flipsView(source, target, side);
  const p = (at: SheetPoint) => mappedPoint(map, at);
  const seed = (s: FoldSeed): FoldSeed =>
    material?.length
      ? { scope: 'flaps', at: material.map(p) }
      : s.scope === 'flaps'
        ? { scope: 'flaps', at: s.at.map(p) }
        : s.scope === 'depth'
          ? { ...s, at: p(s.at) }
          : s;
  const ref = (r: FoldRef): FoldRef =>
    r.kind === 'edge' ? { kind: 'edge', a: p(r.a), b: p(r.b) } : { kind: 'point', at: p(r.at) };
  const line = (l: FoldLineInput): FoldLineInput =>
    l.via === 'crease'
      ? { ...l, at: p(l.at) }
      : l.via === 'free'
        ? { ...l, through: [p(l.through[0]), p(l.through[1])] }
        : { ...l, inputs: l.inputs.map(ref) };
  const linePoint = (l: FoldLineInput): SheetPoint =>
    l.via === 'crease'
      ? l.at
      : l.via === 'free'
        ? l.through[0]
        : l.inputs[0]!.kind === 'edge'
          ? l.inputs[0].a
          : l.inputs[0]!.at;
  const anchor: SheetPoint =
    'line' in op
      ? linePoint(op.line)
      : 'flap' in op
        ? op.flap
        : 'petal' in op
          ? op.petal
          : 'corners' in op
            ? op.corners[0]
            : 'fold' in op
              ? op.fold
              : 'pivot' in op
                ? op.pivot
                : 'vertex' in op
                  ? op.vertex
                  : op.kind === 'swivel' && op.via === 'valley-mountain'
                    ? linePoint(op.valley.line)
                    : toPair(polygonCentroid(sheetRing(source, 0)));
  const frame = correspondingFrame(source, target, map, anchor);
  const seen = compose(target.view_transform, compose(frame, invertIsometry(source.view_transform)));
  const vector = (v: SheetPoint): SheetPoint => [
    frame[0] * v[0] + frame[1] * v[1],
    frame[3] * v[0] + frame[4] * v[1],
  ];
  const located = (l: FoldLocatedLine): FoldLocatedLine => ({
    line: line(l.line),
    ...(l.root
      ? { root: transformLine(correspondingFrame(source, target, map, linePoint(l.line)), l.root) }
      : {}),
  });
  const motion = <T extends { seed: FoldSeed; moving?: SheetPoint }>(o: T) => ({
    ...o,
    seed: seed(o.seed),
    ...(o.moving ? { moving: p(o.moving) } : {}),
  });
  let next: FoldOp;
  switch (op.kind) {
    case 'valley':
    case 'mountain':
      next = {
        ...motion(op),
        line: line(op.line),
        ...(op.landing?.kind === 'against'
          ? { landing: { kind: 'against', targets: op.landing.targets.map(p) } }
          : {}),
      };
      break;
    case 'precrease':
      next = {
        ...motion(op),
        line: line(op.line),
        ...(op.extent
          ? {
              extent:
                op.extent.kind === 'pinch'
                  ? { ...op.extent, at: ref(op.extent.at) as Exclude<FoldRef, { kind: 'edge' }> }
                  : {
                      ...op.extent,
                      from: ref(op.extent.from) as Exclude<FoldRef, { kind: 'edge' }>,
                      to: ref(op.extent.to) as Exclude<FoldRef, { kind: 'edge' }>,
                    },
            }
          : {}),
      };
      break;
    case 'unfold':
    case 'refold':
      next = { ...motion(op), crease: p(op.crease) };
      break;
    case 'inside-reverse':
    case 'outside-reverse':
    case 'open-sink':
    case 'closed-sink':
    case 'unsink':
      next = { ...motion(op), line: line(op.line) };
      break;
    case 'pleat': {
      const placement = (value: FoldPleatPlacement): FoldPleatPlacement => ({
        landing: value.landing.kind === 'against' ? { kind: 'against', targets: value.landing.targets.map(p) } : value.landing,
        ...(value.completion ? { completion: { faces: value.completion.faces.map(p), orders: value.completion.orders } } : {}),
      });
      // Its first line is the mountain and its second the valley, as the
      // viewer sees them: seen from the other side they trade places, which
      // a pleat cannot store without trading its lines and moving side.
      if (turned) throw new RepeatFailure('repeat_pleat_behind');
      next = { ...motion(op), line: line(op.line), second: line(op.second),
        ...(op.secondRoot ? { secondRoot: located({ line: op.second, root: op.secondRoot }).root } : {}),
        ...(op.resolved ? { resolved: [placement(op.resolved[0]), placement(op.resolved[1])] as const } : {}) };
      break;
    }
    case 'crimp':
      next = { ...motion(op), line: line(op.line), second: line(op.second) };
      break;
    case 'tuck':
      next = {
        ...motion(op),
        line: line(op.line),
        target: p(op.target),
        ...(op.additionalTargets ? { additionalTargets: op.additionalTargets.map(p) } : {}),
      };
      break;
    case 'squash':
      next = {
        ...op,
        flap: p(op.flap),
        ...(op.target ? { target: vector(op.target) } : {}),
        ...(op.hinge ? { hinge: located(op.hinge) } : {}),
      };
      break;
    case 'petal':
      next =
        'ends' in op
          ? { ...op, petal: p(op.petal), ends: [p(op.ends[0]), p(op.ends[1])] }
          : { ...op, petal: p(op.petal), crease: p(op.crease) };
      break;
    case 'rabbit-ear':
      next = {
        ...op,
        corners: op.corners.map(p) as unknown as typeof op.corners,
        stayer: p(op.stayer),
        emergent: vector(op.emergent),
        seed: seed(op.seed),
        ...(op.ridge ? { ridge: vector(op.ridge) } : {}),
      };
      break;
    case 'swivel':
      if (!('via' in op))
        next = {
          ...op,
          vertex: p(op.vertex),
          toward: op.toward.map(p) as unknown as typeof op.toward,
          stayer: p(op.stayer),
          emergent: vector(op.emergent),
          seed: seed(op.seed),
        };
      else if (op.via === 'valley-mountain') {
        // Its letters are the viewer's, on the layer that faces them: seen
        // from the other side, its pair lies on the layer behind, which only
        // a turn over brings in front.
        if (turned) throw new RepeatFailure('repeat_swivel_behind');
        next = { ...op, valley: located(op.valley), mountain: located(op.mountain) };
      }
      else if ('fold' in op)
        next = { ...op, fold: p(op.fold), edge: p(op.edge), target: line(op.target) as typeof op.target };
      else
        next = {
          ...op,
          pivot: p(op.pivot),
          edge: p(op.edge),
          target: line(op.target) as typeof op.target,
          seed: seed(op.seed),
          ...(op.ridge ? { ridge: vector(op.ridge) } : {}),
        };
      break;
    case 'rotate':
      // A turn of the view about the line of sight: the mirror in the plane
      // turns its sense, and so does seeing it from the other side.
      next =
        (seen[0] * seen[4] - seen[1] * seen[3]) * sideSign(side) < 0
          ? { ...op, rotate: { ...op.rotate, direction: op.rotate.direction === 'cw' ? 'ccw' : 'cw' } }
          : op;
      break;
    case 'turn': {
      const v = op.axis === 'vertical' ? [seen[1], seen[4]] : [seen[0], seen[3]];
      if (Math.abs(v[0]!) < 1e-6) next = { ...op, axis: 'vertical' };
      else if (Math.abs(v[1]!) < 1e-6) next = { ...op, axis: 'horizontal' };
      else throw new RepeatFailure('repeat_view_axis');
      break;
    }
    case 'repeat':
    case 'cp-jump':
    case 'unfold-to':
      throw new RepeatFailure('repeat_unsupported');
  }
  // Directions are the viewer's: seen from the other side, a valley on the
  // paper is a mountain. The letter on the paper stays what it was.
  if (turned) next = otherDirection({ op: next })?.op ?? next;
  // The completion's pairs say which side of a face's front another lies on:
  // the paper's own, which a repeat on either side keeps (its mirror is
  // front to front). A reverse fold's opening, by its upper block in the
  // model, is the lower one behind; the preparation finds it (`repeatPreparation`).
  const mapped: FoldChoices = {
    ...choices,
    ...(choices?.root ? { root: transformLine(frame, choices.root) } : {}),
    ...(choices?.completion
      ? { completion: { faces: choices.completion.faces.map(p), orders: choices.completion.orders } }
      : {}),
    ...(choices?.opening ? { opening: choices.opening.map((o) => ({ upper: o.upper.map(p) })) } : {}),
    ...(choices?.pocket ? { pocket: [p(choices.pocket[0]), p(choices.pocket[1])] as const } : {}),
  };
  return { op: next, ...(Object.keys(mapped).length ? { choices: mapped } : {}) };
}
