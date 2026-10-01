/**
 * The flat figure's scene, against the kernel's own paper scenes.
 *
 * The real fixtures are folded by the wasm kernel in this process — the same
 * `folded_figure_fold` and `folded_figure_paper_scene` the worker calls — so
 * what the producer is tested on is what it gets in the app: the drawer's
 * subfaces and stacks for the Oriedita solution sample and the kabuto, front
 * and back. Both stack acyclically. Oriedita's own `glitch.cp` test pattern
 * does not: seen from the back, a cycle of thirty-odd faces is on top of
 * nearly every subface, so most of what shows is drawn in pieces. The woven
 * case is hand-built in the kernel's shape as well, small enough to name every
 * piece: four strips each over the next and the last over the first, beside
 * two faces that stack plainly.
 *
 * The parity gate is the one the 3D scene's tests use: paint the scene in
 * painter's order with nothing else, and read back, inside every subface, the
 * face that came out on top. It must be the face the oracle-checked drawer
 * paints there — the kernel's `faces_top_to_bottom[0]` — whether the face was
 * drawn whole or in pieces. And no line on top of its subface may be left
 * half-covered: a later fill along it, with nothing after that drawing the
 * line again, paints over the outer half of its stroke.
 */

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
import { foldedSceneLocalGeometry } from '../adapters/cpFoldedToScene';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { erodeLine, faceOutlineLines } from '../../lib/paper/paperSvg';
import { faceComponents, foldedFlatPaperScene } from './foldedFlatScene';

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

