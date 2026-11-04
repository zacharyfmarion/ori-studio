/**
 * The dialog's faces: how they meet the host's kernel, and the letters the
 * panes, the inspector and the face menu all call them by.
 *
 * **The bridge is the identity.** The engine builds the solver's folded view
 * from Oriedita's own wireframe over exactly the segments the host folded
 * (`LayerSource::from_oriedita`, E4), so dialog face *k* is Oriedita face *k*,
 * numbered from 0 as Oriedita's relations name them. The face-ring digest,
 * checked when the session opens and again on the new fold at Apply, is what
 * holds the two kernels to it (`LayerOrderSource.digest`). Nothing maps faces
 * by point between them; the only mapping left would be convexified pieces to
 * faces, if that lands later (D4), and it would land here.
 *
 * **Letters** are assigned once per opening, in the crease pattern's reading
 * order, so a figure always gets the same letters and they read the way a
 * person scans the pattern. Each face is placed by its centroid on the
 * crease pattern (its ring in the paper scene's `sheet_points`, inside it
 * because v1's faces are convex, D4):
 *
 * 1. the paper's height, top to bottom, is cut into {@link FACE_LETTER_ROWS}
 *    equal rows (the prototype's 100-unit bands on its 1000-unit paper,
 *    `Round3.dc.html:614-618`, made scale-free);
 * 2. faces go row by row from the top, by the row their centroid lies in,
 *    and left to right within a row by its x, then by face number, so no two
 *    faces ever tie (a face with no ring, which a current scene never has,
 *    goes last);
 * 3. the n-th face so ordered is lettered A … Z, AA … AZ, BA … ZZ, AAA …
 *    (bijective base 26).
 *
 * The crease pattern's y grows downward on screen (`cpModelToSvg`), so the
 * top row is the smallest y. Letters are paper-relative: the front and back
 * scenes share their `sheet_points`, so turning the figure over never
 * changes them.
 *
 * Pure: no React, no store, no engine.
 */
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';

/** A face, as the dialog, the engine and the host's kernel all number it: Oriedita's index, from 0. */
export type LayerFace = number;

/** The host kernel's index of a dialog face: the same number. */
export function kernelFaceOf(face: LayerFace): number {
  return face;
}

/** The dialog face a host kernel's face index names: the same number. */
export function layerFaceOf(kernelFace: number): LayerFace {
  return kernelFace;
}

/** Whether `value` names one of a figure's `faceCount` faces. */
export function isLayerFace(value: unknown, faceCount: number): value is LayerFace {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < faceCount;
}

// ---------------------------------------------------------------------------
// Where faces lie on the crease pattern

/**
 * Each face's centroid on the crease pattern, flat `[x0, y0, x1, y1, …]`, by
 * kernel face: its ring is `scene.faces[k].points` into `scene.sheet_points`.
 * NaN for a face with no ring.
 */
export function faceCentroidsOf(scene: OristudioCpFoldedPaperScene): Float64Array {
  const centroids = new Float64Array(scene.faces.length * 2).fill(Number.NaN);
  scene.faces.forEach((face, k) => {
    const ring = face.points.map((point) => scene.sheet_points[point]).filter((point) => point !== undefined);
    if (ring.length === 0) return;
    let twiceArea = 0;
    let x = 0;
    let y = 0;
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length]!;
      const cross = p.x * q.y - q.x * p.y;
      twiceArea += cross;
      x += (p.x + q.x) * cross;
      y += (p.y + q.y) * cross;
    });
    if (Math.abs(twiceArea) > 1e-12) {
      centroids.set([x / (3 * twiceArea), y / (3 * twiceArea)], k * 2);
    } else {
      // A ring with no area: its points' mean.
      centroids.set(
        [ring.reduce((sum, p) => sum + p.x, 0) / ring.length, ring.reduce((sum, p) => sum + p.y, 0) / ring.length],
        k * 2
      );
    }
  });
  return centroids;
}

