/**
 * The flat figure's scene, against the kernel's own paper scenes.
 *
 * The real fixtures are folded by the wasm kernel in this process — the same
 * `folded_figure_fold` and `folded_figure_paper_scene` the worker calls — so
 * what the producer is tested on is what it gets in the app: the drawer's
 * subfaces and stacks for the Oriedita solution sample and the kabuto, front
 * and back. Both stack acyclically. Oriedita's own `glitch.cp` test pattern
 * does not: seen from the back, a cycle of thirty-odd faces is on top of
 * nearly every subface, so most of what shows is woven. The woven case is
 * hand-built in the kernel's shape as well, small enough to name every patch:
 * four strips each over the next and the last over the first, beside two
 * faces that stack plainly.
 *
 * The parity gate is the one the 3D scene's tests use: paint the scene in
 * painter's order with nothing else, and read back, inside every subface, the
 * face that came out on top. It must be the face the oracle-checked drawer
 * paints there — the kernel's `faces_top_to_bottom[0]` — whether the face was
 * drawn whole or patched. No line on top of its subface may be left
 * half-covered: a later fill along it, with nothing after that drawing the
 * line again, paints over the outer half of its stroke. And no ink may show
 * that the drawer's picture does not have: a buried edge's stroke, or a
 * buried corner's rounded join, left uncovered by an order that draws a woven
 * face whole after the face that covers it.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  OristudioCpFoldedFigureResult,
  OristudioCpFoldedPaperEdgeKind,
  OristudioCpFoldedPaperFace,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldedPaperSubface,
} from '../../engine/oristudioCpTypes';
import { initCpWasm } from '../../engine/oristudioCpTestSupport';
import {
  folded_figure_fold,
  folded_figure_paper_scene,
  folded_figure_set_model,
  free_document,
  free_folded_figure,
  load_cp,
  load_fold_file,
} from '../../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import type { Point } from '../../lib/geometry';
import type {
  PaperFaceItem,
  PaperItem,
  PaperLineItem,
  PaperScene,
  ScenePoint,
} from '../../lib/paper/paperScene';
import { erodeLine, faceOutlineLines } from '../../lib/paper/paperSvg';
import { faceComponents, foldedFlatPaperScene, wovenDrawOrder } from './foldedFlatScene';

const FIXTURES = resolve(process.cwd(), '../../tests/fixtures');
const ORIEDITA_TEST_RESOURCES = resolve(
  process.cwd(),
  '../../third_party/oriedita/oriedita-data/src/test/resources'
);

/* --------------------------------------------------------------------------
 * Fixtures
 * ----------------------------------------------------------------------- */

interface KernelFixture {
  name: string;
  scene: OristudioCpFoldedPaperScene;
}

/** The kernel's scenes for a document, front and back. */
function foldThroughKernel(name: string, load: () => number): KernelFixture[] {
  const document = load();
  const result = folded_figure_fold(document, 1, 'Order5', undefined, 0) as OristudioCpFoldedFigureResult;
  const front = folded_figure_paper_scene(result.handle) as OristudioCpFoldedPaperScene | null;
  folded_figure_set_model(result.handle, { ...result.snapshot.model, state: 'Back1' });
  const back = folded_figure_paper_scene(result.handle) as OristudioCpFoldedPaperScene | null;
  free_folded_figure(result.handle);
  free_document(document);
  if (!front || !back) throw new Error(`${name}: the kernel drew nothing`);
  return [
    { name: `${name} front`, scene: front },
    { name: `${name} back`, scene: back },
  ];
}

let folded: KernelFixture[] = [];
let glitch: KernelFixture[] = [];

beforeAll(async () => {
  await initCpWasm();
  folded = [
    ...foldThroughKernel('solution sample', () =>
      load_cp(readFileSync(resolve(FIXTURES, 'oriedita/solution_sample_1.cp'), 'utf8'), 'sample')
    ),
    ...foldThroughKernel('kabuto', () =>
      load_fold_file(readFileSync(resolve(FIXTURES, 'flat-folder/kabuto.fold'), 'utf8'))
    ),
  ];
  glitch = foldThroughKernel('glitch', () =>
    load_cp(readFileSync(resolve(ORIEDITA_TEST_RESOURCES, 'glitch.cp'), 'utf8'), 'glitch')
  );
});

/** The four kernel scenes, or a failure: no test here may pass on an empty list. */
function real(): KernelFixture[] {
  expect(folded).toHaveLength(4);
  return folded;
}

/** `glitch.cp` front and back: a real fold whose stacks are cyclic. */
function cyclic(): KernelFixture[] {
  expect(glitch).toHaveLength(2);
  return glitch;
}

const point = (x: number, y: number): Point => ({ x, y });

/**
 * An axis-aligned rectangle as a kernel face: four border edges, or one fold;
 * its corners are sheet vertices `first` to `first + 3`.
 */
function rectangle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  first: number,
  frontUp = true,
  foldEdge: number | null = null
): OristudioCpFoldedPaperFace {
  const outline = [point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)];
  return {
    outline,
    points: outline.map((_, i) => first + i),
    front_up: frontUp,
    edges: outline.map((from, i) => ({
      from,
      to: outline[(i + 1) % 4]!,
      kind: (i === foldEdge ? 'fold' : 'border') as OristudioCpFoldedPaperEdgeKind,
    })),
  };
}

function subface(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stack: number[]
): OristudioCpFoldedPaperSubface {
  return {
    polygon: [point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)],
    faces_top_to_bottom: stack,
  };
}

/** Faces of the hand-built weave. */
const H1 = 0;
const V1 = 1;
const H2 = 2;
const V2 = 3;
const E = 4;
const F = 5;
const WOVEN = [H1, V1, H2, V2];

/**
 * Two horizontal strips and two vertical ones, woven: H1 over V1, V1 over H2,
 * H2 over V2, V2 over H1 — a cycle no whole-face order draws. Beside them F
 * over E, E entirely under F, which is the acyclic pair and the buried face.
 * The subfaces are the planar arrangement of the six rectangles.
 */
