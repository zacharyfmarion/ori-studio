// THROWAWAY Phase 0 spike — synthetic worst-case workload generator.
// Goal: faithfully approximate the real render load described in
// implementation-plans/webgl-canvas-workspace-migration.md:
//   - one geometry set of ~500k line segments (the whole-canvas soup)
//   - ~100 placed folded objects (translucent triangulated facets + edges)
// Not production code; deliberately self-contained.

export interface StrokeData {
  // Per-instance, tightly packed. One entry = one segment.
  a: Float32Array; // [x,y] * count
  b: Float32Array; // [x,y] * count
  color: Float32Array; // [r,g,b] * count (0..1)
  width: Float32Array; // px * count
  count: number;
}

export interface FillData {
  // Pre-ordered triangle soup (draw order == paint order for alpha blending).
  position: Float32Array; // [x,y] * verts
  color: Float32Array; // [r,g,b,a] * verts
  count: number; // vertex count (multiple of 3)
}

export interface WorkloadBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Workload {
  strokes: StrokeData;
  fills: FillData;
  bounds: WorkloadBounds;
  regionCount: number;
  segmentsPerRegion: number;
}

// Mountain/valley-ish palette (approx the app's MV colors).
const MV_COLORS: Array<[number, number, number]> = [
  [0.9, 0.25, 0.25], // mountain (red)
  [0.2, 0.45, 0.95], // valley (blue)
  [0.55, 0.55, 0.6], // aux/edge (grey)
];

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A single "CP region": a dense box-pleating-like hatch of segments inside a
// square, laid out at (ox, oy) with side `size`.
function fillRegionStrokes(
  s: StrokeData,
  base: number,
  segments: number,
  ox: number,
  oy: number,
  size: number,
  rnd: () => number
): void {
  // Box-pleating produces a grid of horizontal, vertical, and diagonal creases.
  // Approximate with a grid whose cells each get a few creases, so segment
  // density and orientation mix resemble a real dense CP.
  const grid = Math.max(2, Math.round(Math.sqrt(segments / 4)));
  const cell = size / grid;
  let i = base;
  const end = base + segments;
  let gx = 0;
  let gy = 0;
  while (i < end) {
    const x = ox + gx * cell;
    const y = oy + gy * cell;
    const patterns: Array<[number, number, number, number]> = [
      [x, y, x + cell, y], // horizontal
      [x, y, x, y + cell], // vertical
      [x, y, x + cell, y + cell], // diag
      [x + cell, y, x, y + cell], // anti-diag
    ];
    for (const [ax, ay, bx, by] of patterns) {
      if (i >= end) break;
      s.a[i * 2] = ax;
      s.a[i * 2 + 1] = ay;
      s.b[i * 2] = bx;
      s.b[i * 2 + 1] = by;
      const c = MV_COLORS[(Math.floor(rnd() * 3)) % 3];
      s.color[i * 3] = c[0];
      s.color[i * 3 + 1] = c[1];
      s.color[i * 3 + 2] = c[2];
      s.width[i] = 1.5;
      i++;
    }
    gx++;
    if (gx >= grid) {
      gx = 0;
      gy++;
      if (gy >= grid) gy = 0;
    }
  }
}

// A folded object: a stack of overlapping translucent quads (facets) near a
// region, plus opaque edge strokes appended to the stroke set.
function pushFoldedObject(
  fills: number[],
  fillColors: number[],
  edges: Array<[number, number, number, number]>,
  cx: number,
  cy: number,
  size: number,
  facets: number,
  rnd: () => number
): void {
  const front: [number, number, number] = [0.95, 0.85, 0.35];
  const back: [number, number, number] = [0.85, 0.6, 0.2];
  for (let f = 0; f < facets; f++) {
    const w = size * (0.25 + rnd() * 0.5);
    const h = size * (0.25 + rnd() * 0.5);
    const px = cx + (rnd() - 0.5) * size * 0.6;
    const py = cy + (rnd() - 0.5) * size * 0.6;
    const rot = rnd() * Math.PI;
    const cosr = Math.cos(rot);
    const sinr = Math.sin(rot);
    // quad corners
    const corners: Array<[number, number]> = [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ].map(([x, y]) => [px + x * cosr - y * sinr, py + x * sinr + y * cosr]);
    const isFront = rnd() > 0.5;
    const col = isFront ? front : back;
    const alpha = 0.5 + rnd() * 0.35; // translucent -> forces ordered blending
    // two triangles (0,1,2) (0,2,3)
    const tri = [corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]];
    for (const [x, y] of tri) {
      fills.push(x, y);
      fillColors.push(col[0], col[1], col[2], alpha);
    }
    // facet edges
    for (let e = 0; e < 4; e++) {
      const p = corners[e];
      const q = corners[(e + 1) % 4];
      edges.push([p[0], p[1], q[0], q[1]]);
    }
  }
}

