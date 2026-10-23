/**
 * What Repeat draws over the canvas beside the paper (plan
 * `fold-sequence-tools`, `repeat-axis`):
 *
 * - **the creases the repeat adds**, on the folded pane its preview shows:
 *   each in the diagram-crease pen of its letter as the viewer sees it, as
 *   every tool draws the fold it previews (`withPreviewCreases`). The crease
 *   pattern draws them as every previewed step's instruction already
 *   (`FoldLandedPreview.added`), so they are the folded pane's alone here;
 * - **the axes it can repeat across**: each a line on the sheet, drawn across
 *   the crease pattern, and on the folded pane where the folded form puts
 *   it — through every face it crosses. In Edit's selection colour
 *   (`--cp-selection`), which a theme keeps clear of the fold colours, so no
 *   axis reads as a valley; never a crease's pen and never dashed: dimmest
 *   where its repeat is refused, faint while it is only offered, brighter
 *   under the pointer, brightest once taken;
 * - **a line drawn that is no symmetry axis**, while its refusal is shown:
 *   across the paper of the pane it was drawn on, in the pick's accent,
 *   fainter than a pick.
 *
 * Which axis a point of the canvas is on (`repeatAxisAt`): on the crease
 * pattern, the one it is nearest; on the folded pane, read on the top layer
 * under it, as a drawn line is (`repeatDrawn`).
 *
 * Pure.
 */
import type { Point } from '../../lib/geometry';
import { applyIsometry, chordOfConvex, pointOnLine, sideOf, toPoint } from '../canvas/foldCanvasGeometry';
import type { FoldOverlayInks, FoldOverlayMarks, FoldOverlayStroke } from '../canvas/foldPaneOverlays';
import type { FoldPaneCreaseLine, FoldPendingCreases } from '../canvas/foldPaneScenes';
import { sheetFaceAt, sheetToScene, topSheetPointAt, type FoldPaneId, type FoldPickIndex } from '../canvas/foldPicking';
import type { FoldModelLine, SheetPoint } from '../document/foldSequenceDocument';
import type { FoldLetter, FoldScene } from '../engine/foldEngineWire';
import { lineAcrossPaper } from '../tools/foldStepBuilder';
import { sheetRing } from './repeatGeometry';
import type { RepeatDrawnLine } from './repeatDrawn';

const OTHER: Readonly<Record<FoldLetter, FoldLetter>> = { mountain: 'valley', valley: 'mountain' };

/** Whether the paper at a sheet point shows its front, in a scene; null off its paper. */
function frontUpAt(scene: FoldScene, at: SheetPoint): boolean | null {
  const face = sheetFaceAt(scene, at);
  const transform = face === null ? undefined : scene.face_transforms[face];
  return transform ? transform[0] * transform[4] - transform[1] * transform[3] > 0 : null;
}

/**
 * The creases a previewed repeat adds (`added`, the landed state's own),
 * where its folded form puts them: each placed through the face its sheet
 * point lies on, and lettered as the folder sees the fold made — as the
 * step on screen (`before`) shows the paper there, its stored letter where
 * the front is up and the other where the back is, as a pending fold's line
 * is lettered on the paper it folds. A crease the folded form puts on a
 * folded edge lies on both the paper that stayed and the paper that turned
 * over; the step before tells them apart. Where it has no paper (or is not
 * in), as the result shows it.
 */
export function repeatPreviewCreases(scene: FoldScene, added: ReadonlySet<number>, before: FoldScene | null): FoldPendingCreases {
  const folded: FoldPaneCreaseLine[] = [];
  for (const crease of scene.creases) {
    if (!added.has(crease.id) || !crease.letter) continue;
    const from: SheetPoint = [crease.from.x, crease.from.y];
    const to: SheetPoint = [crease.to.x, crease.to.y];
    const a = sheetToScene(scene, from);
    const b = sheetToScene(scene, to);
    const middle: SheetPoint = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    const frontUp = (before ? frontUpAt(before, middle) : null) ?? frontUpAt(scene, middle);
    if (!a || !b || frontUp === null) continue;
    folded.push({ line: [a, b], letter: frontUp ? crease.letter : OTHER[crease.letter] });
  }
  return { folded, creasePattern: [] };
}

/** A drawn line that is no axis: a pick's accent, fainter, and a little narrower. */
const DRAWN = { widthMul: 1.6, alpha: 0.55 };

/** The axes: offered faint and fine, under the pointer brighter, taken brightest and as wide as a pick. */
const AXIS = {
  /** Its repeat refused: there, but no choice. */
  refused: { widthMul: 1.2, alpha: 0.16 },
  offered: { widthMul: 1.4, alpha: 0.4 },
  hovered: { widthMul: 2.6, alpha: 0.7 },
  taken: { widthMul: 2.6, alpha: 0.95 },
};

const withAlpha = ([r, g, b, a]: FoldOverlayInks['accent'], alpha: number): FoldOverlayInks['accent'] => [r, g, b, a * alpha];

/** A line's stretch across a convex outline, or null when it misses it. */
function across(outline: readonly Point[], line: FoldModelLine): [Point, Point] | null {
  const chord = chordOfConvex(outline, line);
  return chord ? [pointOnLine(line, chord[0]), pointOnLine(line, chord[1])] : null;
}

