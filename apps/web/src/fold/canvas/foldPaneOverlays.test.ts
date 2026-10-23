import { describe, expect, it } from 'vitest';
import type { Rgba } from '../../cp-workspace/renderer/types';
import { bookScene } from './foldCanvas.fixtures';
import type { Point } from '../../lib/geometry';
import { foldHoverEcho, foldPaneOverlay, type FoldOverlayInks } from './foldPaneOverlays';
import type { FoldPaneSpreadMap } from './foldPaneSpreadMap';
import {
  foldPickIndex,
  resolveFoldPick,
  sheetToScene,
  type FoldFreePick,
  type FoldPaneId,
  type FoldPick,
} from './foldPicking';

const RADII = { point: 0.03, line: 0.03 };
const FREE = { snap: 'free', edges: false, free: false } as const;
const INKS: FoldOverlayInks = {
  accent: [1, 0, 0, 1] as Rgba,
  mark: [0, 1, 0, 1] as Rgba,
  outline: [0, 0, 0, 1] as Rgba,
  selection: [1, 0.8, 0.4, 1] as Rgba,
};

/** A float32 channel's value, back to the decimals it was given in. */
const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** The dots' centres an overlay draws. */
function dots(overlay: ReturnType<typeof foldPaneOverlay>): [number, number][] {
  const points = overlay.points;
  if (!points) return [];
  return Array.from({ length: points.count }, (_, k) => [round(points.center[k * 2]!), round(points.center[k * 2 + 1]!)]);
}

