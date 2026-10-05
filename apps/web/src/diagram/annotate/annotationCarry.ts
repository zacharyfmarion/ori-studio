/**
 * Annotations that follow their picture (D8). A pose the app applied — a
 * quarter turn or a flip of an upload, a References step turned over, a
 * linked picture turned about its middle — moves what the picture shows by a
 * known amount, and every annotation is moved with it. Anything else — a
 * refold, a Refresh, a new camera, the other side of a fold, a new picture —
 * leaves them where they were, and Annotate says the picture changed.
 *
 * Pure: no DOM, no store.
 */
import { meanValueWeights } from '../../cp-workspace/folded/foldedLayerSpread';
import { boundariesMatchMoved, isRelativeFingerprint } from '../../cp-workspace/regions/regionIdentity';
import { turnClockwise } from '../../lib/geometry';
import type { PaperFaceItem, PaperScene, SceneBounds, ScenePoint } from '../../lib/paper/paperScene';
import {
  isKnownAnnotation,
  sameSpread,
  type DiagramAsset,
  type DiagramCpSource,
  type DiagramStep,
  type KnownDiagramAnnotation,
  type QuarterTurns,
} from '../document/diagramDocument';
import { stepPictureFrame, storedScene } from '../pictures/pictureFrame';
import { carryAnnotation, mirrorMove, type PictureMove, type PicturePoint } from './annotationModel';

interface Pose {
  rotationQuarterTurns: QuarterTurns;
  mirrored: boolean;
}

/** An asset's point as a pose shows it: flipped first, then turned clockwise, inside its box. */
function posed(pose: Pose, width: number, height: number, [x, y]: PicturePoint): PicturePoint {
  let point: PicturePoint = [pose.mirrored ? width - x : x, y];
  let boxHeight = height;
  let boxWidth = width;
  for (let turn = 0; turn < pose.rotationQuarterTurns; turn += 1) {
    point = [boxHeight - point[1], point[0]];
    [boxWidth, boxHeight] = [boxHeight, boxWidth];
  }
  return point;
}

/** The asset's own point for one a pose shows: {@link posed} undone. */
function unposed(pose: Pose, width: number, height: number, [x, y]: PicturePoint): PicturePoint {
  const sideways = pose.rotationQuarterTurns % 2 === 1;
  let boxWidth = sideways ? height : width;
  let boxHeight = sideways ? width : height;
  let point: PicturePoint = [x, y];
  for (let turn = 0; turn < pose.rotationQuarterTurns; turn += 1) {
    point = [point[1], boxWidth - point[0]];
    [boxWidth, boxHeight] = [boxHeight, boxWidth];
  }
  return [pose.mirrored ? width - point[0] : point[0], point[1]];
}

/** An upload re-posed: from what one pose shows to what the other does, in picture units. */
export function poseMove(width: number, height: number, before: Pose, after: Pose): PictureMove {
  const longer = Math.max(width, height);
  const mirrors = before.mirrored !== after.mirrored;
  const turns = mirrors
    ? before.rotationQuarterTurns + after.rotationQuarterTurns
    : after.rotationQuarterTurns - before.rotationQuarterTurns;
  return {
    point: ([u, v]) => {
      const [x, y] = posed(after, width, height, unposed(before, width, height, [u * longer, v * longer]));
      return [x / longer, y / longer];
    },
    mirrors,
    turnDeg: (((turns % 4) + 4) % 4) * 90,
  };
}

/**
 * A scene turned clockwise by `turnDeg` about its own origin — where a linked
 * capture turns its pattern or flat model (`creasePatternScene`,
 * `readFlatPicture`) — from one frame to the other.
 */
export function sceneTurnMove(
  before: SceneBounds,
  after: SceneBounds,
  turnDeg: number,
  quarterTurns?: number
): PictureMove | null {
  const longerBefore = Math.max(before.maxX - before.minX, before.maxY - before.minY);
  const longerAfter = Math.max(after.maxX - after.minX, after.maxY - after.minY);
  if (!(longerBefore > 0) || !(longerAfter > 0)) return null;
  const turn = turnClockwise(turnDeg);
  return {
    point: ([u, v]) => {
      const { x, y } = turn({ x: before.minX + u * longerBefore, y: before.minY + v * longerBefore });
      return [(x - after.minX) / longerAfter, (y - after.minY) / longerAfter];
    },
    mirrors: false,
    turnDeg,
    ...(quarterTurns !== undefined ? { quarterTurns } : {}),
  };
}