export function generateWorkload(options?: {
  regionCount?: number;
  segmentsPerRegion?: number;
  facetsPerObject?: number;
  seed?: number;
}): Workload {
  const regionCount = options?.regionCount ?? 100;
  const segmentsPerRegion = options?.segmentsPerRegion ?? 5000;
  const facetsPerObject = options?.facetsPerObject ?? 90;
  const rnd = mulberry32(options?.seed ?? 12345);

  // Lay regions out in a grid on the world plane. Each region gets a CP on the
  // left and its folded object on the right (mirrors "folded figure next to CP").
  const cols = Math.ceil(Math.sqrt(regionCount));
  const regionSize = 400;
  const gap = 260; // room for the folded object beside each CP
  const pitchX = regionSize + gap;
  const pitchY = regionSize + 120;

  const strokeCount = regionCount * segmentsPerRegion;
  // reserve extra stroke slots for folded-object edges (4 per facet)
  const edgeReserve = regionCount * facetsPerObject * 4;
  const total = strokeCount + edgeReserve;

  const strokes: StrokeData = {
    a: new Float32Array(total * 2),
    b: new Float32Array(total * 2),
    color: new Float32Array(total * 3),
    width: new Float32Array(total),
    count: 0,
  };

  const fills: number[] = [];
  const fillColors: number[] = [];
  const edges: Array<[number, number, number, number]> = [];

  const bounds: WorkloadBounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };

  let writeIdx = 0;
  for (let r = 0; r < regionCount; r++) {
    const col = r % cols;
    const row = Math.floor(r / cols);
    const ox = col * pitchX;
    const oy = row * pitchY;
    fillRegionStrokes(strokes, writeIdx, segmentsPerRegion, ox, oy, regionSize, rnd);
    writeIdx += segmentsPerRegion;

    // folded object to the right of the CP
    const fcx = ox + regionSize + gap * 0.5;
    const fcy = oy + regionSize * 0.5;
    pushFoldedObject(fills, fillColors, edges, fcx, fcy, regionSize * 0.9, facetsPerObject, rnd);

    bounds.minX = Math.min(bounds.minX, ox);
    bounds.minY = Math.min(bounds.minY, oy);
    bounds.maxX = Math.max(bounds.maxX, ox + regionSize + gap);
    bounds.maxY = Math.max(bounds.maxY, oy + regionSize);
  }

  // append folded-object edges as opaque grey strokes
  for (const [ax, ay, bx, by] of edges) {
    const i = writeIdx;
    strokes.a[i * 2] = ax;
    strokes.a[i * 2 + 1] = ay;
    strokes.b[i * 2] = bx;
    strokes.b[i * 2 + 1] = by;
    strokes.color[i * 3] = 0.15;
    strokes.color[i * 3 + 1] = 0.12;
    strokes.color[i * 3 + 2] = 0.1;
    strokes.width[i] = 1.0;
    writeIdx++;
  }
  strokes.count = writeIdx;

  const fillData: FillData = {
    position: new Float32Array(fills),
    color: new Float32Array(fillColors),
    count: fills.length / 2,
  };

  return {
    strokes,
    fills: fillData,
    bounds,
    regionCount,
    segmentsPerRegion,
  };
}