function wovenScene(): OristudioCpFoldedPaperScene {
  const faces: OristudioCpFoldedPaperFace[] = [];
  faces[H1] = rectangle(0, 1, 5, 2, 0, true, 0);
  faces[V1] = rectangle(1, 0, 2, 5, 4, false, 1);
  faces[H2] = rectangle(0, 3, 5, 4, 8);
  faces[V2] = rectangle(3, 0, 4, 5, 12);
  faces[E] = rectangle(6, 0, 7, 1, 16);
  faces[F] = rectangle(6, 0, 7, 2, 20, false);
  const subfaces: OristudioCpFoldedPaperSubface[] = [
    // H1 across, left to right.
    subface(0, 1, 1, 2, [H1]),
    subface(1, 1, 2, 2, [H1, V1]),
    subface(2, 1, 3, 2, [H1]),
    subface(3, 1, 4, 2, [V2, H1]),
    subface(4, 1, 5, 2, [H1]),
    // H2 across.
    subface(0, 3, 1, 4, [H2]),
    subface(1, 3, 2, 4, [V1, H2]),
    subface(2, 3, 3, 4, [H2]),
    subface(3, 3, 4, 4, [H2, V2]),
    subface(4, 3, 5, 4, [H2]),
    // The verticals' own pieces.
    subface(1, 0, 2, 1, [V1]),
    subface(1, 2, 2, 3, [V1]),
    subface(1, 4, 2, 5, [V1]),
    subface(3, 0, 4, 1, [V2]),
    subface(3, 2, 4, 3, [V2]),
    subface(3, 4, 4, 5, [V2]),
    // F over E, and F's own piece.
    subface(6, 0, 7, 1, [F, E]),
    subface(6, 1, 7, 2, [F]),
  ];
  return { schema_version: 2, flipped: false, sheet: 7, faces, subfaces, aux_lines: [] };
}

/* --------------------------------------------------------------------------
 * Reading a scene
 * ----------------------------------------------------------------------- */

const identity = (p: Point): ScenePoint => [p.x, p.y];

function sceneOf(kernel: OristudioCpFoldedPaperScene, markHidden = true): PaperScene {
  return foldedFlatPaperScene(kernel, { markHidden, toScenePx: identity, scale: 1 });
}

const faceItems = (scene: PaperScene): PaperFaceItem[] =>
  scene.items.filter((item): item is PaperFaceItem => item.kind === 'face');
const lineItems = (scene: PaperScene): PaperLineItem[] =>
  scene.items.filter((item): item is PaperLineItem => item.kind === 'line');

/**
 * The scene's items as they are drawn: a face that draws its own outline is
 * followed by the lines that outline stands for, as the painter strokes them
 * over its fill.
 */
const drawn = (items: readonly PaperItem[]): PaperItem[] =>
  items.flatMap<PaperItem>((item) =>
    item.kind === 'face' ? [item, ...faceOutlineLines(item)] : [item]
  );

/** The lines that follow each face item, up to the next face item. */
function linesAfterEachFace(scene: PaperScene): Map<number, PaperLineItem[]> {
  const after = new Map<number, PaperLineItem[]>();
  let current: PaperLineItem[] | null = null;
  scene.items.forEach((item, index) => {
    if (item.kind === 'face') {
      current = [];
      after.set(index, current);
    } else if (current && item.kind === 'line') {
      current.push(item);
    }
  });
  return after;
}

/** The faces the drawer paints somewhere: the top of at least one stack. */
function visibleFaces(kernel: OristudioCpFoldedPaperScene): Set<number> {
  return new Set(kernel.subfaces.map((s) => s.faces_top_to_bottom[0]!));
}

const ring = (points: readonly Point[]): ScenePoint[] => points.map(identity);

/**
 * In every subface, what the stack says is over must be drawn after what it
 * says is under. A face's item there is the whole face, or an item with that
 * subface's polygon among its rings; either way there is exactly one.
 */
function expectStacksInPainterOrder(kernel: OristudioCpFoldedPaperScene, scene: PaperScene): void {
  const key = (r: readonly ScenePoint[]) => JSON.stringify(r);
  const at = new Map<string, number>();
  scene.items.forEach((item, index) => {
    if (item.kind !== 'face') return;
    for (const r of item.rings) at.set(`${item.face}:${key(r)}`, index);
  });
  const indexOf = (face: number, polygon: readonly Point[], subface: number): number => {
    const index =
      at.get(`${face}:${key(ring(kernel.faces[face]!.outline))}`) ??
      at.get(`${face}:${key(ring(polygon))}`);
    expect(index, `subface ${subface}: face ${face} is not drawn there`).toBeDefined();
    return index!;
  };
  kernel.subfaces.forEach(({ polygon, faces_top_to_bottom: stack }, subface) => {
    for (let i = 0; i + 1 < stack.length; i += 1) {
      const over = indexOf(stack[i]!, polygon, subface);
      const under = indexOf(stack[i + 1]!, polygon, subface);
      expect(over, `subface ${subface}: face ${stack[i]} must be drawn after face ${stack[i + 1]}`).toBeGreaterThan(under);
    }
  });
}

/* --------------------------------------------------------------------------
 * Half-covered lines
 * ----------------------------------------------------------------------- */

const ALONG = 1e-6;

/**
 * The stretch of `a`→`b`, as parameters along it, that the segment `p`→`q`
 * lies along; null when it lies along none of it.
 */
function alongSpan(a: ScenePoint, b: ScenePoint, p: ScenePoint, q: ScenePoint): [number, number] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (!(length > ALONG)) return null;
  const off = ([x, y]: ScenePoint) => Math.abs(dx * (y - a[1]) - dy * (x - a[0])) / length;
  if (off(p) > ALONG || off(q) > ALONG) return null;
  const t = ([x, y]: ScenePoint) => ((x - a[0]) * dx + (y - a[1]) * dy) / (length * length);
  const t0 = Math.max(0, Math.min(t(p), t(q)));
  const t1 = Math.min(1, Math.max(t(p), t(q)));
  return (t1 - t0) * length > ALONG ? [t0, t1] : null;
}

/** Even-odd containment in a face item's rings, as the painter fills them. */
function insideRings(rings: ReadonlyArray<ReadonlyArray<ScenePoint>>, [x, y]: ScenePoint): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i, i += 1) {
      const [xi, yi] = r[i]!;
      const [xj, yj] = r[j]!;
      if (yi > y !== yj > y && x < xi + ((y - yi) / (yj - yi)) * (xj - xi)) inside = !inside;
    }
  }
  return inside;
}

/**
 * Where a line is left half as wide: painted over on one side of the line but
 * not the other, by a fill after the last line drawn along that stretch. The
 * fill and its seam cover that half of the stroke. Painted over on both sides
 * the stretch is buried, which is right where its face does not show; on
 * neither side it shows whole. Sampled along each line, a hair to either side,
 * against every fill drawn after it; the samples sit off round fractions, so
 * none lands where another face's edge crosses the line, where the two hairs
 * would straddle that edge instead of this one.
 *
 * With `dropHidden`, the page that leaves buried items out.
 */