/**
 * Whether two captures are of one region: the same scope, or — for a crease
 * pattern, drawn about its paper's centre wherever the paper is — the region
 * where it moved to, its outline the same shape (its creases are the same: the
 * fingerprints are compared beside this). A capture that finds a moved sheet
 * follows it (`followedScope`), and its first turn is still a turn. A folded
 * picture sits where its sheet sits, so it keeps the strict test.
 */
function sameRegion(from: DiagramCpSource, to: DiagramCpSource): boolean {
  if (JSON.stringify(from.scope) === JSON.stringify(to.scope)) return true;
  return (
    from.render.mode === 'crease-pattern' &&
    to.render.mode === 'crease-pattern' &&
    isRelativeFingerprint(from.fingerprint) &&
    boundariesMatchMoved(from.scope.region.boundary, to.scope.region.boundary)
  );
}

/** How the step's picture moved between `before` and `after`, when the app moved it; else null. */
function pictureMove(
  before: DiagramStep,
  after: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>
): PictureMove | null {
  const [from, to] = [before.source, after.source];
  if (from?.kind === 'upload' && to?.kind === 'upload' && from.assetId === to.assetId) {
    const asset = assets[from.assetId];
    if (!asset || 'unknown' in asset) return null;
    return poseMove(asset.widthPx, asset.heightPx, from, to);
  }
  if (
    from?.kind === 'references-step' &&
    to?.kind === 'references-step' &&
    before.picture?.kind === 'step-diagram' &&
    after.picture?.kind === 'step-diagram' &&
    before.picture.model === after.picture.model &&
    before.picture.mirrored !== after.picture.mirrored
  ) {
    const frame = stepPictureFrame(before, assets);
    return frame ? mirrorMove(frame) : null;
  }
  if (
    from?.kind === 'cp' &&
    to?.kind === 'cp' &&
    before.picture?.kind === 'scene' &&
    after.picture?.kind === 'scene' &&
    before.picture.paperScale === after.picture.paperScale &&
    from.fingerprint === to.fingerprint &&
    sameRegion(from, to)
  ) {
    const [was, is] = [from.render, to.render];
    // Turned, its layers spread otherwise, or both, and nothing else: the same
    // mode, and a flat model's same side and layer order. A camera moved (3D,
    // a simulation) is a new picture.
    if (was.mode !== is.mode) return null;
    if (was.mode !== 'crease-pattern' && was.mode !== 'folded-flat') return null;
    if (is.mode !== 'crease-pattern' && is.mode !== 'folded-flat') return null;
    if (was.mode === 'folded-flat' && is.mode === 'folded-flat' && (was.side !== is.side || was.foldCase !== is.foldCase)) {
      return null;
    }
    const delta = is.rotationDeg - was.rotationDeg;
    // A depth spread steps the layers on the screen after the turn, so a
    // turn with it left on moves no face but the nearest as the turn does.
    const spread =
      was.mode === 'folded-flat' &&
      is.mode === 'folded-flat' &&
      (!sameSpread(was.spread, is.spread) || (was.spread?.kind === 'depth' && delta !== 0));
    if (delta === 0 && !spread) return null;
    const [sceneBefore, sceneAfter] = [storedScene(before.picture), storedScene(after.picture)];
    if (!sceneBefore || !sceneAfter) return null;
    // The axis a turn-over turns about follows the poses' own quarter turns, so
    // six 15° presses and a reset bring it back as they bring the picture back.
    const quarters = Math.round(is.rotationDeg / 90) - Math.round(was.rotationDeg / 90);
    const turn = sceneTurnMove(sceneBefore.bounds, sceneAfter.bounds, delta, quarters);
    return turn && spread ? spreadMove(sceneBefore, sceneAfter, turn) : turn;
  }
  return null;
}

/**
 * A flat fold's layers spread otherwise, and perhaps turned, or turned under a
 * depth spread, which stays on the screen as the picture turns: a point moves
 * with the face it was drawn on — the nearest whole face under it — to where
 * that face went, by mean value coordinates over its outline, which take its
 * corners exactly where the spread took them and everything between as the
 * spread's own field does (`foldedLayerSpread.ts`). The nearest layer is not
 * still where it meets deeper ones at a crease, nor is a deeper layer, so the
 * turn alone would leave a mark there off its paper. A point on no face, or on
 * one the other picture does not draw whole (a layer a picture with no spread
 * leaves out), moves by `turn`.
 */
