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
import { EDGE_CODE, type RenderSettings } from '@treemaker/origami-simulator';
import { FoldedMeshSource, folded3dDrawPasses } from '../../simulator/foldedMeshSource';
import { recordingCanvas, replayFrame, type ReplayedFrame } from '../../simulator/meshRendererReplay.testSupport';
import type { Folded3dMesh } from './folded3dMesh';
import { FOLDED_3D_CREASE_DEPTH_BIAS, folded3dMeshPayload } from './folded3dWindow';

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

/* ------------------------------------------------------------------------
 * A line shows only on its own paper
 *
 * The comparison above holds a scene to the window. What follows holds a
 * frame to itself, so it needs no reference and runs at any camera: the live
 * 3D view as `FoldedMeshSource` draws it (replayed from its own draws,
 * `meshRendererReplay.testSupport.ts`), and any vector picture. It keeps two
 * buffers where the window above keeps one: the paper on top, faces only,
 * and the ink the frame shows, by line. The window's one buffer lets ink
 * overwrite the face under it, and that face is the question.
 * --------------------------------------------------------------------- */

const ROLE_OF_CODE: Partial<Record<number, PaperLineRole>> = {
  [EDGE_CODE.border]: 'edge',
  [EDGE_CODE.mountain]: 'mountain',
  [EDGE_CODE.valley]: 'valley',
  [EDGE_CODE.aux]: 'aux',
};

/** A crease's role on the page, from its `EDGE_CODE`, as the vector scene names it. */
export const roleOfCode = (code: number): PaperLineRole => ROLE_OF_CODE[code] ?? 'edge';

/** A frame as two buffers, row by row from the top: the paper on top (faces only) and whose ink shows; -1 for none. */
export interface PaperRaster {
  width: number;
  height: number;
  face: Int32Array;
  /** 1 front, -1 back, 0 no paper. */
  side: Int8Array;
  ink: Int32Array;
}

/** A line of a raster, at its ink's index. */
export interface OwnPaperLine {
  role: PaperLineRole;
  /**
   * Its own paper: the faces it lies on, and those meeting it along it. Empty
   * for a line nothing was found for, which is left out (`unchecked`).
   */
  own: ReadonlySet<number>;
  /** Lines in one place share one — the same crease on another layer, a coincident piece: either's ink is the other's. */
  group: number;
  /** Its drawn (eroded) ends, px. */
  from: readonly [number, number];
  to: readonly [number, number];
  halfWidthPx: number;
  /** Whether its dash is on this far along it, px from `from`; absent, it is solid. */
  dashOn?: (alongPx: number) => boolean;
}

type ByRole = Partial<Record<PaperLineRole, number>>;

/** What {@link ownPaperCheck} counts, by line role. */
export interface OwnPaperRecord {
  /** Ink pixels with none of their line's own paper on top within its reach: over another face's paper, or over nothing. */
  foreign: ByRole;
  /** How many lines (groups) drew any. */
  foreignLines: ByRole;
  /** Points 1 px apart along a line where its own paper is on top and its dash on, but none of its ink is within a pixel. */
  gaps: ByRole;
  gapLines: ByRole;
  /** The scale of the two: ink pixels checked, and points along lines with their own paper on top. */
  ink: ByRole;
  samples: ByRole;
  /** Line groups with no paper of their own found, which are not counted: a picture line that matched no crease. */
  unchecked: number;
}

const bump = (counts: ByRole, role: PaperLineRole, by = 1): void => {
  counts[role] = (counts[role] ?? 0) + by;
};

/** How far a line's own paper may be from its ink: the ribbon's half width and a pixel. */
const reachOf = (line: Pick<OwnPaperLine, 'halfWidthPx'>): number => Math.max(2, Math.ceil(line.halfWidthPx) + 1);

/**
 * "A line shows only on its own paper", counted both ways over a raster:
 *
 * - **foreign ink**: a pixel of a line's ink with none of its own paper on
 *   top within its reach. A buried layer's line drawn over the paper that
 *   covers it, a stub poking through.
 * - **gaps**: a point along a line where its own paper is on top and its dash
 *   is on, but no ink of its group lies within a pixel. A line cut into
 *   pieces, or one a nearer paper covers along its own.
 *
 * Points within its reach of either end are not walked for gaps.
 */
