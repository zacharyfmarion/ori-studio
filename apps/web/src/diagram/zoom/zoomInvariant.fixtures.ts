import type { PicturePoint } from '../annotate/annotationModel';
import { storedSceneStep } from '../capture/captureGeometry';
import { isKnownAnnotation, isTurn, type DiagramDocument, type DiagramStep, type DiagramZoomOutline } from '../document/diagramDocument';
import { storedScene } from '../pictures/pictureFrame';
import { fromBox, stepWindow } from './zoomFrames';
import { landFrame, paperFacesOf, toScene } from './zoomImprint';

/**
 * The invariant every edit keeps on enlarged steps (Revision 2, "Keeping
 * frames and marks consistent"), for the tests of every verb that touches
 * one: each enlarged step whose picture has faces has a frame equal to its
 * imprint landed on that picture, to the stored scene's step — or its
 * anchor's point is off that paper, which its notice says — and a mark moves
 * on the paper only where the verb moved it.
 */

/** What breaks the invariant in `document`: one line per enlarged step whose frame is not its imprint landed. */
export function frameProblems(document: DiagramDocument): string[] {
  const problems: string[] = [];
  for (const entry of document.steps) {
    if (isTurn(entry) || !entry.zoom?.frame || !entry.zoom.imprint || !entry.picture) continue;
    const faces = paperFacesOf(entry);
    if (!faces) continue;
    const landed = landFrame(faces, entry.zoom.imprint, entry.zoom.imprint.on);
    // The anchor's point off this paper: the frame stays in picture units, and the Step pane says so.
    if (!landed) continue;
    const drawn = toScene(faces, entry.zoom.frame);
    const sheet = entry.picture.kind === 'scene' ? (storedScene(entry.picture)?.sheet ?? 0) : 0;
    const tolerance = 2 * storedSceneStep(sheet);
    const off = differs(drawn, landed, tolerance);
    if (off) problems.push(`${entry.id}: ${off}`);
  }
  return problems;
}

function differs(a: DiagramZoomOutline, b: DiagramZoomOutline, tolerance: number): string | null {
  const centre = Math.hypot(a.centre[0] - b.centre[0], a.centre[1] - b.centre[1]);
  if (centre > tolerance) return `centre ${centre.toFixed(4)} px off`;
  const sizes = [
    [a.radius, b.radius],
    [a.size?.[0], b.size?.[0]],
    [a.size?.[1], b.size?.[1]],
  ];
  for (const [x, y] of sizes) {
    if ((x === undefined) !== (y === undefined)) return 'another shape';
    if (x !== undefined && y !== undefined && Math.abs(x - y) > tolerance) return `size ${Math.abs(x - y).toFixed(4)} px off`;
  }
  const turn = Math.abs((((a.angle ?? 0) - (b.angle ?? 0)) % 180 + 180) % 180);
  if (Math.min(turn, 180 - turn) > 1e-6) return `turned ${turn}°`;
  return null;
}

/** Each mark's points in its step's picture units — through its window when it is enlarged — by id. */
export function marksInPicture(step: DiagramStep): Map<string, PicturePoint[]> {
  const window = stepWindow(step);
  const place = (point: PicturePoint): PicturePoint => (window ? fromBox(window, point) : point);
  const marks = new Map<string, PicturePoint[]>();
  for (const mark of step.annotations) {
    if (!isKnownAnnotation(mark)) continue;
    marks.set(mark.id, [place(mark.from), place(mark.to)]);
  }
  return marks;
}

/** The marks that moved on the picture from `before` to `after`, beyond float noise. */
export function marksMoved(before: DiagramStep, after: DiagramStep): string[] {
  const [was, now] = [marksInPicture(before), marksInPicture(after)];
  const moved: string[] = [];
  for (const [id, points] of was) {
    const there = now.get(id);
    if (!there || points.some((point, index) => Math.hypot(point[0] - there[index]![0], point[1] - there[index]![1]) > 1e-9)) {
      moved.push(id);
    }
  }
  return moved;
}

/**
 * The marks that moved on the paper from `was` to `now` where no verb meant
 * to move them: on each step enlarged before or after whose picture is the
 * one it was — its key and its source — every mark in both stays where it
 * was on that picture. Not checked: steps in `allowed`, the ones the verbs
 * under test move marks on; a step whose own picture the verb changed, which
 * carries its marks itself; and one the change left out of step with its
 * picture, which its notice says (D8). One line per step.
 */
export function marksProblems(was: DiagramDocument, now: DiagramDocument, allowed: ReadonlySet<string> = new Set()): string[] {
  const before = new Map(was.steps.filter((entry): entry is DiagramStep => !isTurn(entry)).map((entry) => [entry.id, entry]));
  const inStep = (step: DiagramStep) => step.annotatedPictureKey === step.picture?.key;
  const problems: string[] = [];
  for (const entry of now.steps) {
    const old = isTurn(entry) ? undefined : before.get(entry.id);
    if (isTurn(entry) || !old || old === entry || allowed.has(entry.id) || (!old.zoom && !entry.zoom)) continue;
    const samePicture = old.picture?.key === entry.picture?.key && JSON.stringify(old.source) === JSON.stringify(entry.source);
    if (!old.picture || !samePicture || (inStep(old) && !inStep(entry))) continue;
    const kept = marksInPicture(entry);
    const moved = marksMoved(old, entry).filter((id) => kept.has(id));
    if (moved.length > 0) problems.push(`${entry.id}: marks moved on the paper (${moved.join(', ')})`);
  }
  return problems;
}

/** The invariant, watched over a store: what broke it, and the steps a test lets its verbs move marks on. */
export interface FrameWatch {
  /** One line for each break: a frame off its imprint ({@link frameProblems}), or marks moved ({@link marksProblems}). */
  problems: string[];
  /** The steps the verbs under test move marks on by design — a mark dragged, a test's own setup — from now on. */
  allowMarksMoved: (...stepIds: string[]) => void;
  stop: () => void;
}

/**
 * The invariant after every store verb, for the slice tests: each diagram a
 * store comes to hold is checked as it lands — every enlarged step's frame by
 * {@link frameProblems}, and against the diagram before it, the marks of
 * steps the verb did not mean to move by {@link marksProblems} — and what
 * broke it is kept for the test to assert empty. A diagram opened in place of
 * another is checked for its frames alone. `subscribe` is the store's own.
 */
export function watchFrames<State extends { diagram: DiagramDocument | null; diagramLoadId?: number }>(
  subscribe: (listener: (now: State, was: State) => void) => () => void
): FrameWatch {
  const problems: string[] = [];
  const allowed = new Set<string>();
  const stop = subscribe((now, was) => {
    if (!now.diagram || now.diagram === was.diagram) return;
    problems.push(...frameProblems(now.diagram));
    if (was.diagram && now.diagramLoadId === was.diagramLoadId) problems.push(...marksProblems(was.diagram, now.diagram, allowed));
  });
  return { problems, allowMarksMoved: (...stepIds) => stepIds.forEach((id) => allowed.add(id)), stop };
}
