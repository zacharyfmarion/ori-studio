/**
 * The 3D window's picture against a scene's, rasterised without a canvas: the
 * window's draw passes with a depth buffer interpolated across the screen as
 * the GPU's is, the scene in painter's order with nothing else. Shared by the
 * 3D scene's contract test (`folded3dScene.test.ts`) and the diagram corpus
 * (`diagram/dataset/`), which runs it on real steps with their own aux lines.
 *
 * Test support: imported by tests only.
 */
import { projectVertices, type CameraUniforms, type PaperLineRole, type PaperScene } from '@treemaker/origami-simulator';
import { folded3dDrawPasses } from '../../simulator/foldedMeshSource';
import type { Folded3dMesh } from './folded3dMesh';
import { FOLDED_3D_CREASE_DEPTH_BIAS } from './folded3dWindow';

/** The window's box in the comparison, in CSS px; scenes compared are built for it. */
export const WINDOW_PARITY_BOX = 300;
const BOX = WINDOW_PARITY_BOX;

export const BACKGROUND = -1;
export const INK = 1_000_000;

export interface Picture {
  /** The kernel face painted at each pixel, `INK + n` for a crease, `-1` for none. */
  id: Int32Array;
  side: Int8Array;
}

export function blank(): Picture {
  return { id: new Int32Array(BOX * BOX).fill(BACKGROUND), side: new Int8Array(BOX * BOX) };
}

/** Even-odd scanline fill of a set of rings, in px; `depth` per ring vertex when depth-tested. */
export function fillRings(
  pic: Picture,
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  id: number,
  side: number
): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) for (const [, y] of ring) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const crossings: number[] = [];
  for (let row = Math.max(0, Math.ceil(minY - 0.5)); row <= Math.min(BOX - 1, Math.floor(maxY - 0.5)); row += 1) {
    const y = row + 0.5;
    crossings.length = 0;
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i += 1) {
        const [x1, y1] = ring[i]!;
        const [x2, y2] = ring[(i + 1) % ring.length]!;
        if (y1 <= y === y2 <= y) continue;
        crossings.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    crossings.sort((l, r) => l - r);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const first = Math.max(0, Math.ceil(crossings[i]! - 0.5));
      const last = Math.min(BOX - 1, Math.floor(crossings[i + 1]! - 0.5));
      for (let col = first; col <= last; col += 1) {
        pic.id[row * BOX + col] = id;
        pic.side[row * BOX + col] = side;
      }
    }
  }
}

/** A depth-tested triangle, depth interpolated across the screen as the GPU's is. */
export function fillTriangle(
  pic: Picture,
  depth: Float32Array,
  p: ReadonlyArray<readonly [number, number, number]>,
  id: number,
  side: number
): void {
  const [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] = p as [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-12) return;
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(BOX - 1, Math.ceil(Math.max(ay, by, cy)));
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(BOX - 1, Math.ceil(Math.max(ax, bx, cx)));
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const sx = px + 0.5;
      const sy = py + 0.5;
      const w0 = ((bx - ax) * (sy - ay) - (by - ay) * (sx - ax)) / area;
      const w1 = ((sx - ax) * (cy - ay) - (sy - ay) * (cx - ax)) / area;
      if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
      const at = py * BOX + px;
      const z = az + w1 * (bz - az) + w0 * (cz - az);
      if (z > depth[at]!) continue;
      depth[at] = z;
      pic.id[at] = id;
      pic.side[at] = side;
    }
  }
}