export function ownPaperCheck(raster: PaperRaster, lines: readonly OwnPaperLine[]): OwnPaperRecord {
  const { width, height, face, ink } = raster;
  const record: OwnPaperRecord = { foreign: {}, foreignLines: {}, gaps: {}, gapLines: {}, ink: {}, samples: {}, unchecked: 0 };
  const ownWithin = (x: number, y: number, r: number, own: ReadonlySet<number>): boolean => {
    for (let dy = -r; dy <= r; dy += 1) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -r; dx <= r; dx += 1) {
        const xx = x + dx;
        if (xx < 0 || xx >= width || dx * dx + dy * dy > r * r + 1) continue;
        const paper = face[yy * width + xx]!;
        if (paper >= 0 && own.has(paper)) return true;
      }
    }
    return false;
  };

  const foreignGroups = new Set<number>();
  const groupInk = new Float64Array(ink.length).fill(-1);
  for (let at = 0; at < ink.length; at += 1) {
    const id = ink[at]!;
    if (id < 0) continue;
    const line = lines[id];
    if (!line) continue;
    groupInk[at] = line.group;
    if (line.own.size === 0) continue;
    bump(record.ink, line.role);
    if (ownWithin(at % width, Math.floor(at / width), reachOf(line), line.own)) continue;
    bump(record.foreign, line.role);
    if (!foreignGroups.has(line.group)) {
      foreignGroups.add(line.group);
      bump(record.foreignLines, line.role);
    }
  }

  // One walk per group: a crease drawn on several layers is one line on screen.
  const groups = new Map<number, { line: OwnPaperLine; own: Set<number> }>();
  for (const line of lines) {
    const known = groups.get(line.group);
    if (!known) groups.set(line.group, { line, own: new Set(line.own) });
    else for (const paper of line.own) known.own.add(paper);
  }
  for (const [group, { line, own }] of groups) {
    if (own.size === 0) {
      record.unchecked += 1;
      continue;
    }
    const dx = line.to[0] - line.from[0];
    const dy = line.to[1] - line.from[1];
    const length = Math.hypot(dx, dy);
    const reach = reachOf(line);
    let gapped = false;
    for (let along = reach; along <= length - reach; along += 1) {
      if (line.dashOn && !line.dashOn(along)) continue;
      const x = Math.floor(line.from[0] + (dx * along) / length);
      const y = Math.floor(line.from[1] + (dy * along) / length);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (!ownWithin(x, y, 1, own)) continue;
      bump(record.samples, line.role);
      let inked = false;
      for (let oy = -1; oy <= 1 && !inked; oy += 1) {
        for (let ox = -1; ox <= 1 && !inked; ox += 1) {
          const xx = x + ox;
          const yy = y + oy;
          inked = xx >= 0 && yy >= 0 && xx < width && yy < height && groupInk[yy * width + xx] === group;
        }
      }
      if (inked) continue;
      bump(record.gaps, line.role);
      gapped = true;
    }
    if (gapped) bump(record.gapLines, line.role);
  }
  return record;
}

type Vec = readonly [number, number, number];

/**
 * Which segments lie along one another: collinear to `tolerance` and sharing
 * more than `tolerance` of their length. A fold is inked by each layer whose
 * paper ends at it, from that plane's own copy of the ring, and two planes
 * split it at different points and agree on it only to the kernel's
 * tolerance, so neither its ends nor its pieces need match.
 */
