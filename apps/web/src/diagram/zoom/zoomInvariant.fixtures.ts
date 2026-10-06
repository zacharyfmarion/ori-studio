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