function halfCoveredLines(scene: PaperScene, dropHidden = false): string[] {
  const items = drawn(dropHidden ? scene.items.filter((item) => !item.hidden) : scene.items);
  const boxes = items.map((item) => {
    if (item.kind !== 'face') return null;
    const points = item.rings.flat();
    return {
      minX: Math.min(...points.map((p) => p[0])),
      maxX: Math.max(...points.map((p) => p[0])),
      minY: Math.min(...points.map((p) => p[1])),
      maxY: Math.max(...points.map((p) => p[1])),
    };
  });
  const hair = 1e-5 * Math.max(1, scene.sheet);
  const found: string[] = [];
  items.forEach((line, i) => {
    if (line.kind !== 'line') return;
    const [ax, ay] = line.a;
    const [bx, by] = line.b;
    const length = Math.hypot(bx - ax, by - ay);
    if (!(length > ALONG)) return;
    const nx = (-(by - ay) / length) * hair;
    const ny = ((bx - ax) / length) * hair;
    for (let sample = 0; sample < 16; sample += 1) {
      const t = (sample + 0.5 + 0.0417) / 16.1;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      // The last time a line was drawn through this point, from this one on.
      let drawn = i;
      for (let k = i + 1; k < items.length; k += 1) {
        const later = items[k]!;
        if (later.kind !== 'line') continue;
        const through = alongSpan(line.a, line.b, later.a, later.b);
        if (through !== null && through[0] <= t && t <= through[1]) drawn = k;
      }
      const paintedOver = (px: number, py: number): boolean => {
        for (let k = drawn + 1; k < items.length; k += 1) {
          const cover = items[k]!;
          const box = boxes[k];
          if (cover.kind !== 'face' || !box) continue;
          if (px < box.minX || px > box.maxX || py < box.minY || py > box.maxY) continue;
          if (insideRings(cover.rings, [px, py])) return true;
        }
        return false;
      };
      if (paintedOver(x + nx, y + ny) !== paintedOver(x - nx, y - ny)) {
        found.push(`face ${line.face} line ${line.a}→${line.b} at t ${t}`);
        return;
      }
    }
  });
  return found;
}

/**
 * In every subface, the last fill that covers it is its top face's: the face
 * drawn whole after every other face of the stack, or a patch of it, cut to
 * the subface, after them.
 */
function expectTopsDrawnLast(kernel: OristudioCpFoldedPaperScene, scene: PaperScene): void {
  kernel.subfaces.forEach(({ polygon, faces_top_to_bottom: stack }, subface) => {
    let last: number | undefined;
    for (const item of scene.items) {
      if (item.kind !== 'face' || !stack.includes(item.face)) continue;
      const patch = item.group !== undefined;
      if (!patch || JSON.stringify(item.rings[0]) === JSON.stringify(ring(polygon))) last = item.face;
    }
    expect(last, `subface ${subface}`).toBe(stack[0]);
  });
}

/* --------------------------------------------------------------------------
 * Ink that shows where the drawer's picture has none
 * ----------------------------------------------------------------------- */

/** The subface a point lies in, or -1 off the figure. */
function subfaceAt(kernel: OristudioCpFoldedPaperScene, point: ScenePoint): number {
  return kernel.subfaces.findIndex(({ polygon }) => insideRings([ring(polygon)], point));
}

/** Whether a face has an edge through a point. */
function edgeThrough(kernel: OristudioCpFoldedPaperScene, face: number, [x, y]: ScenePoint): boolean {
  return kernel.faces[face]!.edges.some(({ from, to }) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const t = ((x - from.x) * dx + (y - from.y) * dy) / (length * length);
    return t >= -ALONG && t <= 1 + ALONG && Math.abs(dx * (y - from.y) - dy * (x - from.x)) / length <= ALONG;
  });
}

/**
 * Where ink shows that the drawer's picture has none, or a line it has is
 * gone. Along every edge line drawn — a face's outline as the lines it stands
 * for, and every line item — a hair to either side: where the top face on
 * either side runs along it, the line is on the page and must be painted over
 * on neither side; where not, it is buried and must be painted over on both,
 * by fills drawn after the last line through that point. And at every corner
 * of a face drawn whole where no line is on the page: the directions behind
 * both of its edges, which its rounded join inks, must be painted over by a
 * fill drawn after it. Aux lines are left out; their own tests place them.
 */
function inkThatShows(kernel: OristudioCpFoldedPaperScene, scene: PaperScene): string[] {
  const items = drawn(scene.items);
  const hair = 1e-5 * Math.max(1, scene.sheet);
  const coveredAfter = (index: number, point: ScenePoint): boolean =>
    items.some((item, k) => k > index && item.kind === 'face' && insideRings(item.rings, point));
  const topAt = (point: ScenePoint): number | undefined => {
    const subface = subfaceAt(kernel, point);
    return subface < 0 ? undefined : kernel.subfaces[subface]!.faces_top_to_bottom[0];
  };
  const found: string[] = [];
  items.forEach((line, i) => {
    if (line.kind !== 'line' || line.role !== 'edge') return;
    const [ax, ay] = line.a;
    const [bx, by] = line.b;
    const length = Math.hypot(bx - ax, by - ay);
    if (!(length > ALONG)) return;
    const nx = (-(by - ay) / length) * hair;
    const ny = ((bx - ax) / length) * hair;
    for (let sample = 0; sample < 16; sample += 1) {
      const t = (sample + 0.5 + 0.0417) / 16.1;
      const at: ScenePoint = [ax + (bx - ax) * t, ay + (by - ay) * t];
      let last = i;
      for (let k = i + 1; k < items.length; k += 1) {
        const later = items[k]!;
        if (later.kind !== 'line') continue;
        const through = alongSpan(line.a, line.b, later.a, later.b);
        if (through !== null && through[0] <= t && t <= through[1]) last = k;
      }
      const sides: ScenePoint[] = [[at[0] + nx, at[1] + ny], [at[0] - nx, at[1] - ny]];
      const onPage = sides.some((side) => {
        const top = topAt(side);
        return top !== undefined && edgeThrough(kernel, top, at);
      });
      const covered = sides.map((side) => coveredAfter(last, side));
      if (onPage && covered.some(Boolean)) {
        found.push(`line ${line.a}→${line.b} of face ${line.face} is painted over at t ${t}`);
        return;
      }
      if (!onPage && !covered.every(Boolean)) {
        found.push(`buried line ${line.a}→${line.b} of face ${line.face} shows at t ${t}`);
        return;
      }
    }
  });
  const reach = 20 * hair;
  items.forEach((item, i) => {
    if (item.kind !== 'face' || !item.outline) return;
    const outline = item.rings[0]!;
    outline.forEach((v, c) => {
      const around = Array.from({ length: 12 }, (_, k): ScenePoint => [
        v[0] + reach * Math.cos((k * Math.PI) / 6 + 0.1),
        v[1] + reach * Math.sin((k * Math.PI) / 6 + 0.1),
      ]);
      const tops = new Set(around.map(topAt));
      const lineAtVertex =
        tops.size > 1 || [...tops].some((top) => top !== undefined && edgeThrough(kernel, top, v));
      if (lineAtVertex) return;
      const unit = ([x, y]: ScenePoint): ScenePoint => {
        const length = Math.hypot(x - v[0], y - v[1]);
        return [(x - v[0]) / length, (y - v[1]) / length];
      };
      const back = unit(outline[(c + outline.length - 1) % outline.length]!);
      const ahead = unit(outline[(c + 1) % outline.length]!);
      for (const [dx, dy] of around.map(unit)) {
        if (dx * back[0] + dy * back[1] >= 0 || dx * ahead[0] + dy * ahead[1] >= 0) continue;
        const behind: ScenePoint = [v[0] + dx * reach, v[1] + dy * reach];
        if (!coveredAfter(i, behind)) {
          found.push(`corner ${v} of face ${item.face} shows behind its edges`);
          return;
        }
      }
    });
  });
  return found;
}