function spreadMove(before: PaperScene, after: PaperScene, turn: PictureMove): PictureMove {
  const drawn = before.items.filter(isWholeFace).filter((item) => !item.hidden);
  const target = new Map<number, ScenePoint[]>();
  for (const item of after.items) {
    if (isWholeFace(item) && !target.has(item.face)) target.set(item.face, item.rings[0]!);
  }
  const [from, to] = [before.bounds, after.bounds];
  const longerFrom = Math.max(from.maxX - from.minX, from.maxY - from.minY);
  const longerTo = Math.max(to.maxX - to.minX, to.maxY - to.minY);
  const epsilon = 1e-9 * longerFrom;
  return {
    ...turn,
    // A direction goes as the turn takes it, whatever the spread does to the face round it.
    vector: ([dx, dy]) => {
      const [x0, y0] = turn.point([0, 0]);
      const [x1, y1] = turn.point([dx, dy]);
      return [x1 - x0, y1 - y0];
    },
    point: ([u, v]) => {
      const at = { x: from.minX + u * longerFrom, y: from.minY + v * longerFrom };
      // Back to front, so the last face found is the one the mark sits on.
      for (let i = drawn.length - 1; i >= 0; i -= 1) {
        const ring = drawn[i]!.rings[0]!;
        // On its outline counts: a mark snapped to a face's corner is that face's.
        if (!insideRing(ring, at) && !onRing(ring, at, epsilon)) continue;
        const goal = target.get(drawn[i]!.face);
        const weights = goal?.length === ring.length ? meanValueWeights(ring.map(([x, y]) => ({ x, y })), at, epsilon) : null;
        if (!goal || !weights) break;
        let [x, y] = [0, 0];
        weights.forEach((weight, corner) => {
          x += weight * goal[corner]![0];
          y += weight * goal[corner]![1];
        });
        return [(x - to.minX) / longerTo, (y - to.minY) / longerTo];
      }
      return turn.point([u, v]);
    },
  };
}

/** A face drawn whole, as one ring — not a woven patch's piece of one. */
function isWholeFace(item: PaperScene['items'][number]): item is PaperFaceItem {
  return item.kind === 'face' && item.group === undefined && item.rings.length === 1;
}

/**
 * Whether `point` lies on the closed `ring`'s outline, within `epsilon`: the
 * even-odd test counts a point on a face's far edges as outside it.
 */
function onRing(ring: readonly ScenePoint[], point: { x: number; y: number }, epsilon: number): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [ax, ay] = ring[j]!;
    const [bx, by] = ring[i]!;
    const [dx, dy] = [bx - ax, by - ay];
    const length = dx * dx + dy * dy;
    const t = length > 0 ? Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy) / length)) : 0;
    if (Math.hypot(point.x - (ax + t * dx), point.y - (ay + t * dy)) <= epsilon) return true;
  }
  return false;
}

/** Even-odd: whether `point` is inside the closed `ring`. */
function insideRing(ring: readonly ScenePoint[], point: { x: number; y: number }): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The step `after` became, its annotations carried along when the app moved
 * the picture they were drawn on: `after` itself when there is nothing to
 * carry or the change was not a move. Only annotations in step with the
 * picture are carried — ones drawn on another picture were never placed on
 * this one, and stay where they are, still out of step. An annotation this
 * build cannot read cannot be moved, so a step carrying one keeps all of them
 * where they were, and says the picture changed.
 */
export function withCarriedAnnotations(
  before: DiagramStep,
  after: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>
): DiagramStep {
  if (after.annotations.length === 0 || after.annotations !== before.annotations) return after;
  if (!before.annotations.every(isKnownAnnotation)) return after;
  const inStep = before.annotatedPictureKey !== null && before.annotatedPictureKey === (before.picture?.key ?? null);
  if (!inStep) return after;
  const move = pictureMove(before, after, assets);
  if (!move) return after;
  return {
    ...after,
    annotations: (before.annotations as KnownDiagramAnnotation[]).map((annotation) => carryAnnotation(annotation, move)),
    annotatedPictureKey: after.picture?.key ?? null,
  };
}