describe('a free line drawn on the crease-pattern pane', () => {
  const scene = bookScene();
  const index = foldPickIndex(scene, null, []);
  const click = (pane: FoldPaneId, x: number, y: number) => {
    const pick = resolveFoldPick(index, pane, { x, y }, RADII, FREE);
    if (pick?.kind !== 'free') throw new Error('no free pick');
    return pick;
  };
  const overlay = (pane: FoldPaneId, first: FoldFreePick, hovered: FoldFreePick | null) =>
    foldPaneOverlay({
      pane,
      scene,
      picks: [first],
      hovered: hovered && { pane: hovered.pane, at: { x: 0, y: 0 }, pick: hovered },
      freeFrom: first,
      marks: [],
      inks: INKS,
    });

  it('draws its first end where it was clicked, on both panes', () => {
    const first = click('crease-pattern', 0.75, 0.9);
    expect(first.sheet).toEqual([0.75, 0.9]);
    // On the sheet where it was clicked; folded, on the left half the right lies over.
    expect(dots(overlay('crease-pattern', first, null))).toEqual([[0.75, 0.9]]);
    const [[x, y]] = dots(overlay('folded', first, null)) as [[number, number]];
    expect(x).toBeCloseTo(0.25, 6);
    expect(y).toBeCloseTo(0.9, 6);
  });

  it('runs the live line on the crease pattern from it to where a click would end it', () => {
    const first = click('crease-pattern', 0.25, 0.1);
    const pointer = click('crease-pattern', 0.75, 0.9);
    const strokes = overlay('crease-pattern', first, pointer).strokes;
    expect(strokes?.count).toBe(1);
    expect(Array.from(strokes!.a).map(round)).toEqual([0.25, 0.1]);
    expect(Array.from(strokes!.b).map(round)).toEqual([0.75, 0.9]);
    // The other pane draws no line for a pointer that is not over it.
    expect(overlay('folded', first, pointer).strokes).toBeNull();
  });

  it('draws a partial precrease’s line on each pane, its points along it, and a segment to the pointer', () => {
    const along: FoldPick = { kind: 'point', provenance: 'crossing', sheet: [0.75, 0.5], mark: null, scene: { x: 0.25, y: 0.5 } };
    const hover: FoldPick = { kind: 'point', provenance: 'midpoint', sheet: [0.9, 0.5], mark: null, scene: { x: 0.1, y: 0.5 } };
    const pieces = [[{ x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }]] as const;
    const drawn = (faint: boolean) =>
      foldPaneOverlay({
        pane: 'folded',
        scene,
        picks: [],
        hovered: { pane: 'folded', at: { x: 0.1, y: 0.5 }, pick: hover },
        freeFrom: null,
        marks: [],
        inks: INKS,
        along: { pieces, picks: [along], segment: true, faint },
      });
    const bright = drawn(false);
    // The line, then the stretch from the segment's first end to the point under the pointer.
    expect(bright.strokes?.count).toBe(2);
    expect(Array.from(bright.strokes!.a.slice(2, 4)).map(round)).toEqual([0.25, 0.5]);
    expect(Array.from(bright.strokes!.b.slice(2, 4)).map(round)).toEqual([0.1, 0.5]);
    // Solid, never dashed: a dash is a crease's.
    expect(Array.from(bright.strokes!.dashSlot ?? [])).toEqual([0, 0]);
    expect(dots(bright)).toEqual([
      [0.25, 0.5],
      [0.1, 0.5],
    ]);
    // Every point in: the line steps back behind the fold's picture.
    const faint = drawn(true);
    expect(faint.strokes!.color[3]).toBeLessThan(bright.strokes!.color[3]!);
    expect(faint.strokes!.widthMul[0]).toBeLessThan(bright.strokes!.widthMul[0]!);
  });

  it('draws a located line awaiting its picture on the folded pane only, under the picks', () => {
    const first = click('folded', 0.1, 0.5);
    const located = [[{ x: 0, y: 0.6 }, { x: 0.5, y: 0.6 }]] as const;
    const drawn = (pane: FoldPaneId) =>
      foldPaneOverlay({ pane, scene, picks: [first], hovered: null, freeFrom: null, located, marks: [], inks: INKS }).strokes;
    const folded = drawn('folded');
    expect(folded?.count).toBe(1);
    expect(Array.from(folded!.a).map(round)).toEqual([0, 0.6]);
    expect(Array.from(folded!.b).map(round)).toEqual([0.5, 0.6]);
    // In the scene frame, which the crease-pattern pane does not draw in.
    expect(drawn('crease-pattern')).toBeNull();
  });

  it('draws the hover, the picks and the marks where a spread pane draws their sheet points', () => {
    // A spread that moves every sheet point a tenth to the right of where the book puts it.
    const shift = { x: 0.1, y: 0 };
    const placed = (at: Point | null) => at && { x: at.x + shift.x, y: at.y + shift.y };
    const spread: FoldPaneSpreadMap = {
      onFace: (_face, point) => placed(point)!,
      sheet: (sheet) => placed(sheetToScene(scene, sheet)),
      segment: (ends, at) => [placed(sheetToScene(scene, ends[0]) ?? at[0])!, placed(sheetToScene(scene, ends[1]) ?? at[1])!],
      under: () => null,
    };
    const corner: FoldPick = { kind: 'point', provenance: 'vertex', sheet: [1, 1], mark: null, scene: { x: 0, y: 1 } };
    const mark = { id: 'fmark-1', from: [0.5, 0] as const, to: [0.5, 1] as const, divide: { mode: 'count' as const, parts: 2 } };
    const drawn = (pane: FoldPaneId, with_: FoldPaneSpreadMap | null) =>
      dots(
        foldPaneOverlay({
          pane,
          scene,
          picks: [],
          hovered: { pane, at: { x: 0, y: 0 }, pick: corner },
          freeFrom: null,
          marks: [mark],
          inks: INKS,
          spread: with_,
        })
      );
    // The mark's middle and the hovered corner: moved with the paper on the folded pane.
    expect(drawn('folded', spread)).toEqual([[0.6, 0.5], [0.1, 1]]);
    expect(drawn('folded', null)).toEqual([[0.5, 0.5], [0, 1]]);
    // The crease-pattern pane is never spread.
    expect(drawn('crease-pattern', spread)).toEqual([[0.5, 0.5], [1, 1]]);
  });

  it('keeps a folded-pane free end on the sheet too, and none off the paper', () => {
    const onPaper = click('folded', 0.25, 0.5);
    expect(onPaper.sheet?.[0]).toBeCloseTo(0.75, 12);
    expect(click('folded', 0.9, 0.5).sheet).toBeNull();
    expect(dots(overlay('crease-pattern', click('folded', 0.9, 0.5), null))).toEqual([]);
  });

  it('lights the lines a click is offered under the picks, and the one under the pointer as brightly as a pick', () => {
    const [left, right] = index.creasePattern.segments;
    if (!left || !right) throw new Error('no lines');
    const drawn = (hovered: FoldPick | null) =>
      foldPaneOverlay({
        pane: 'crease-pattern',
        scene,
        picks: [],
        hovered: hovered && { pane: 'crease-pattern', at: { x: 0, y: 0 }, pick: hovered },
        freeFrom: null,
        marks: [],
        inks: INKS,
        offered: [left, right],
      }).strokes!;
    const quiet = drawn(null);
    expect(quiet.count).toBe(2);
    expect(round(quiet.color[3]!)).toBeLessThan(1);
    // Under the pointer: drawn again over it, at full strength.
    const lit = drawn(left);
    expect(lit.count).toBe(3);
    expect(round(lit.color[2 * 4 + 3]!)).toBe(1);
    expect(round(lit.widthMul[2]!)).toBeGreaterThan(round(lit.widthMul[0]!));
    // A line not offered, under the pointer, is the hover's as ever.
    const elsewhere = foldPaneOverlay({
      pane: 'crease-pattern',
      scene,
      picks: [],
      hovered: { pane: 'crease-pattern', at: { x: 0, y: 0 }, pick: left },
      freeFrom: null,
      marks: [],
      inks: INKS,
    }).strokes!;
    expect(round(elsewhere.color[3]!)).toBeLessThan(1);
  });

  it('draws a swivel’s folded edge lit and no dot where it was clicked: the preview finds where the creases meet', () => {
    const [edge] = index.creasePattern.segments;
    if (!edge) throw new Error('no line');
    const [a, b] = edge.sheet;
    const sheet: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const onFold: FoldPick = { kind: 'point', provenance: 'fold', sheet, mark: null, scene: { x: sheet[0], y: sheet[1] }, fold: edge };
    for (const [picks, hovered] of [
      [[onFold], null],
      [[], onFold],
    ] as const) {
      const overlay = foldPaneOverlay({
        pane: 'crease-pattern',
        scene,
        picks,
        hovered: hovered && { pane: 'crease-pattern', at: { x: 0, y: 0 }, pick: hovered },
        freeFrom: null,
        marks: [],
        inks: INKS,
      });
      expect(dots(overlay)).toEqual([]);
      expect(overlay.strokes?.count).toBe(1);
    }
  });

  it('shows a given swivel meeting point as a dot on hover and after picking, on both panes', () => {
    const edge = index.creasePattern.segments.find((segment) => segment.segment === 'bend')!;
    const meeting: FoldPick = {
      kind: 'point', provenance: 'fold', sheet: [0.5, 0.4], scene: { x: 0.5, y: 0.4 },
      mark: null, fold: edge, foldLocation: 'given',
    };
    for (const pane of ['folded', 'crease-pattern'] as const) {
      for (const picked of [false, true]) {
        const drawn = foldPaneOverlay({
          pane, scene, picks: picked ? [meeting] : [],
          hovered: picked ? null : { pane, at: { x: 0.5, y: 0.4 }, pick: meeting },
          freeFrom: null, marks: [], inks: INKS,
        });
        expect(dots(drawn)).toEqual([[0.5, 0.4]]);
        expect(drawn.strokes).toBeNull();
      }
    }
  });

  it('marks on the crease pattern the point a click on the folded pane would take, before the click', () => {
    // The book's corner on the folded pane is the right half's (1, 0), lying over the left half's (0, 0).
    const corner: FoldPick = { kind: 'point', pane: 'folded', provenance: 'vertex', sheet: [1, 0], mark: null, scene: { x: 0, y: 0 } };
    const hit = { pane: 'folded' as const, at: { x: 0.01, y: 0.01 }, pick: corner };
    const echo = foldHoverEcho(hit, null);
    expect(echo).toBe(corner);
    const drawn = foldPaneOverlay({ pane: 'crease-pattern', scene, picks: [], hovered: null, freeFrom: null, marks: [], inks: INKS, echo });
    expect(dots(drawn)).toEqual([[1, 0]]);
    // As a picked point is marked: the accent's dot, outlined.
    expect(drawn.points?.radius[0]).toBe(4.5);
    expect(Array.from(drawn.points?.fill ?? [])).toEqual(INKS.accent);
    // The same point a frame later is the echo it was; a line, bare paper or none echoes nothing.
    expect(foldHoverEcho({ ...hit, pick: { ...corner } }, echo)).toBe(echo);
    expect(foldHoverEcho({ ...hit, pick: null }, echo)).toBeNull();
    expect(foldHoverEcho(null, echo)).toBeNull();
    const bend = index.creasePattern.segments.find((segment) => segment.segment === 'bend')!;
    expect(foldHoverEcho({ ...hit, pick: bend }, echo)).toBeNull();
  });
});