/* --------------------------------------------------------------------------
 * The rasterised gate
 * ----------------------------------------------------------------------- */

const SIZE = 400;

/** Even-odd scanline fill: the face id at each pixel, `-1` for none. */
function paint(scene: PaperScene, place: (p: ScenePoint) => ScenePoint): Int32Array {
  const ids = new Int32Array(SIZE * SIZE).fill(-1);
  for (const item of scene.items) {
    if (item.kind !== 'face') continue;
    fill(ids, item.rings.map((r) => r.map(place)), item.face);
  }
  return ids;
}

function fill(
  ids: Int32Array,
  rings: ReadonlyArray<ReadonlyArray<ScenePoint>>,
  id: number
): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rings) for (const [, y] of r) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const crossings: number[] = [];
  const rowStart = Math.max(0, Math.ceil(minY - 0.5));
  const rowEnd = Math.min(SIZE - 1, Math.floor(maxY - 0.5));
  for (let row = rowStart; row <= rowEnd; row += 1) {
    const y = row + 0.5;
    crossings.length = 0;
    for (const r of rings) {
      for (let i = 0; i < r.length; i += 1) {
        const [x1, y1] = r[i]!;
        const [x2, y2] = r[(i + 1) % r.length]!;
        if (y1 <= y === y2 <= y) continue;
        crossings.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    crossings.sort((l, r) => l - r);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const first = Math.max(0, Math.ceil(crossings[i]! - 0.5));
      const last = Math.min(SIZE - 1, Math.floor(crossings[i + 1]! - 0.5));
      for (let col = first; col <= last; col += 1) ids[row * SIZE + col] = id;
    }
  }
}

/**
 * Paint the scene and, inside every subface — a pixel in from its boundary,
 * where two rasterisations of the same edge could disagree — read back the
 * face on top. Returns the subfaces whose top is not the kernel's, and how
 * many subfaces were sampled at all.
 */
function topFaceDisagreements(
  kernel: OristudioCpFoldedPaperScene,
  scene: PaperScene
): { wrong: string[]; sampled: number } {
  const { bounds } = scene;
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) || 1;
  const s = (SIZE - 2) / extent;
  const place = ([x, y]: ScenePoint): ScenePoint => [
    (x - bounds.minX) * s + 1,
    (y - bounds.minY) * s + 1,
  ];
  const page = paint(scene, place);
  const wrong: string[] = [];
  let sampled = 0;
  kernel.subfaces.forEach(({ polygon, faces_top_to_bottom: stack }, index) => {
    const mask = new Int32Array(SIZE * SIZE).fill(-1);
    fill(mask, [ring(polygon).map(place)], 1);
    let inside = 0;
    const seen = new Set<number>();
    for (let y = 1; y < SIZE - 1; y += 1) {
      for (let x = 1; x < SIZE - 1; x += 1) {
        const at = y * SIZE + x;
        if (mask[at] !== 1) continue;
        // Interior only: every 8-neighbour in the subface too.
        let interior = true;
        for (let oy = -1; oy <= 1 && interior; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (mask[at + oy * SIZE + ox] !== 1) {
              interior = false;
              break;
            }
          }
        }
        if (!interior) continue;
        inside += 1;
        seen.add(page[at]!);
      }
    }
    if (inside === 0) return;
    sampled += 1;
    if (seen.size !== 1 || !seen.has(stack[0]!)) {
      wrong.push(`subface ${index}: expected face ${stack[0]}, painted ${[...seen].join(',')}`);
    }
  });
  return { wrong, sampled };
}

/* --------------------------------------------------------------------------
 * Tests
 * ----------------------------------------------------------------------- */