/** An axis where each pane draws it: across the sheet on the crease pattern, through each face it crosses on the folded pane. */
export interface RepeatAxisLines {
  creasePattern: [Point, Point] | null;
  folded: [Point, Point][];
}

/** A sheet line on both panes: across the sheet's outline, and through every face of the scene it crosses, where the face lies. */
export function repeatAxisLines(scene: FoldScene, outline: readonly SheetPoint[], line: FoldModelLine): RepeatAxisLines {
  const folded: [Point, Point][] = [];
  for (let face = 0; face < scene.faces.length; face++) {
    const transform = scene.face_transforms[face];
    const ends = transform ? across(sheetRing(scene, face), line) : null;
    if (ends && transform) folded.push([applyIsometry(transform, ends[0]), applyIsometry(transform, ends[1])]);
  }
  return { creasePattern: outline.length > 2 ? across(outline.map(toPoint), line) : null, folded };
}

const distanceTo = (p: Point, [a, b]: readonly [Point, Point]) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/**
 * The axis under a point of a pane, within `radius` of it; -1 for none. On
 * the crease pattern (`at` a sheet point), the nearest axis across the sheet.
 * On the folded pane (`at` in the scene), read on the top layer there, as a
 * line drawn on it is: the axis nearest the sheet point of the face on top,
 * where it runs through that face — several axes the folded form lays on one
 * line are told apart by the paper the viewer sees.
 */
export function repeatAxisAt(
  index: FoldPickIndex,
  outline: readonly SheetPoint[],
  axes: readonly FoldModelLine[],
  pane: FoldPaneId,
  at: Point,
  radius: number,
  offered: (k: number) => boolean = () => true
): number {
  let best = -1;
  let nearest = radius;
  if (pane === 'crease-pattern') {
    for (const [k, line] of axes.entries()) {
      if (!offered(k)) continue;
      const ends = across(outline.map(toPoint), line);
      const d = ends ? distanceTo(at, ends) : Infinity;
      if (d <= nearest) [best, nearest] = [k, d];
    }
    return best;
  }
  const sheet = topSheetPointAt(index, at);
  if (!sheet) return -1;
  const point = toPoint(sheet);
  for (const [k, line] of axes.entries()) {
    if (!offered(k)) continue;
    const d = Math.abs(sideOf(line, point));
    if (d <= nearest) [best, nearest] = [k, d];
  }
  return best;
}

export interface FoldRepeatOverlay {
  folded: FoldOverlayMarks;
  creasePattern: FoldOverlayMarks;
}

/**
 * The axes on both panes, the one taken and the one under the pointer lit
 * (`taken`, `hovered`: indices into `axes`, -1 for none), the ones whose
 * repeat is refused (`refused`) dimmest, and a refused drawn line on the pane
 * it was drawn on. The dimmer lines are drawn first, so the brighter ones lie
 * over them where the folded form lays several on one line.
 */
export function repeatOverlay(
  index: FoldPickIndex | null,
  outline: readonly SheetPoint[] | null,
  axes: readonly FoldModelLine[],
  taken: number,
  hovered: number,
  refused: readonly number[],
  drawn: RepeatDrawnLine | null,
  inks: FoldOverlayInks
): FoldRepeatOverlay {
  const folded: FoldOverlayStroke[] = [];
  const creasePattern: FoldOverlayStroke[] = [];
  // The axes in Edit's selection colour, so none reads as a valley crease; a refused drawn line in the pick's accent.
  const stroke = (
    ends: readonly [Point, Point],
    style: { widthMul: number; alpha: number },
    ink: FoldOverlayInks['accent'] = inks.selection
  ): FoldOverlayStroke => ({
    a: ends[0],
    b: ends[1],
    color: withAlpha(ink, style.alpha),
    widthMul: style.widthMul,
  });
  const order = axes.map((_, k) => k).sort((a, b) => rank(a) - rank(b));
  function rank(k: number) {
    return k === taken ? 3 : k === hovered ? 2 : refused.includes(k) ? 0 : 1;
  }
  for (const k of order) {
    const style = k === taken ? AXIS.taken : k === hovered ? AXIS.hovered : refused.includes(k) ? AXIS.refused : AXIS.offered;
    const lines = index ? repeatAxisLines(index.scene, outline ?? [], axes[k]!) : null;
    if (!lines) continue;
    if (lines.creasePattern) creasePattern.push(stroke(lines.creasePattern, style));
    for (const each of lines.folded) folded.push(stroke(each, style));
  }
  if (drawn) {
    if (drawn.pane === 'folded' && index) {
      const ends = lineAcrossPaper(index, drawn.drawn);
      if (ends) folded.push(stroke(ends, DRAWN, inks.accent));
    } else if (drawn.pane === 'crease-pattern' && outline && outline.length > 2) {
      const ends = across(outline.map(toPoint), drawn.drawn);
      if (ends) creasePattern.push(stroke(ends, DRAWN, inks.accent));
    }
  }
  return { folded: { dots: [], strokes: folded }, creasePattern: { dots: [], strokes: creasePattern } };
}