function overlappingSegments(segments: ReadonlyArray<readonly [Vec, Vec]>, tolerance: number, cell: number): Array<[number, number]> {
  const grid = new Map<string, number[]>();
  segments.forEach(([p, q], index) => {
    const length = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    const steps = Math.max(1, Math.ceil(length / (cell / 2)));
    const seen = new Set<string>();
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const key = [0, 1, 2].map((axis) => Math.floor((p[axis]! + (q[axis]! - p[axis]!) * t) / cell)).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const list = grid.get(key);
      if (list) list.push(index);
      else grid.set(key, [index]);
    }
  });
  const along = ([p, q]: readonly [Vec, Vec], r: Vec): { offset: number; distance: number } => {
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const length = Math.hypot(d[0]!, d[1]!, d[2]!);
    const w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const offset = length > 0 ? (w[0]! * d[0]! + w[1]! * d[1]! + w[2]! * d[2]!) / length : 0;
    const distance = Math.sqrt(Math.max(0, w[0]! ** 2 + w[1]! ** 2 + w[2]! ** 2 - offset * offset));
    return { offset, distance };
  };
  const pairs: Array<[number, number]> = [];
  const tested = new Set<string>();
  for (const list of grid.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = Math.min(list[i]!, list[j]!);
        const b = Math.max(list[i]!, list[j]!);
        const key = `${a}:${b}`;
        if (tested.has(key)) continue;
        tested.add(key);
        const s = segments[a]!;
        const t = segments[b]!;
        const length = Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1], s[1][2] - s[0][2]);
        const t0 = along(s, t[0]);
        const t1 = along(s, t[1]);
        if (t0.distance > tolerance || t1.distance > tolerance) continue;
        const shared = Math.min(length, Math.max(t0.offset, t1.offset)) - Math.max(0, Math.min(t0.offset, t1.offset));
        if (shared > tolerance) pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

/** The face of the slot each vertex belongs to, ring and aux cuts alike; -1 for a fallback crease's own ends. */
function folded3dFaceOfVertex(mesh: Folded3dMesh): Int32Array {
  const faceOfVertex = new Int32Array(Math.floor(mesh.positions.length / 3)).fill(-1);
  for (let slot = 0; slot < mesh.slots.count; slot += 1) {
    for (let v = mesh.slots.vertexStart[slot]!; v < mesh.slots.vertexStart[slot + 1]!; v += 1) {
      faceOfVertex[v] = mesh.slots.face[slot]!;
    }
  }
  return faceOfVertex;
}

const NO_PAPER: ReadonlySet<number> = new Set();

/**
 * A 3D mesh's drawn creases with their own paper: its slot's face, and the
 * face of every other crease along it. A fold is inked once by each layer
 * whose paper ends at it, so on screen it is one line whose own paper is all
 * of theirs; an aux cut lies inside its slot's face and is that face's alone.
 * Creases along one another are one group, whose ink is one line's.
 */
export function folded3dCreases(mesh: Folded3dMesh): {
  ownOf: (a: number, b: number) => ReadonlySet<number>;
  groupOf: (a: number, b: number) => number;
  /** Every drawn crease's ends as vertex indices, with its own paper. */
  edges: Array<{ a: number; b: number; own: ReadonlySet<number> }>;
} {
  const faceOfVertex = folded3dFaceOfVertex(mesh);
  const { edgeIndices, edgeAssignments } = mesh.topology;
  const p = mesh.positions;
  const at = (v: number): Vec => [p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!];
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  // One entry per distinct pair of ends: a slot's crease is in its skin's run and the translucent run both.
  const index = new Map<string, number>();
  const ends: Array<[number, number]> = [];
  for (let e = 0; e < edgeAssignments.length; e += 1) {
    if (edgeAssignments[e]! > EDGE_CODE.aux) continue;
    const a = edgeIndices[e * 2]!;
    const b = edgeIndices[e * 2 + 1]!;
    if (index.has(key(a, b))) continue;
    index.set(key(a, b), ends.length);
    ends.push([a, b]);
  }
  const radius = Math.max(mesh.radius, 1e-9);
  // A ten-thousandth of the radius: a hundred times the kernel's distance
  // tolerance (1e-6 relative), and far below any crease's length.
  const pairs = overlappingSegments(
    ends.map(([a, b]) => [at(a), at(b)] as const),
    radius * 1e-4,
    radius / 16
  );
  const own = ends.map(([a]) => new Set(faceOfVertex[a]! >= 0 ? [faceOfVertex[a]!] : []));
  const parent = ends.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  const faceOf = ends.map(([a]) => faceOfVertex[a]!);
  for (const [i, j] of pairs) {
    if (faceOf[j]! >= 0) own[i]!.add(faceOf[j]!);
    if (faceOf[i]! >= 0) own[j]!.add(faceOf[i]!);
    parent[root(i)] = root(j);
  }
  const found = (a: number, b: number) => index.get(key(a, b));
  return {
    ownOf: (a, b) => {
      const i = found(a, b);
      return i === undefined ? NO_PAPER : own[i]!;
    },
    groupOf: (a, b) => {
      const i = found(a, b);
      return i === undefined ? -2 : root(i);
    },
    edges: ends.map(([a, b], i) => ({ a, b, own: own[i]! })),
  };
}