/** An axis-aligned rectangle as a kernel face: four border edges, or one fold. */
function rectangle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  frontUp = true,
  foldEdge: number | null = null
): OristudioCpFoldedPaperFace {
  const outline = [point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)];
  return {
    outline,
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
  faces[H1] = rectangle(0, 1, 5, 2, true, 0);
  faces[V1] = rectangle(1, 0, 2, 5, false, 1);
  faces[H2] = rectangle(0, 3, 5, 4);
  faces[V2] = rectangle(3, 0, 4, 5);
  faces[E] = rectangle(6, 0, 7, 1);
  faces[F] = rectangle(6, 0, 7, 2, false);
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
  return { schema_version: 1, flipped: false, sheet: 7, faces, subfaces, aux_lines: [] };
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
    const scene = sceneOf({ schema_version: 1, flipped: false, sheet: 0, faces: [], subfaces: [], aux_lines: [] });
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

  it('splits only the cycle’s faces, into their subface pieces', () => {
    const kernel = wovenScene();
    const scene = sceneOf(kernel);
    const faces = faceItems(scene);
    const piecesOf = (face: number) => faces.filter((f) => f.face === face);
    // The plain pair: whole, and in order.
    expect(piecesOf(E)).toHaveLength(1);
    expect(piecesOf(F)).toHaveLength(1);
    expect(piecesOf(E)[0]!.rings).toEqual([ring(kernel.faces[E]!.outline)]);
    expect(piecesOf(E)[0]!.hidden).toBe(true);
    expect(piecesOf(F)[0]!.hidden).toBe(false);
    expect(piecesOf(E)[0]!.outline).toBe('edge');
    expect(piecesOf(F)[0]!.outline).toBe('edge');
    // The weave: a piece for each subface the face lies under something in,
    // that subface's polygon, and one item for every subface it is on top of,
    // their polygons its rings.
    for (const face of WOVEN) {
      const pieces = piecesOf(face);
      const buried = kernel.subfaces.filter((s) => s.faces_top_to_bottom.indexOf(face) > 0);
      const topped = kernel.subfaces.filter((s) => s.faces_top_to_bottom[0] === face);
      expect(topped.length, `face ${face}`).toBeGreaterThan(1);
      expect(pieces, `face ${face}`).toHaveLength(buried.length + 1);
      const [top, ...rest] = [...pieces].sort((a, b) => Number(a.hidden) - Number(b.hidden));
      expect(top!.hidden).toBe(false);
      expect(top!.rings).toHaveLength(topped.length);
      expect(top!.rings).toEqual(expect.arrayContaining(topped.map((s) => ring(s.polygon))));
      for (const piece of rest) {
        expect(piece.hidden).toBe(true);
        expect(piece.rings).toHaveLength(1);
        expect(buried.map((s) => ring(s.polygon))).toContainEqual(piece.rings[0]);
      }
      for (const piece of pieces) {
        expect(piece.side).toBe(kernel.faces[face]!.front_up ? 'front' : 'back');
        // A piece's rings are cut where its face is not: its outline is lines.
        expect(piece.outline).toBeUndefined();
      }
    }
    // A piece is hidden when it is not the top of its subface.
    const hiddenPieces = faces.filter((f) => WOVEN.includes(f.face) && f.hidden);
    expect(hiddenPieces.map((f) => f.rings[0])).toEqual(
      expect.arrayContaining([ring(kernel.subfaces[1]!.polygon), ring(kernel.subfaces[3]!.polygon)])
    );
    expect(hiddenPieces).toHaveLength(4);
    expectStacksInPainterOrder(kernel, scene);
  });

  it('gives each piece the outline portions that bound it, and loses none', () => {
    const kernel = wovenScene();
    const scene = sceneOf(kernel);
    const after = linesAfterEachFace(scene);
    // H1's piece under V2 (subface 3) carries the two H1 edge portions along
    // that piece's top and bottom, hidden with it; V2's piece over it carries
    // V2's portions there, visible.
    const h1UnderV2 = scene.items.findIndex(
      (item) => item.kind === 'face' && item.face === H1 && item.rings[0]![0]![0] === 3
    );
    const h1Lines = after.get(h1UnderV2)!;
    expect(h1Lines).toHaveLength(2);
    expect(h1Lines.every((l) => l.hidden && l.face === H1 && l.role === 'edge')).toBe(true);
    expect(h1Lines.map((l) => [l.a, l.b].sort())).toEqual(
      expect.arrayContaining([
        [[3, 1], [4, 1]],
        [[3, 2], [4, 2]],
      ])
    );
    // Every portion of every woven outline is somewhere, and hidden or not
    // as its piece is: the sum of the portions' lengths is the outline's.
    for (const face of WOVEN) {
      const total = lineItems(scene)
        .filter((l) => l.face === face)
        .reduce((n, l) => n + Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]), 0);
      expect(total, `face ${face}`).toBeCloseTo(12, 9);
    }
    // Lines of a piece are drawn before the piece over it: V2 on top of
    // subface 3 comes after H1's lines there. V2's portions along that
    // piece's two sides are visible, and wait for the last fill of the cycle.
    const v2OverH1 = scene.items.findIndex(
      (item) => item.kind === 'face' && item.face === V2 && !item.hidden
    );
    expect(v2OverH1).toBeGreaterThan(h1UnderV2 + 2);
    let lastWovenFill = -1;
    scene.items.forEach((item, index) => {
      if (item.kind === 'face' && WOVEN.includes(item.face)) lastWovenFill = index;
    });
    const sideOf = (a: ScenePoint, b: ScenePoint) =>
      scene.items.findIndex(
        (item) =>
          item.kind === 'line' &&
          item.face === V2 &&
          JSON.stringify([item.a, item.b].sort()) === JSON.stringify([a, b])
      );
    for (const side of [sideOf([3, 1], [3, 2]), sideOf([4, 1], [4, 2])]) {
      expect(side).toBeGreaterThan(lastWovenFill);
      expect((scene.items[side] as PaperLineItem).hidden).toBe(false);
    }
  });

  it('draws every line on top after the last piece of the cycle', () => {
    const kernel = wovenScene();
    const scene = sceneOf(kernel);
    let lastWovenFill = -1;
    scene.items.forEach((item, index) => {
      if (item.kind === 'face' && WOVEN.includes(item.face)) lastWovenFill = index;
    });
    scene.items.forEach((item, index) => {
      if (item.kind !== 'line' || item.face === undefined || !WOVEN.includes(item.face)) return;
      if (item.hidden) expect(index, 'a buried line stays with its piece').toBeLessThan(lastWovenFill);
      else expect(index, 'a line on top waits for the cycle').toBeGreaterThan(lastWovenFill);
    });
  });

  it('leaves no line on top half-covered, whether or not buried items are kept', () => {
    const scene = sceneOf(wovenScene());
    expect(halfCoveredLines(scene)).toEqual([]);
    expect(halfCoveredLines(scene, true)).toEqual([]);
  });

  it('gives an aux line along the cut between two of a face’s pieces to the one on top', () => {
    const kernel = wovenScene();
    // Across H1 at x = 3: the cut between H1 on top (subface 2) and H1 under
    // V2 (subface 3). Seen from subface 2's side it shows.
    kernel.aux_lines.push({ from: point(3, 1), to: point(3, 2), face: H1 });
    const scene = sceneOf(kernel);
    const aux = lineItems(scene).filter((l) => l.role === 'aux');
    expect(aux).toHaveLength(1);
    expect(aux[0]!.hidden).toBe(false);
    let lastWovenFill = -1;
    scene.items.forEach((item, index) => {
      if (item.kind === 'face' && WOVEN.includes(item.face)) lastWovenFill = index;
    });
    expect(scene.items.indexOf(aux[0]!)).toBeGreaterThan(lastWovenFill);
    // V2's edge along the same cut is inked over it, as a whole face's edges
    // are over another face's aux line and the canvas draws every aux line.
    const v2Edge = scene.items.findIndex(
      (item) =>
        item.kind === 'line' &&
        item.face === V2 &&
        item.role === 'edge' &&
        JSON.stringify([item.a, item.b].sort()) === JSON.stringify([[3, 1], [3, 2]])
    );
    expect(v2Edge).toBeGreaterThan(scene.items.indexOf(aux[0]!));
  });

  it('erodes a split face’s aux stretches on the whole crease, as the canvas does', () => {
    const kernel = wovenScene();
    // Across H2 from edge to edge: under V1 for x < 2, on top from x = 2.
    kernel.aux_lines.push({ from: point(1.2, 3), to: point(2.8, 4), face: H2 });
    const scene = sceneOf(kernel);
    const aux = lineItems(scene).filter((l) => l.role === 'aux');
    expect(aux).toHaveLength(2);
    for (const stretch of aux) {
      expect(stretch.whole).toEqual({ a: [1.2, 3], b: [2.8, 4], onBoundary: [true, true] });
    }
    const erode = 0.7;
    const whole = erodeLine({ a: [1.2, 3], b: [2.8, 4], onBoundary: [true, true] }, erode)!;
    const onTop = aux.find((l) => !l.hidden)!;
    const eroded = erodeLine(onTop, erode)!;
    // What the pull leaves of the stretch: from the cut to the crease's own
    // pulled end — not nothing, as eroding the short stretch alone gave.
    expect(eroded[0]).toEqual([2, 3.5]);
    expect(eroded[1][0]).toBeCloseTo(whole[1][0], 9);
    expect(eroded[1][1]).toBeCloseTo(whole[1][1], 9);
  });

  it('cuts a split face’s aux line at its pieces, each stretch drawn with the piece it crosses', () => {
    const kernel = wovenScene();
    // Along the middle of H1, end to end: on top of H1 everywhere but subface 3,
    // where V2 covers it.
    kernel.aux_lines.push({ from: point(0, 1.5), to: point(5, 1.5), face: H1 });
    const scene = sceneOf(kernel);
    const aux = scene.items
      .map((item, index) => ({ item, index }))
      .filter((e): e is { item: PaperLineItem; index: number } => e.item.kind === 'line' && e.item.role === 'aux');
    const spans = aux.map(({ item }) => [item.a[0], item.b[0]]);
    expect(spans).toHaveLength(3);
    expect(aux.every(({ item }) => item.face === H1 && item.a[1] === 1.5 && item.b[1] === 1.5)).toBe(true);
    const byStart = [...aux].sort((l, r) => l.item.a[0] - r.item.a[0]);
    const [left, under, right] = byStart.map(({ item }) => item);
    // The stretches on top join across the pieces they cross, so a dash runs
    // on; only a real end of the crease retreats under erode.
    expect([left!.a[0], left!.b[0]]).toEqual([0, expect.closeTo(3, 9)]);
    expect(left!.onBoundary).toEqual([true, false]);
    expect(right!.b[0]).toBe(5);
    expect(right!.a[0]).toBeCloseTo(4, 9);
    expect(right!.onBoundary).toEqual([false, true]);
    expect(under!.a[0]).toBeCloseTo(3, 9);
    expect(under!.b[0]).toBeCloseTo(4, 9);
    expect(under!.onBoundary).toEqual([false, false]);
    expect([left!.hidden, under!.hidden, right!.hidden]).toEqual([false, true, false]);
    // The buried stretch lies between H1's piece under V2 and V2 over it; the
    // stretches on top wait for the cycle's last fill.
    const h1UnderV2 = scene.items.findIndex(
      (item) => item.kind === 'face' && item.face === H1 && item.hidden
    );
    const v2 = scene.items.findIndex((item) => item.kind === 'face' && item.face === V2 && !item.hidden);
    const at = (line: PaperLineItem) => scene.items.indexOf(line);
    expect(at(under!)).toBeGreaterThan(h1UnderV2);
    expect(at(under!)).toBeLessThan(v2);
    let lastWovenFill = -1;
    scene.items.forEach((item, index) => {
      if (item.kind === 'face' && WOVEN.includes(item.face)) lastWovenFill = index;
    });
    expect(at(left!)).toBeGreaterThan(lastWovenFill);
    expect(at(right!)).toBeGreaterThan(lastWovenFill);
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
    // of the picture is drawn in pieces and their lines.
    const { scene } = back!;
    const inCycle = new Set(
      faceComponents(scene.faces.length, scene.subfaces).filter((c) => c.length > 1).flat()
    );
    const toppedByCycle = scene.subfaces.filter((s) => inCycle.has(s.faces_top_to_bottom[0]!));
    expect(toppedByCycle.length).toBeGreaterThan(scene.subfaces.length / 2);
  });

  it('orders every stack bottom to top', () => {
    for (const { scene: kernel } of cyclic()) {
      expectStacksInPainterOrder(kernel, sceneOf(kernel));
    }
  });

  it('draws in the same order when nothing is marked hidden, as the crease-pattern export asks', () => {
    for (const kernel of [wovenScene(), ...cyclic().map((f) => f.scene)]) {
      const marked = sceneOf(kernel);
      const unmarked = sceneOf(kernel, false);
      expect(unmarked.items.every((item) => !item.hidden)).toBe(true);
      expect(unmarked.items).toEqual(marked.items.map((item) => ({ ...item, hidden: false })));
    }
  });

  it('fills a face’s pieces on top on the canvas as the painter does: every ring, none a hole', () => {
    const { scene: kernel } = cyclic()[1]!;
    const scene = sceneOf(kernel, false);
    const merged = faceItems(scene).filter((item) => item.rings.length > 1);
    expect(merged.length).toBeGreaterThan(0);
    const ringArea = (r: readonly ScenePoint[]) =>
      Math.abs(r.reduce((n, [x, y], i) => n + x * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * y, 0)) / 2;
    for (const item of merged) {
      const expected = item.rings.reduce((n, r) => n + ringArea(r), 0);
      const { fillPos } = foldedSceneLocalGeometry({ ...scene, items: [item] }, DEFAULT_PAPER_STYLE);
      let area = 0;
      for (let v = 0; v + 5 < fillPos.length; v += 6) {
        const [ax, ay, bx, by, cx, cy] = fillPos.slice(v, v + 6);
        area += Math.abs((bx! - ax!) * (cy! - ay!) - (cx! - ax!) * (by! - ay!)) / 2;
      }
      expect(area / expected, `face ${item.face}`).toBeCloseTo(1, 4);
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

  it('for glitch.cp, where most of the back is drawn in pieces', () => {
    for (const { name, scene: kernel } of cyclic()) {
      const { wrong, sampled } = topFaceDisagreements(kernel, sceneOf(kernel));
      expect(wrong, name).toEqual([]);
      expect(sampled, name).toBeGreaterThan(0);
    }
  });

  it('for the weave, where the faces are drawn in pieces', () => {
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
