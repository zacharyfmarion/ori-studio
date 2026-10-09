import type { ReactNode } from 'react';
import { keyDigest } from '../../../lib/keyDigest';
import { paperRingPoints, type SvgPoint } from '../stepDiagramGeometry';

/**
 * A letter's halo on a picture of a sheet, when the picture leaves the app:
 * the face on the sheet and the ground off it, so the halo follows the
 * sheet's edge (rf6 for Text, rf7 for References' own letters).
 *
 * A halo is what its letter stands on. Wholly on the sheet, that is the face
 * the picture shows; wholly off it, the ground round it. A letter across the
 * edge stands on both, and one colour picked by where its middle is spills
 * that colour past the edge: a grey notch on the white page, or a white one
 * cut into the grey sheet. So across the edge the one halo stroke is painted
 * with a pattern of the sheet ({@link haloPatternElement}) instead.
 *
 * The one place both kinds of letter decide this: a Text label
 * (`annotationPrimitives`) and a References letter (`DiagramPrimitives`), so
 * a letter pulled out of a References card (17d) is haloed as its baked one.
 */

/** A box, its least and greatest x and y. */
export interface ReachBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * What a halo across the sheet's edge is painted with: a pattern of the
 * ground with the sheet over it in its face, one tile over the letter. Its id
 * is made from what it paints, so two drawings that share one share what it
 * paints too, as References' clips are named (`createDiagramRenderContext`).
 */
export interface SheetHaloAcross {
  id: string;
  /** The sheet's face, which the halo is on the sheet. */
  face: string;
  /** The sheet's outline, in the drawing's units. */
  outline: readonly SvgPoint[];
  /** The tile, in the drawing's units: past the letter and its halo, so it never repeats under them. */
  box: { x: number; y: number; width: number; height: number };
}

/** A halo's paint: one colour, or, across the sheet's edge, `color` — the ground — off it and `across` on it. */
export interface SheetHaloPaint {
  color: string;
  across?: SheetHaloAcross;
}

/**
 * The halos of letters on one sheet: given what a letter reaches, its halo
 * included, and its em, its paint. Wholly on the sheet `face`, wholly off it
 * `ground`, each the very string given, so a letter that does not cross the
 * edge is drawn as it was before there was a pattern. Across it, a pattern
 * whose id starts `idPrefix`. A face that is the ground's colour is one
 * colour across the edge too.
 */
export function sheetHalo(
  outline: readonly SvgPoint[],
  face: string,
  ground: string,
  idPrefix: string
): (reach: ReachBox, em: number) => SheetHaloPaint {
  const ring = paperRingPoints(outline);
  const plain = face.toLowerCase() === ground.toLowerCase();
  return (reach, em) => {
    switch (boxOnSheet(reach, outline)) {
      case 'on':
        return { color: face };
      case 'off':
        return { color: ground };
      case 'across': {
        if (plain) return { color: ground };
        // An em past its reach each way: a tile the letter never runs off, wherever a glyph's ink stands.
        const box = {
          x: reach.minX - em,
          y: reach.minY - em,
          width: reach.maxX - reach.minX + 2 * em,
          height: reach.maxY - reach.minY + 2 * em,
        };
        const id = keyDigest([ring, face, ground, ...[box.x, box.y, box.width, box.height].map(String)], idPrefix);
        return { color: ground, across: { id, face, outline, box } };
      }
    }
  };
}

/**
 * Where a box lies against a sheet's outline: wholly on it, wholly off it,
 * or across its edge. The outline is convex, a sheet's rectangle (D8), so
 * the box is on it when its corners are, and off it when an edge of either
 * has the other wholly beyond it.
 */
export function boxOnSheet(box: ReachBox, outline: readonly SvgPoint[]): 'on' | 'off' | 'across' {
  if (outline.length < 3) return 'off';
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  if (Math.max(...xs) <= box.minX || Math.min(...xs) >= box.maxX || Math.max(...ys) <= box.minY || Math.min(...ys) >= box.maxY) {
    return 'off';
  }
  // Which way the outline turns, so an edge's inside is the same side whichever way it is wound.
  let area = 0;
  outline.forEach((a, index) => {
    const b = outline[(index + 1) % outline.length]!;
    area += a.x * b.y - b.x * a.y;
  });
  if (area === 0) return 'off';
  const turn = Math.sign(area);
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  let on = true;
  for (let index = 0; index < outline.length; index += 1) {
    const a = outline[index]!;
    const b = outline[(index + 1) % outline.length]!;
    const sides = corners.map((p) => ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) * turn);
    if (sides.every((side) => side <= 0)) return 'off';
    if (sides.some((side) => side < 0)) on = false;
  }
  return on ? 'on' : 'across';
}

const round = (value: number) => Number(value.toFixed(3));

/**
 * A halo's pattern across the sheet's edge, as `<defs>`: one tile over its
 * letter, `ground` with the sheet over it in its face — the edge between them
 * softened once, where the sheet's own is. A tile's content is placed from
 * its corner, so the sheet is drawn from there. Its id is `across.id` and
 * then `scope`, for a surface that shares one document with others.
 *
 * One stroke painted so, rather than two copies of the letter clipped either
 * side of the edge: two clips that meet on the edge each soften it, and two
 * strokes laid one over the other each soften their rim, so either way a
 * hairline of what is under them shows; and a page's PDF would set the words
 * two times more.
 */
export function haloPatternElement(across: SheetHaloAcross, ground: string, scope = ''): ReactNode {
  const { box } = across;
  const sheet = across.outline.map((p) => ({ x: p.x - box.x, y: p.y - box.y }));
  return (
    <defs>
      <pattern
        id={`${across.id}${scope}`}
        patternUnits="userSpaceOnUse"
        x={round(box.x)}
        y={round(box.y)}
        width={round(box.width)}
        height={round(box.height)}
      >
        <rect width={round(box.width)} height={round(box.height)} fill={ground} />
        <polygon points={paperRingPoints(sheet)} fill={across.face} />
      </pattern>
    </defs>
  );
}