/** One frame of a live view, replayed, with its lines' own paper and the check of it. */
export interface LiveFrame {
  frame: ReplayedFrame;
  lines: OwnPaperLine[];
  check: OwnPaperRecord;
}

/**
 * The live 3D view as Pose and Edit's window draw it, at any camera: the
 * mesh's worker payload (`folded3dMeshPayload`, so what is drawn is what it
 * packs) loaded into `FoldedMeshSource` on a recording canvas, and each frame
 * replayed from the draws `render` makes with `settings`. The depth mode,
 * crease bias and depth write, the passes and their order are whatever those
 * draws say.
 */
export function liveFolded3dView(
  mesh: Folded3dMesh,
  settings: RenderSettings
): { shaders: string | null; render: (camera: CameraUniforms) => LiveFrame } {
  const { payload } = folded3dMeshPayload(mesh);
  const { canvas, recording } = recordingCanvas();
  const source = FoldedMeshSource.create(canvas, payload);
  if (!source) throw new Error('the 3D figure did not load on the recording canvas');
  const faceOfVertex = folded3dFaceOfVertex(mesh);
  const indices = new Uint32Array(payload.faceIndices);
  const creases = folded3dCreases(mesh);
  return {
    shaders: recording.shaders(),
    render: (camera) => {
      recording.reset();
      source.render(camera, settings);
      const frame = replayFrame(recording, { faceOfTriangle: (t) => faceOfVertex[indices[t * 3]!] ?? -1 });
      const lines = frame.lines.map(
        (line): OwnPaperLine => ({
          role: roleOfCode(line.code),
          own: creases.ownOf(line.a, line.b),
          group: creases.groupOf(line.a, line.b),
          from: line.from,
          to: line.to,
          halfWidthPx: line.halfWidthPx,
          dashOn: line.dashOn,
        })
      );
      return { frame, lines, check: ownPaperCheck(frame, lines) };
    },
  };
}

/* ------------------------------------------------------------------------
 * The same check on a vector picture
 * --------------------------------------------------------------------- */

/** How wide a picture's line is drawn in its raster: the axis and a pixel either side. */
const PICTURE_HALF_WIDTH = 1;

/** A scene rasterised as its page shows it, with which scene item each ink index is. */
export interface PictureRaster extends PaperRaster {
  /** The scene item each ink index names. */
  lineItems: number[];
}

function fillRingsSized(
  width: number,
  height: number,
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  write: (at: number) => void
): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) for (const [, y] of ring) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const crossings: number[] = [];
  for (let row = Math.max(0, Math.ceil(minY - 0.5)); row <= Math.min(height - 1, Math.floor(maxY - 0.5)); row += 1) {
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
      const last = Math.min(width - 1, Math.floor(crossings[i + 1]! - 0.5));
      for (let col = first; col <= last; col += 1) write(row * width + col);
    }
  }
}

function stampSized(
  width: number,
  height: number,
  a: readonly [number, number],
  b: readonly [number, number],
  half: number,
  write: (at: number) => void
): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return;
  const steps = Math.max(1, Math.ceil(length * 2));
  const r = Math.ceil(half);
  for (let s = 0; s <= steps; s += 1) {
    const x = a[0] + (dx * s) / steps;
    const y = a[1] + (dy * s) / steps;
    for (let oy = -r; oy <= r; oy += 1) {
      for (let ox = -r; ox <= r; ox += 1) {
        if (ox * ox + oy * oy > half * half + 0.5) continue;
        const px = Math.floor(x + ox);
        const py = Math.floor(y + oy);
        if (px >= 0 && py >= 0 && px < width && py < height) write(py * width + px);
      }
    }
  }
}

/**
 * A scene's items in painter's order, as its page shows them: each face
 * covers what came before it, ink included, and hidden items are left out as
 * the painter leaves them out.
 */