/** The paper's top and bottom, in the crease pattern's coordinates. */
export interface LayerPaperRows {
  readonly top: number;
  readonly bottom: number;
}

/** The paper's top and bottom: the extent of every point of the unfolded sheet. */
export function paperRowsOf(scene: OristudioCpFoldedPaperScene): LayerPaperRows {
  let top = Infinity;
  let bottom = -Infinity;
  for (const { y } of scene.sheet_points) {
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  return Number.isFinite(top) ? { top, bottom } : { top: 0, bottom: 0 };
}

// ---------------------------------------------------------------------------
// Letters

/** How many rows the paper's height is cut into for reading order. */
export const FACE_LETTER_ROWS = 10;

const A = 'A'.charCodeAt(0);

/** The letters of the `rank`-th face in reading order, from 0: A … Z, AA, AB, …. */
export function faceLetter(rank: number): string {
  let letters = '';
  let n = rank + 1;
  while (n > 0) {
    const digit = (n - 1) % 26;
    letters = String.fromCharCode(A + digit) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** The rank `letters` stand for, the inverse of {@link faceLetter}; null for anything but capitals A–Z. */
export function letterRank(letters: string): number | null {
  if (!/^[A-Z]+$/.test(letters)) return null;
  let n = 0;
  for (const letter of letters) n = n * 26 + (letter.charCodeAt(0) - A + 1);
  return n - 1;
}

/** A figure's letters, assigned once per opening. */
export interface FaceLetters {
  readonly faceCount: number;
  /** Faces in letter order: A first. */
  readonly inLetterOrder: readonly LayerFace[];
  /** A face's letters; empty for a face the figure lacks. */
  letterOf(face: LayerFace): string;
  /** The face `letters` name, or null. */
  faceOf(letters: string): LayerFace | null;
  /** Orders faces by their letters, for a subject's objects and the face menu. */
  compare(a: LayerFace, b: LayerFace): number;
}

/**
 * Letter every face (see the module docs) from a point inside each, flat
 * `[x0, y0, x1, y1, …]` in the crease pattern's coordinates.
 */
export function assignFaceLetters(points: Float64Array, paper: LayerPaperRows): FaceLetters {
  const faceCount = Math.floor(points.length / 2);
  const height = paper.bottom - paper.top;
  const rowOf = (face: LayerFace): number => {
    const y = points[2 * face + 1]!;
    if (!Number.isFinite(y)) return FACE_LETTER_ROWS;
    if (!(height > 0)) return 0;
    const row = Math.floor(((y - paper.top) / height) * FACE_LETTER_ROWS);
    return Math.min(FACE_LETTER_ROWS - 1, Math.max(0, row));
  };
  const rows = Array.from({ length: faceCount }, (_, face) => rowOf(face));
  const xOf = (face: LayerFace) => (Number.isFinite(points[2 * face]!) ? points[2 * face]! : 0);
  const inLetterOrder = Array.from({ length: faceCount }, (_, face) => face).sort(
    (a, b) => rows[a]! - rows[b]! || xOf(a) - xOf(b) || a - b
  );
  const ranks = new Uint32Array(faceCount);
  inLetterOrder.forEach((face, rank) => {
    ranks[face] = rank;
  });
  const letters = inLetterOrder.map((_, rank) => faceLetter(rank));
  return {
    faceCount,
    inLetterOrder,
    letterOf: (face) => (isLayerFace(face, faceCount) ? letters[ranks[face]!]! : ''),
    faceOf: (text) => {
      const rank = letterRank(text);
      return rank !== null && rank < faceCount ? inLetterOrder[rank]! : null;
    },
    compare: (a, b) => ranks[a]! - ranks[b]!,
  };
}

/** A figure's letters, from either of its paper scenes. */
export function faceLettersOf(scene: OristudioCpFoldedPaperScene): FaceLetters {
  return assignFaceLetters(faceCentroidsOf(scene), paperRowsOf(scene));
}
