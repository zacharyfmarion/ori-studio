/**
 * The flat figure's scene, against the kernel's own paper scenes.
 *
 * The real fixtures are folded by the wasm kernel in this process — the same
 * `folded_figure_fold` and `folded_figure_paper_scene` the worker calls — so
 * what the producer is tested on is what it gets in the app: the drawer's
 * subfaces and stacks for the Oriedita solution sample and the kabuto, front
 * and back. Both stack acyclically. The woven case, which no committed
 * crease pattern folds to, is hand-built in the kernel's shape: four strips
 * each over the next and the last over the first, beside two faces that
 * stack plainly.
 *
 * The parity gate is the one the 3D scene's tests use: paint the scene in
 * painter's order with nothing else, and read back, inside every subface, the
 * face that came out on top. It must be the face the oracle-checked drawer
 * paints there — the kernel's `faces_top_to_bottom[0]` — whether the face was
 * drawn whole or in pieces.
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
  PaperLineItem,
  PaperScene,
  ScenePoint,
} from '../../lib/paper/paperScene';
import { faceComponents, foldedFlatPaperScene } from './foldedFlatScene';

const FIXTURES = resolve(process.cwd(), '../../tests/fixtures');

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
});

/** The four kernel scenes, or a failure: no test here may pass on an empty list. */
function real(): KernelFixture[] {
  expect(folded).toHaveLength(4);
  return folded;
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

/** The lines that follow each face item, up to the next face item. */
function linesAfterEachFace(scene: PaperScene): Map<number, PaperLineItem[]> {
  const after = new Map<number, PaperLineItem[]>();
  let current: PaperLineItem[] | null = null;
  scene.items.forEach((item, index) => {
    if (item.kind === 'face') {
      current = [];
      after.set(index, current);
    } else if (current) {
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
 * says is under. A face's item there is the whole face, or its piece cut to
 * that subface's polygon; either way there is exactly one.
 */
function expectStacksInPainterOrder(kernel: OristudioCpFoldedPaperScene, scene: PaperScene): void {
  const key = (r: readonly ScenePoint[]) => JSON.stringify(r);
  const at = new Map<string, number>();
  scene.items.forEach((item, index) => {
    if (item.kind === 'face') at.set(`${item.face}:${key(item.rings[0]!)}`, index);
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

  it('draws every face once, whole, with its lines right after it', () => {
    for (const { name, scene: kernel } of real()) {
      const scene = sceneOf(kernel);
      const faces = faceItems(scene);
      expect(faces.map((f) => f.face).sort((a, b) => a - b), name).toEqual(
        kernel.faces.map((_, i) => i)
      );
      const after = linesAfterEachFace(scene);
      scene.items.forEach((item, index) => {
        if (item.kind !== 'face') return;
        const source = kernel.faces[item.face]!;
        expect(item.rings, `${name} face ${item.face}`).toEqual([ring(source.outline)]);
        expect(item.side).toBe(source.front_up ? 'front' : 'back');
        expect(item.shade).toBe(1);
        const lines = after.get(index)!;
        expect(lines.length, `${name} face ${item.face} lines`).toBe(source.edges.length);
        lines.forEach((line, i) => {
          const edge = source.edges[i]!;
          expect(line.a).toEqual(identity(edge.from));
          expect(line.b).toEqual(identity(edge.to));
          expect(line.role).toBe(edge.kind === 'flat' ? 'aux' : 'edge');
          expect(line.face).toBe(item.face);
          expect(line.hidden).toBe(item.hidden);
          // A paper edge or a fold is the outline and never retreats.
          expect(line.onBoundary).toEqual([false, false]);
        });
      });
      expect(lineItems(scene).length).toBe(faces.reduce((n, f) => n + kernel.faces[f.face]!.edges.length, 0));
    }
  });

  it('orders the faces so every stack reads bottom to top', () => {
    for (const { scene: kernel } of real()) {
      expectStacksInPainterOrder(kernel, sceneOf(kernel));
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
    // The weave: one piece per subface the face is in, each the subface's polygon.
    for (const face of WOVEN) {
      const pieces = piecesOf(face);
      const inSubfaces = kernel.subfaces.filter((s) => s.faces_top_to_bottom.includes(face));
      expect(pieces, `face ${face}`).toHaveLength(inSubfaces.length);
      for (const piece of pieces) {
        expect(piece.rings).toHaveLength(1);
        expect(inSubfaces.map((s) => ring(s.polygon))).toContainEqual(piece.rings[0]);
        expect(piece.side).toBe(kernel.faces[face]!.front_up ? 'front' : 'back');
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
    // Lines of a piece are drawn before the piece over it: V2's piece in
    // subface 3 comes after H1's lines there, and carries V2's own portions
    // along its two sides, visible.
    const v2OverH1 = scene.items.findIndex(
      (item) => item.kind === 'face' && item.face === V2 && item.rings[0]![0]![1] === 1
    );
    expect(v2OverH1).toBeGreaterThan(h1UnderV2 + 2);
    const v2Lines = after.get(v2OverH1)!;
    expect(v2Lines).toHaveLength(2);
    expect(v2Lines.every((l) => !l.hidden && l.face === V2)).toBe(true);
    expect(v2Lines.map((l) => [l.a, l.b].sort())).toEqual(
      expect.arrayContaining([
        [[3, 1], [3, 2]],
        [[4, 1], [4, 2]],
      ])
    );
  });

  it('keeps a whole face’s lines after the face and a flat outline edge as aux', () => {
    const kernel = wovenScene();
    kernel.faces[F]!.edges[2]!.kind = 'flat';
    const scene = sceneOf(kernel);
    const fIndex = scene.items.findIndex((item) => item.kind === 'face' && item.face === F);
    const lines = linesAfterEachFace(scene).get(fIndex)!;
    expect(lines.map((l) => l.role)).toEqual(['edge', 'edge', 'aux', 'edge']);
    // The flat edge meets a border at both ends, so both retreat under erode.
    expect(lines[2]!.onBoundary).toEqual([true, true]);
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
