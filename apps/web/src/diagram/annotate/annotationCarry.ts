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
import { boundariesMatchMoved, isRelativeFingerprint } from '../../cp-workspace/regions/regionIdentity';
import { turnClockwise } from '../../lib/geometry';
import type { SceneBounds } from '../../lib/paper/paperScene';
import {
  isKnownAnnotation,
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
    // Turned, and nothing else: the same mode, and a flat model's same side and
    // layer order. A camera moved (3D, a simulation) is a new picture.
    if (was.mode !== is.mode) return null;
    if (was.mode !== 'crease-pattern' && was.mode !== 'folded-flat') return null;
    if (is.mode !== 'crease-pattern' && is.mode !== 'folded-flat') return null;
    if (was.mode === 'folded-flat' && is.mode === 'folded-flat' && (was.side !== is.side || was.foldCase !== is.foldCase)) {
      return null;
    }
    const delta = is.rotationDeg - was.rotationDeg;
    if (delta === 0) return null;
    const [sceneBefore, sceneAfter] = [storedScene(before.picture), storedScene(after.picture)];
    if (!sceneBefore || !sceneAfter) return null;
    // The axis a turn-over turns about follows the poses' own quarter turns, so
    // six 15° presses and a reset bring it back as they bring the picture back.
    const quarters = Math.round(is.rotationDeg / 90) - Math.round(was.rotationDeg / 90);
    return sceneTurnMove(sceneBefore.bounds, sceneAfter.bounds, delta, quarters);
  }
  return null;
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