export function pictureRaster(scene: PaperScene, width: number, height: number): PictureRaster {
  const face = new Int32Array(width * height).fill(-1);
  const side = new Int8Array(width * height);
  const ink = new Int32Array(width * height).fill(-1);
  const lineItems: number[] = [];
  scene.items.forEach((item, index) => {
    if (item.kind === 'face') {
      if (item.hidden) return;
      const front = item.side === 'front' ? 1 : -1;
      fillRingsSized(width, height, item.rings, (at) => {
        face[at] = item.face;
        side[at] = front;
        ink[at] = -1;
      });
    } else if (item.kind === 'line') {
      if (item.hidden) return;
      const id = lineItems.length;
      lineItems.push(index);
      stampSized(width, height, item.a, item.b, PICTURE_HALF_WIDTH, (at) => {
        ink[at] = id;
      });
    }
  });
  return { width, height, face, side, ink, lineItems };
}

/** A crease of the mesh a picture was built from, on that picture's projection, with its own paper. */
export interface PictureCrease {
  a: readonly [number, number];
  b: readonly [number, number];
  own: ReadonlySet<number>;
}

/**
 * Each line of a picture with its own paper: that of every crease of the
 * mesh it lies on, found by where it is on the picture's projection — a
 * piece the tree cut lies on its crease's straight screen segment. A picture
 * does not say which crease a line came from (and an older build's says less
 * than a newer one's), so both sides are read the same way.
 */
export function pictureLines(
  scene: PaperScene,
  raster: PictureRaster,
  creases: readonly PictureCrease[],
  tolerancePx = 0.25
): OwnPaperLine[] {
  const CELL = 16;
  const cells = new Map<string, number[]>();
  const cellKey = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  creases.forEach((crease, index) => {
    const length = Math.hypot(crease.b[0] - crease.a[0], crease.b[1] - crease.a[1]);
    const steps = Math.max(1, Math.ceil(length / (CELL / 2)));
    const marked = new Set<string>();
    for (let s = 0; s <= steps; s += 1) {
      const key = cellKey(
        crease.a[0] + ((crease.b[0] - crease.a[0]) * s) / steps,
        crease.a[1] + ((crease.b[1] - crease.a[1]) * s) / steps
      );
      if (marked.has(key)) continue;
      marked.add(key);
      const list = cells.get(key);
      if (list) list.push(index);
      else cells.set(key, [index]);
    }
  });
  const lies = (crease: PictureCrease, p: readonly [number, number]): boolean => {
    const dx = crease.b[0] - crease.a[0];
    const dy = crease.b[1] - crease.a[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return false;
    const along = ((p[0] - crease.a[0]) * dx + (p[1] - crease.a[1]) * dy) / length;
    const across = Math.abs((p[0] - crease.a[0]) * dy - (p[1] - crease.a[1]) * dx) / length;
    return across <= tolerancePx && along >= -tolerancePx && along <= length + tolerancePx;
  };
  const groups = new Map<string, number>();
  const pointKey = (p: readonly [number, number]) => `${Math.round(p[0] * 8)},${Math.round(p[1] * 8)}`;
  return raster.lineItems.map((itemIndex): OwnPaperLine => {
    const item = scene.items[itemIndex]!;
    if (item.kind !== 'line') throw new Error('a picture raster named a non-line item as ink');
    const own = new Set<number>();
    const seen = new Set<number>();
    const [cx, cy] = [Math.floor(item.a[0] / CELL), Math.floor(item.a[1] / CELL)];
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        for (const index of cells.get(`${cx + ox},${cy + oy}`) ?? []) {
          if (seen.has(index)) continue;
          seen.add(index);
          const crease = creases[index]!;
          if (lies(crease, item.a) && lies(crease, item.b)) for (const paper of crease.own) own.add(paper);
        }
      }
    }
    const ka = pointKey(item.a);
    const kb = pointKey(item.b);
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    let group = groups.get(key);
    if (group === undefined) groups.set(key, (group = groups.size));
    return { role: item.role, own, group, from: item.a, to: item.b, halfWidthPx: PICTURE_HALF_WIDTH };
  });
}

/** A 3D mesh's drawn creases on a camera's projection, with their own paper, for {@link pictureLines}. */
export function folded3dPictureCreases(
  mesh: Folded3dMesh,
  camera: CameraUniforms,
  creases: ReturnType<typeof folded3dCreases> = folded3dCreases(mesh)
): PictureCrease[] {
  const { screen } = projectVertices(mesh.positions, camera);
  return creases.edges.map(({ a, b, own }) => ({
    a: [screen[a * 2]!, screen[a * 2 + 1]!],
    b: [screen[b * 2]!, screen[b * 2 + 1]!],
    own,
  }));
}