/** A crease as a ribbon of half-width `half`, depth-tested with a bias when `depth` is given. */
export function stampSegment(
  pic: Picture,
  a: readonly [number, number],
  b: readonly [number, number],
  id: number,
  half: number,
  depth: Float32Array | null,
  az = 0,
  bz = 0,
  bias = 0
): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return;
  const steps = Math.max(1, Math.ceil(length * 2));
  for (let s = 0; s <= steps; s += 1) {
    const u = s / steps;
    const x = a[0] + dx * u;
    const y = a[1] + dy * u;
    const z = az + (bz - az) * u;
    for (let oy = -Math.ceil(half); oy <= Math.ceil(half); oy += 1) {
      for (let ox = -Math.ceil(half); ox <= Math.ceil(half); ox += 1) {
        if (ox * ox + oy * oy > half * half + 0.5) continue;
        const px = Math.floor(x + ox);
        const py = Math.floor(y + oy);
        if (px < 0 || py < 0 || px >= BOX || py >= BOX) continue;
        const at = py * BOX + px;
        // Creases test but do not write depth, exactly like the real pass.
        if (depth && z - bias > depth[at]!) continue;
        pic.id[at] = id;
      }
    }
  }
}

/**
 * The window's frame: `folded3dDrawPasses` at the scene's own camera, under
 * the mesh renderer's perspective, with a depth buffer. What the GPU would
 * show, decided in the same arithmetic several steps before a canvas.
 */