describe('an acyclic stacking', () => {
  it('folds the real fixtures to stacks with no cycle', () => {
    for (const { name, scene } of real()) {
      const components = faceComponents(scene.faces.length, scene.subfaces);
      expect(components.every((c) => c.length === 1), name).toBe(true);
      expect(components.length, name).toBe(scene.faces.length);
    }
  });

  it('draws every face once, whole, its outline drawn by the face itself', () => {
    for (const { name, scene: kernel } of real()) {
      const scene = sceneOf(kernel);
      const faces = faceItems(scene);
      expect(faces.map((f) => f.face).sort((a, b) => a - b), name).toEqual(
        kernel.faces.map((_, i) => i)
      );
      for (const item of faces) {
        const source = kernel.faces[item.face]!;
        expect(item.rings, `${name} face ${item.face}`).toEqual([ring(source.outline)]);
        expect(item.side).toBe(source.front_up ? 'front' : 'back');
        expect(item.shade).toBe(1);
        // Border and fold alike are the paper's edge, so the face strokes
        // its whole outline in that pen, and no line repeats an edge of it.
        expect(item.outline, `${name} face ${item.face}`).toBe('edge');
        const lines = faceOutlineLines(item);
        expect(lines.length, `${name} face ${item.face} lines`).toBe(source.edges.length);
        lines.forEach((line, i) => {
          const edge = source.edges[i]!;
          expect(edge.kind).not.toBe('flat');
          expect(line.a).toEqual(identity(edge.from));
          expect(line.b).toEqual(identity(edge.to));
          expect(line.face).toBe(item.face);
          expect(line.hidden).toBe(item.hidden);
          // A paper edge or a fold is the outline and never retreats.
          expect(line.onBoundary).toEqual([false, false]);
        });
      }
      expect(lineItems(scene).filter((line) => line.role !== 'aux'), name).toEqual([]);
    }
  });

  it('orders the faces so every stack reads bottom to top', () => {
    for (const { scene: kernel } of real()) {
      expectStacksInPainterOrder(kernel, sceneOf(kernel));
    }
  });

  it('leaves no line on top half-covered', () => {
    for (const { name, scene: kernel } of real()) {
      const scene = sceneOf(kernel);
      expect(halfCoveredLines(scene), name).toEqual([]);
      expect(halfCoveredLines(scene, true), name).toEqual([]);
    }
  });

  it('leaves no buried ink showing and no line missing, with no patch', () => {
    for (const { name, scene: kernel } of real()) {
      const scene = sceneOf(kernel);
      expect(inkThatShows(kernel, scene), name).toEqual([]);
      expect(scene.items.some((item) => item.kind !== 'markup' && item.group !== undefined), name).toBe(false);
    }
  });

  it('marks hidden exactly the faces on top of no subface, and keeps them', () => {
    for (const { name, scene: kernel } of real()) {
      const visible = visibleFaces(kernel);
      const marked = sceneOf(kernel);
      for (const item of faceItems(marked)) {
        expect(item.hidden, `${name} face ${item.face}`).toBe(!visible.has(item.face));
      }
      // Not vacuous: both figures bury whole faces.
      expect(faceItems(marked).some((f) => f.hidden), name).toBe(true);
      expect(faceItems(marked).some((f) => !f.hidden), name).toBe(true);
      const kept = sceneOf(kernel, false);
      expect(kept.items.length).toBe(marked.items.length);
      expect(kept.items.every((item) => !item.hidden), name).toBe(true);
    }
  });

  it('maps every point through toScenePx and the sheet through scale', () => {
    const kernel = real()[0]!.scene;
    const scene = foldedFlatPaperScene(kernel, {
      markHidden: false,
      toScenePx: (p) => [p.x * 2 + 10, p.y * 2 + 20],
      scale: 2,
    });
    expect(scene.sheet).toBe(kernel.sheet * 2);
    const first = faceItems(scene)[0]!;
    const source = kernel.faces[first.face]!;
    expect(first.rings[0]![0]).toEqual([source.outline[0]!.x * 2 + 10, source.outline[0]!.y * 2 + 20]);
    expect(scene.bounds.minX).toBeGreaterThanOrEqual(
      Math.min(...kernel.faces.flatMap((f) => f.outline.map((p) => p.x * 2 + 10)))
    );
  });

  it('draws nothing for a kernel scene with no faces', () => {
    const scene = sceneOf({ schema_version: 2, flipped: false, sheet: 0, faces: [], subfaces: [], aux_lines: [] });
    expect(scene.items).toEqual([]);
    expect(scene.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    expect(scene.sheet).toBe(0);
  });
});

describe('a woven stacking', () => {
  it('finds the cycle and nothing else', () => {
    const kernel = wovenScene();
    const components = faceComponents(kernel.faces.length, kernel.subfaces);
    expect(components.filter((c) => c.length > 1)).toEqual([WOVEN]);
    expect(components.length).toBe(3);
  });

  it('draws every face once, whole, the cycle’s too, each drawing its own outline', () => {
    const kernel = wovenScene();
    const whole = faceItems(sceneOf(kernel)).filter((face) => face.group === undefined);
    expect(whole.map((face) => face.face).sort((a, b) => a - b)).toEqual([H1, V1, H2, V2, E, F]);
    for (const face of whole) {
      expect(face.rings, `face ${face.face}`).toEqual([ring(kernel.faces[face.face]!.outline)]);
      expect(face.outline).toBe('edge');
    }
  });

  it('breaks the cycle once and patches what that leaves wrong, right after the last face it covers', () => {
    const kernel = wovenScene();
    const scene = sceneOf(kernel);
    // Drawn bottom to top as V2, H2, V1, H1: each over the one before, except
    // that H1 now covers V2 where V2 should be on top.
    const whole = faceItems(scene).filter((face) => face.group === undefined);
    expect(whole.slice(0, 4).map((face) => face.face)).toEqual([V2, H2, V1, H1]);
    // So V2 goes in again over that crossing (subface 3), and over the strips
    // of it either side (13 and 14), where H1's outline, drawn whole, would
    // show its half across V2.
    const patches = faceItems(scene).filter((face) => face.group !== undefined);
    expect(patches.map((patch) => [patch.face, patch.rings])).toEqual(
      [3, 13, 14].map((subface) => [V2, [ring(kernel.subfaces[subface]!.polygon)]])
    );
    for (const patch of patches) {
      expect(patch.hidden).toBe(false);
      expect(patch.outline).toBeUndefined();
      expect(patch.side).toBe(kernel.faces[V2]!.front_up ? 'front' : 'back');
    }
    // Right after H1, the last face they cover, and before E and F.
    const h1 = scene.items.indexOf(whole[3]!);
    expect(scene.items.indexOf(patches[0]!)).toBe(h1 + 1);
    expect(scene.items.indexOf(whole[4]!)).toBeGreaterThan(scene.items.indexOf(patches[2]!));
  });

  it('carries the lines its patches cover that no face drawn later draws again', () => {
    const scene = sceneOf(wovenScene());
    const carried = lineItems(scene).filter((line) => line.group !== undefined);
    const span = (line: PaperLineItem) => JSON.stringify([line.a, line.b].sort());
    // V2's sides along the patches and its end at the top, and the stretches
    // of H1's and H2's edges that end at a patch's corner — each line the
    // patches' paint reaches that shows on the page. H1's own edges across V2
    // are buried there, and are not.
    const expected: Array<[ScenePoint, ScenePoint, number]> = [
      [[3, 0], [3, 1], V2], [[3, 1], [3, 2], V2], [[3, 2], [3, 3], V2],
      [[4, 0], [4, 1], V2], [[4, 1], [4, 2], V2], [[4, 2], [4, 3], V2],
      [[3, 0], [4, 0], V2],
      [[2, 1], [3, 1], H1], [[4, 1], [5, 1], H1], [[2, 2], [3, 2], H1], [[4, 2], [5, 2], H1],
      [[2, 3], [3, 3], H2], [[3, 3], [4, 3], H2], [[4, 3], [5, 3], H2],
    ];
    expect(carried.map((line) => [span(line), line.face]).sort()).toEqual(
      expected.map(([a, b, face]) => [JSON.stringify([a, b].sort()), face]).sort()
    );
    for (const line of carried) {
      expect(line.role).toBe('edge');
      expect(line.hidden).toBe(false);
      // Round at both ends, so the stretches meet whole round a patch's corner.
      expect(line.joined).toEqual([true, true]);
    }
    // After every patch of the batch.
    const lastPatch = Math.max(
      ...faceItems(scene).filter((face) => face.group !== undefined).map((face) => scene.items.indexOf(face))
    );
    expect(Math.min(...carried.map((line) => scene.items.indexOf(line)))).toBeGreaterThan(lastPatch);
  });

  it('writes a batch of patches, and what it carries, as one group', () => {
    const scene = sceneOf(wovenScene());
    const grouped = scene.items.flatMap((item, index) =>
      item.kind !== 'markup' && item.group !== undefined ? [[index, item.group] as const] : []
    );
    expect(grouped.length).toBeGreaterThan(3);
    expect(new Set(grouped.map(([, group]) => group))).toEqual(new Set(['patches-1']));
    // One run, so the painter writes one <g>.
    grouped.forEach(([index], k) => expect(index).toBe(grouped[0]![0] + k));
  });

  it('carries the patched face’s aux line inside its patches, under their edges, eroded on the whole crease', () => {
    const kernel = wovenScene();
    // Down the middle of V2, end to end: drawn with V2, then covered by H1
    // and its outline from y = 0 to y = 3.
    kernel.aux_lines.push({ from: point(3.5, 0), to: point(3.5, 5), face: V2 });
    const scene = sceneOf(kernel);
    const aux = lineItems(scene).filter((line) => line.role === 'aux');
    expect(aux.filter((line) => line.group === undefined)).toEqual([
      expect.objectContaining({ a: [3.5, 0], b: [3.5, 5], face: V2, hidden: false }),
    ]);
    // One stretch per patch, in the batch's order: the crossing, then the
    // strips above and below it.
    const carried = aux.filter((line) => line.group === 'patches-1');
    expect(carried.map((line) => [line.a, line.b])).toEqual([
      [[3.5, 1], [3.5, 2]],
      [[3.5, 0], [3.5, 1]],
      [[3.5, 2], [3.5, 3]],
    ]);
    for (const stretch of carried) {
      expect(stretch.hidden).toBe(false);
      expect(stretch.whole).toEqual({ a: [3.5, 0], b: [3.5, 5], onBoundary: [true, true] });
    }
    // The stretch at the crease's own end retreats with it, by the whole
    // crease's pull; a stretch in the middle keeps its length.
    expect(erodeLine(carried[1]!, 0.3)).toEqual([[3.5, 0.3], [3.5, 1]]);
    expect(erodeLine(carried[0]!, 0.3)).toEqual([[3.5, 1], [3.5, 2]]);
    const firstEdge = scene.items.findIndex(
      (item) => item.kind === 'line' && item.role === 'edge' && item.group === 'patches-1'
    );
    for (const stretch of carried) expect(scene.items.indexOf(stretch)).toBeLessThan(firstEdge);
  });

  it('leaves no line on top half-covered, whether or not buried items are kept', () => {
    const scene = sceneOf(wovenScene());
    expect(halfCoveredLines(scene)).toEqual([]);
    expect(halfCoveredLines(scene, true)).toEqual([]);
  });

  it('leaves no buried ink showing and no line missing — and says so when the patches are gone', () => {
    const kernel = wovenScene();
    const scene = sceneOf(kernel);
    expect(inkThatShows(kernel, scene)).toEqual([]);
    expectTopsDrawnLast(kernel, scene);
    const unpatched = { ...scene, items: scene.items.filter((item) => item.kind === 'markup' || item.group === undefined) };
    expect(inkThatShows(kernel, unpatched).length).toBeGreaterThan(0);
  });

  it('keeps a line per edge after a whole face whose outline mixes roles, a flat edge as aux', () => {
    const kernel = wovenScene();
    kernel.faces[F]!.edges[2]!.kind = 'flat';
    const scene = sceneOf(kernel);
    const fIndex = scene.items.findIndex((item) => item.kind === 'face' && item.face === F);
    expect(scene.items[fIndex]).not.toHaveProperty('outline');
    const lines = linesAfterEachFace(scene).get(fIndex)!;
    expect(lines.map((l) => l.role)).toEqual(['edge', 'edge', 'aux', 'edge']);
    // The flat edge meets a border at both ends, so both retreat under erode.
    expect(lines[2]!.onBoundary).toEqual([true, true]);
  });
});

describe('a real cyclic stacking', () => {
  it('folds glitch.cp to a cycle that shows from the back', () => {
    const [front, back] = cyclic();
    for (const { name, scene } of [front!, back!]) {
      const components = faceComponents(scene.faces.length, scene.subfaces);
      expect(components.some((c) => c.length > 1), name).toBe(true);
    }
    // Not vacuous: from the back the cycle is on top of most subfaces, so most
    // of the picture is woven.
    const { scene } = back!;
    const inCycle = new Set(
      faceComponents(scene.faces.length, scene.subfaces).filter((c) => c.length > 1).flat()
    );
    const toppedByCycle = scene.subfaces.filter((s) => inCycle.has(s.faces_top_to_bottom[0]!));
    expect(toppedByCycle.length).toBeGreaterThan(scene.subfaces.length / 2);
  });

  it('draws every face whole, and each subface’s top face last there', () => {
    for (const { name, scene: kernel } of cyclic()) {
      const scene = sceneOf(kernel);
      const whole = faceItems(scene).filter((face) => face.group === undefined);
      expect(whole.map((face) => face.face).sort((a, b) => a - b), name).toEqual(
        kernel.faces.map((_, i) => i)
      );
      expect(whole.every((face) => face.outline === 'edge'), name).toBe(true);
      expectTopsDrawnLast(kernel, scene);
    }
    // Not vacuous: the back is woven enough to need patches, in groups.
    const back = sceneOf(cyclic()[1]!.scene);
    expect(faceItems(back).some((face) => face.group !== undefined)).toBe(true);
  });

  it('draws in the same order when nothing is marked hidden, as the crease-pattern export asks', () => {
    for (const kernel of [wovenScene(), ...cyclic().map((f) => f.scene)]) {
      const marked = sceneOf(kernel);
      const unmarked = sceneOf(kernel, false);
      expect(unmarked.items.every((item) => !item.hidden)).toBe(true);
      expect(unmarked.items).toEqual(marked.items.map((item) => ({ ...item, hidden: false })));
    }
  });

  it('leaves no line on top half-covered, whether or not buried items are kept', () => {
    for (const { name, scene: kernel } of cyclic()) {
      const scene = sceneOf(kernel);
      // Not vacuous: lines show, whether a piece's or a whole face's outline.
      expect(drawn(scene.items).some((item) => item.kind === 'line' && !item.hidden), name).toBe(true);
      expect(halfCoveredLines(scene), name).toEqual([]);
      expect(halfCoveredLines(scene, true), name).toEqual([]);
    }
  });

  it('leaves no buried ink showing and no line missing — and says so when the patches are gone', () => {
    for (const { name, scene: kernel } of cyclic()) {
      expect(inkThatShows(kernel, sceneOf(kernel)), name).toEqual([]);
    }
    // Without its patches, the back shows buried edges and rounded corners
    // both: the corner rule is not vacuous either.
    const { scene: back } = cyclic()[1]!;
    const scene = sceneOf(back);
    const unpatched = { ...scene, items: scene.items.filter((item) => item.kind === 'markup' || item.group === undefined) };
    const shows = inkThatShows(back, unpatched);
    expect(shows.some((what) => what.startsWith('buried line'))).toBe(true);
    expect(shows.some((what) => what.startsWith('corner'))).toBe(true);
  });
});

describe('the visible face per subface is the drawer’s', () => {
  it('for the real fixtures, front and back', () => {
    for (const { name, scene: kernel } of real()) {
      const { wrong, sampled } = topFaceDisagreements(kernel, sceneOf(kernel));
      expect(wrong, name).toEqual([]);
      // Every subface is wide enough to sample; none of the checks is vacuous.
      expect(sampled, name).toBe(kernel.subfaces.length);
    }
  });

  it('for glitch.cp, where most of the back is woven', () => {
    for (const { name, scene: kernel } of cyclic()) {
      const { wrong, sampled } = topFaceDisagreements(kernel, sceneOf(kernel));
      expect(wrong, name).toEqual([]);
      expect(sampled, name).toBeGreaterThan(0);
    }
  });

  it('for the weave, where one crossing is patched', () => {
    const kernel = wovenScene();
    const { wrong, sampled } = topFaceDisagreements(kernel, sceneOf(kernel));
    expect(wrong).toEqual([]);
    expect(sampled).toBe(kernel.subfaces.length);
  });

  it('whether or not the buried faces are marked', () => {
    for (const { name, scene: kernel } of real()) {
      expect(topFaceDisagreements(kernel, sceneOf(kernel, false)).wrong, name).toEqual([]);
    }
  });
});

describe('with no spread', () => {
  /**
   * Every path the producer emits — whole faces, a face whose outline mixes
   * roles, aux lines, patches with their aux stretches and carried lines — on
   * the real folds and the weave, marked and unmarked, as digests of the
   * scenes this producer drew before it could spread layers. Folding the
   * fixtures in a changed kernel can move these; the producer alone must not.
   */
  it('draws what it drew before layers could be spread, byte for byte', () => {
    const sink = wovenScene();
    sink.aux_lines.push({ from: point(3.5, 0), to: point(3.5, 5), face: V2 });
    sink.faces[F]!.edges[2]!.kind = 'flat';
    const kernels = [...real(), ...cyclic(), { name: 'weave', scene: sink }];
    const sha = (scene: PaperScene) => createHash('sha256').update(JSON.stringify(scene)).digest('hex').slice(0, 16);
    const digests = Object.fromEntries(
      kernels.flatMap(({ name, scene }) => [
        [name, sha(sceneOf(scene))],
        [`${name} unmarked`, sha(sceneOf(scene, false))],
      ])
    );
    expect(digests).toMatchInlineSnapshot(`
      {
        "glitch back": "e1462a666e280476",
        "glitch back unmarked": "e3d10f3fc7e404bc",
        "glitch front": "36f566d7d3d0cdb2",
        "glitch front unmarked": "0352e8584dc3c35f",
        "kabuto back": "286c4cab06abc8e6",
        "kabuto back unmarked": "07710d888e4ba38a",
        "kabuto front": "0429a8150b1c762c",
        "kabuto front unmarked": "484896db19857fd3",
        "solution sample back": "328db92af493b367",
        "solution sample back unmarked": "303af59b84376884",
        "solution sample front": "d2d39703f1eef887",
        "solution sample front unmarked": "b65c945e996674ca",
        "weave": "5acace7b39efbd83",
        "weave unmarked": "21b67eb661442c18",
      }
    `);
  });
});

describe('with a spread', () => {
  const SPREAD = { amount: 0.05, toward: 'up-left' } as const;
  const UP_LEFT: ScenePoint = [-Math.SQRT1_2, -Math.SQRT1_2];

  function spreadScene(
    kernel: OristudioCpFoldedPaperScene,
    toScenePx: (p: Point) => ScenePoint = identity,
    scale = 1
  ): PaperScene {
    return foldedFlatPaperScene(kernel, { markHidden: false, toScenePx, scale, spread: SPREAD });
  }

  /** Every point an item carries, in a fixed order. */
  const pointsOf = (item: PaperItem): ScenePoint[] =>
    item.kind === 'face'
      ? item.rings.flat()
      : item.kind === 'line'
        ? [item.a, item.b, ...(item.whole ? [item.whole.a, item.whole.b] : [])]
        : [];

  /** The items with their points taken out: what a spread must leave alone. */
  const shapeless = (items: readonly PaperItem[]) =>
    items.map((item) => {
      if (item.kind === 'face') return { ...item, rings: [] };
      if (item.kind === 'line') {
        const { whole, ...line } = item;
        return { ...line, a: null, b: null, whole: whole ? { ...whole, a: null, b: null } : undefined };
      }
      return item;
    });

  /** Per point, how far the spread moved it. */
  const steps = (before: PaperScene, after: PaperScene): ScenePoint[] =>
    before.items.flatMap((item, i) => {
      const moved = pointsOf(after.items[i]!);
      return pointsOf(item).map((p, k): ScenePoint => [moved[k]![0] - p[0], moved[k]![1] - p[1]]);
    });

  const weave = () => {
    const kernel = wovenScene();
    kernel.aux_lines.push({ from: point(3.5, 0), to: point(3.5, 5), face: V2 });
    return { name: 'weave', scene: kernel };
  };

  it('draws the same items in the same order, each point stepped up-left by at most the amount', () => {
    for (const { name, scene: kernel } of [...real(), ...cyclic(), weave()]) {
      const plain = sceneOf(kernel, false);
      const spread = spreadScene(kernel);
      expect(shapeless(spread.items), name).toEqual(shapeless(plain.items));
      const size = Math.max(
        ...['x', 'y'].map((axis) => {
          const values = kernel.faces.flatMap((f) => f.outline.map((p) => p[axis as 'x' | 'y']));
          return Math.max(...values) - Math.min(...values);
        })
      );
      const reach = SPREAD.amount * size;
      const moved = steps(plain, spread);
      for (const [dx, dy] of moved) {
        // Along the direction, and no further than the deepest layer goes.
        expect(Math.abs(dx - dy), name).toBeLessThan(1e-9 * reach);
        const along = dx * UP_LEFT[0] + dy * UP_LEFT[1];
        expect(along, name).toBeGreaterThanOrEqual(-1e-9 * reach);
        expect(along, name).toBeLessThanOrEqual(reach * (1 + 1e-9));
      }
      // Not vacuous: things moved, and by different amounts.
      expect(moved.some(([dx]) => dx < -1e-3 * reach), name).toBe(true);
      expect(new Set(moved.map(([dx]) => dx.toFixed(6))).size, name).toBeGreaterThan(2);
      expect(spread.items.every((item) => !item.hidden), name).toBe(true);
    }
  });

  it('keeps every crease joined, and parts the corners a fold lays on one place', () => {
    for (const { name, scene: kernel } of real()) {
      const spread = spreadScene(kernel);
      const at = new Map<number, ScenePoint>();
      let parted = false;
      for (const item of faceItems(spread)) {
        const { points, outline } = kernel.faces[item.face]!;
        expect(points.length, name).toBe(outline.length);
        item.rings[0]!.forEach((p, k) => {
          const known = at.get(points[k]!);
          if (!known) at.set(points[k]!, p);
          else {
            expect(p[0], `${name}: vertex ${points[k]}`).toBeCloseTo(known[0], 9);
            expect(p[1], `${name}: vertex ${points[k]}`).toBeCloseTo(known[1], 9);
          }
        });
      }
      // Two vertices folded onto one place now stand apart somewhere.
      const placed = new Map<string, number[]>();
      kernel.faces.forEach(({ points, outline }) =>
        outline.forEach((p, k) => {
          const key = `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
          placed.set(key, [...new Set([...(placed.get(key) ?? []), points[k]!])]);
        })
      );
      for (const vertices of placed.values()) {
        const where = vertices.map((v) => at.get(v)!);
        if (where.some((p) => Math.hypot(p[0] - where[0]![0], p[1] - where[0]![1]) > 1e-6)) parted = true;
      }
      expect(parted, name).toBe(true);
    }
  });

  it('steps the same on the screen however the picture is turned', () => {
    const { scene: kernel } = real()[2]!; // the kabuto, front
    const turned = (degrees: number) => {
      const radians = (degrees * Math.PI) / 180;
      return (p: Point): ScenePoint => [
        (p.x * Math.cos(radians) - p.y * Math.sin(radians)) * 3,
        (p.x * Math.sin(radians) + p.y * Math.cos(radians)) * 3,
      ];
    };
    const reference = steps(
      foldedFlatPaperScene(kernel, { markHidden: false, toScenePx: turned(0), scale: 3 }),
      spreadScene(kernel, turned(0), 3)
    );
    expect(reference.some(([dx, dy]) => dx !== 0 || dy !== 0)).toBe(true);
    for (const degrees of [90, 37]) {
      const moved = steps(
        foldedFlatPaperScene(kernel, { markHidden: false, toScenePx: turned(degrees), scale: 3 }),
        spreadScene(kernel, turned(degrees), 3)
      );
      expect(moved.length).toBe(reference.length);
      moved.forEach(([dx, dy], i) => {
        expect(dx).toBeCloseTo(reference[i]![0], 9);
        expect(dy).toBeCloseTo(reference[i]![1], 9);
      });
    }
  });

  it('moves woven patches and aux lines with their face, onto its stepped edges', () => {
    const { scene: kernel } = weave();
    const scene = spreadScene(kernel);
    const whole = faceItems(scene).find((item) => item.face === V2 && item.group === undefined)!;
    const [c0, c1, c2, c3] = whole.rings[0]! as [ScenePoint, ScenePoint, ScenePoint, ScenePoint];
    // V2 is the strip x 3..4, y 0..5: corners (3,0) (4,0) (4,5) (3,5). It
    // lies under H2, so its corners — its own alone — step.
    expect(c0[0]).toBeLessThan(3);
    const onSegment = (p: ScenePoint, a: ScenePoint, b: ScenePoint) => {
      const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / Math.hypot(b[0] - a[0], b[1] - a[1]) ** 2;
      return Math.abs(cross) < 1e-9 && t > -1e-9 && t < 1 + 1e-9;
    };
    const patches = faceItems(scene).filter((item) => item.group !== undefined);
    expect(patches.length).toBe(3);
    for (const patch of patches) {
      for (const p of patch.rings[0]!) {
        // Each patch spans the strip's width: every corner is on one of its long sides.
        expect(onSegment(p, c1, c2) || onSegment(p, c3, c0), `patch corner ${p}`).toBe(true);
      }
    }
    // The aux line down V2's middle ends at the middle of its stepped ends.
    const aux = lineItems(scene).find((line) => line.role === 'aux' && line.group === undefined)!;
    expect(aux.a[0]).toBeCloseTo((c0[0] + c1[0]) / 2, 9);
    expect(aux.a[1]).toBeCloseTo((c0[1] + c1[1]) / 2, 9);
    expect(aux.b[0]).toBeCloseTo((c2[0] + c3[0]) / 2, 9);
    expect(aux.b[1]).toBeCloseTo((c2[1] + c3[1]) / 2, 9);
    // Its stretches over the patches lie along it.
    for (const stretch of lineItems(scene).filter((line) => line.role === 'aux' && line.group !== undefined)) {
      expect(onSegment(stretch.a, aux.a, aux.b) && onSegment(stretch.b, aux.a, aux.b)).toBe(true);
      expect(stretch.whole).toEqual({ a: aux.a, b: aux.b, onBoundary: [true, true] });
    }
  });

  it('bounds the stepped picture', () => {
    const { scene: kernel } = real()[0]!;
    const plain = sceneOf(kernel, false);
    const spread = spreadScene(kernel);
    const all = spread.items.flatMap(pointsOf);
    expect(spread.bounds).toEqual({
      minX: Math.min(...all.map((p) => p[0])),
      minY: Math.min(...all.map((p) => p[1])),
      maxX: Math.max(...all.map((p) => p[0])),
      maxY: Math.max(...all.map((p) => p[1])),
    });
    // Deeper layers went up and left past the picture's old corner.
    expect(spread.bounds.minX).toBeLessThan(plain.bounds.minX);
    expect(spread.bounds.minY).toBeLessThan(plain.bounds.minY);
    expect(spread.sheet).toBe(plain.sheet);
  });
});

describe('wovenDrawOrder', () => {
  /** "Draw u after v", with a weight, as arcs. */
  const arcs = (entries: Array<[number, number, number]>) => {
    const after = new Map<number, Map<number, number>>();
    for (const [u, v, weight] of entries) {
      const targets = after.get(u) ?? new Map<number, number>();
      targets.set(v, weight);
      after.set(u, targets);
    }
    return after;
  };

  it('draws an order with no cycle as it asks, each face after what it must follow', () => {
    expect(wovenDrawOrder([2, 0, 1], arcs([[2, 1, 1], [1, 0, 1]]))).toEqual([0, 1, 2]);
  });

  it('breaks a cycle at its lightest arc', () => {
    // 0 after 1 and 1 after 2 weigh 5; 2 after 0 weighs 1, and gives.
    expect(wovenDrawOrder([0, 1, 2], arcs([[0, 1, 5], [1, 2, 5], [2, 0, 1]]))).toEqual([2, 1, 0]);
    expect(wovenDrawOrder([0, 1, 2], arcs([[0, 1, 1], [1, 2, 5], [2, 0, 5]]))).toEqual([0, 2, 1]);
  });

  it('is a function of the arcs alone: ties go to the lowest face, and other faces are ignored', () => {
    expect(wovenDrawOrder([2, 0, 1], new Map())).toEqual([0, 1, 2]);
    expect(wovenDrawOrder([1, 3], arcs([[3, 1, 1], [3, 7, 9], [7, 1, 9]]))).toEqual([1, 3]);
  });
});