export function windowPicture(mesh: Folded3dMesh, camera: CameraUniforms, half: number): Picture {
  const projected = projectVertices(mesh.positions, camera);
  const ndcZ = (v: number): number =>
    Math.max(-1, Math.min(1, -(projected.view[v * 3 + 2] ?? 0) / camera.depthRange));
  const screen = (v: number): [number, number] => [
    projected.screen[v * 2]!,
    projected.screen[v * 2 + 1]!,
  ];
  const faceOfTriangle = new Int32Array(mesh.topology.faceIndices.length / 3).fill(-1);
  for (let slot = 0; slot < mesh.slots.count; slot += 1) {
    for (let i = mesh.slots.indexStart[slot]!; i < mesh.slots.indexStart[slot + 1]!; i += 3) {
      faceOfTriangle[i / 3] = mesh.slots.face[slot]!;
    }
  }
  // Skins repeat slot triangles at their own offsets; look a triangle's face
  // up by its first vertex, which every copy shares.
  const faceOfVertex = new Int32Array(Math.floor(mesh.positions.length / 3)).fill(-1);
  for (let slot = 0; slot < mesh.slots.count; slot += 1) {
    for (let v = mesh.slots.vertexStart[slot]!; v < mesh.slots.vertexStart[slot + 1]!; v += 1) {
      faceOfVertex[v] = mesh.slots.face[slot]!;
    }
  }

  const pic = blank();
  const depth = new Float32Array(BOX * BOX).fill(Infinity);
  const passes = folded3dDrawPasses(
    { ...mesh, undeterminedFaceAlpha: 0.45 },
    { showFaces: true, showEdges: true, faceAlpha: 1 },
    camera
  );
  const idx = mesh.topology.faceIndices;
  for (const pass of passes) {
    if (pass.faceRange) {
      const end = pass.faceRange.start + pass.faceRange.count;
      for (let t = pass.faceRange.start; t + 2 < end; t += 3) {
        const [ia, ib, ic] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
        const [ax, ay] = screen(ia);
        const [bx, by] = screen(ib);
        const [cx, cy] = screen(ic);
        // `gl_FrontFacing` from the screen winding, negated for y-down.
        const winding = -((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
        fillTriangle(
          pic,
          depth,
          [
            [ax, ay, ndcZ(ia)],
            [bx, by, ndcZ(ib)],
            [cx, cy, ndcZ(ic)],
          ],
          faceOfVertex[ia]!,
          winding >= 0 ? 1 : -1
        );
      }
    }
    if (pass.edgeRange) {
      const end = pass.edgeRange.start + pass.edgeRange.count;
      for (let e = pass.edgeRange.start; e < end; e += 1) {
        const ia = mesh.topology.edgeIndices[e * 2]!;
        const ib = mesh.topology.edgeIndices[e * 2 + 1]!;
        stampSegment(pic, screen(ia), screen(ib), INK + e, half, depth, ndcZ(ia), ndcZ(ib), FOLDED_3D_CREASE_DEPTH_BIAS);
      }
    }
  }
  return pic;
}

/** The page: every item in order, hidden ones included — they change nothing if marked right. */
export function scenePicture(scene: PaperScene, half: number): Picture {
  const pic = blank();
  scene.items.forEach((item, index) => {
    if (item.kind === 'face') fillRings(pic, item.rings, item.face, item.side === 'front' ? 1 : -1);
    else if (item.kind === 'line') stampSegment(pic, item.a, item.b, INK + index, half, null);
  });
  return pic;
}

/** Ink pixels of `pic`, dilated by `r`. */
export function inkMask(pic: Picture, r: number): Uint8Array {
  const mask = new Uint8Array(BOX * BOX);
  for (let y = 0; y < BOX; y += 1) {
    for (let x = 0; x < BOX; x += 1) {
      if (pic.id[y * BOX + x]! < INK) continue;
      for (let oy = -r; oy <= r; oy += 1) {
        for (let ox = -r; ox <= r; ox += 1) {
          const px = x + ox;
          const py = y + oy;
          if (px >= 0 && py >= 0 && px < BOX && py < BOX) mask[py * BOX + px] = 1;
        }
      }
    }
  }
  return mask;
}

export interface Disagreement {
  /** Pixels either picture paints. */
  painted: number;
  /** Pixels where the two show a different face or side, over paper in both. */
  paper: number;
  /** Scene ink over paper the window draws no ink near. */
  spuriousInk: number;
  /** Window ink over paper the scene draws no ink near. */
  missingInk: number;
  /** {@link spuriousInk} by the role of the scene line that drew it. */
  spuriousInkByRole: Partial<Record<PaperLineRole, number>>;
  /** How many scene lines drew any of it, by role. */
  linesWithSpuriousInk: Partial<Record<PaperLineRole, number>>;
}

/**
 * Where the scene and the window disagree. A buried line the scene draws on top
 * is ink over paper the window shows bare: `spuriousInk`, attributed to the
 * line's role, so an aux line drawn over the paper that covers it is told from
 * the concave creases the window itself loses.
 */
export function compareWithWindow(mesh: Folded3dMesh, scene: PaperScene, camera: CameraUniforms): Disagreement {
  const half = 1.5;
  const window = windowPicture(mesh, camera, half);
  const page = scenePicture(scene, half);
  const windowInk = inkMask(window, 3);
  const pageInk = inkMask(page, 3);
  let painted = 0;
  let paper = 0;
  let spuriousInk = 0;
  let missingInk = 0;
  const spuriousInkByRole: Partial<Record<PaperLineRole, number>> = {};
  const strayLines = new Map<PaperLineRole, Set<number>>();
  for (let i = 0; i < BOX * BOX; i += 1) {
    const w = window.id[i]!;
    const p = page.id[i]!;
    if (w === BACKGROUND && p === BACKGROUND) continue;
    painted += 1;
    const wPaper = w >= 0 && w < INK;
    const pPaper = p >= 0 && p < INK;
    if (wPaper && pPaper && (w !== p || window.side[i] !== page.side[i])) paper += 1;
    if (p >= INK && !windowInk[i] && (wPaper || w === BACKGROUND)) {
      spuriousInk += 1;
      const item = scene.items[p - INK];
      if (item?.kind === 'line') {
        spuriousInkByRole[item.role] = (spuriousInkByRole[item.role] ?? 0) + 1;
        let lines = strayLines.get(item.role);
        if (!lines) strayLines.set(item.role, (lines = new Set()));
        lines.add(p - INK);
      }
    }
    if (w >= INK && !pageInk[i]) missingInk += 1;
  }
  const linesWithSpuriousInk: Partial<Record<PaperLineRole, number>> = {};
  for (const [role, lines] of strayLines) linesWithSpuriousInk[role] = lines.size;
  return { painted, paper, spuriousInk, missingInk, spuriousInkByRole, linesWithSpuriousInk };
}
