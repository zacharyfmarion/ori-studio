#!/usr/bin/env node
/**
 * Fold a crease pattern once, offline, and freeze the result as the 3D figure
 * the start screen turns.
 *
 * The welcome screen shows a **folded form**, not a crease pattern, and it never
 * runs the solver: the geometry is computed here and committed as a small JSON
 * asset that the browser uploads to the GPU once. That is what makes an
 * always-animating hero cost a uniform change and a draw per frame.
 *
 * ## The crease pattern is an input, not a fixture
 *
 * The source `.osf` is **not** in this repository and must not be — the figure
 * we ship was designed by somebody else, and only the folded result is ours to
 * publish. Point `--source` at a file on disk (the non-flat corpus is the usual
 * home) and commit only what lands in `--out`.
 *
 * ## Usage
 *
 * ```sh
 * # The shipped figure. CORPUS is $ORISTUDIO_NON_FLAT_CORPUS_DIR.
 * node scripts/generate-start-figure.mjs \
 *   --source "$CORPUS/plant/penguin_other_angles.osf" --component 0 \
 *   --yaw 3.14159 --pitch -0.5
 *
 * # Swap in a different design: same command, different source.
 * node scripts/generate-start-figure.mjs --source ~/designs/crane.fold \
 *   --out apps/web/public/start/crane-figure.json --yaw 0.8 --pitch -0.4
 *
 * # Choose the angle first — a depth-buffered grid of candidate views.
 * node scripts/generate-start-figure.mjs --source … --contact-sheet /tmp/sheet.png
 * ```
 *
 * Then point the app at it: `START_FIGURE` in
 * `apps/web/src/components/start/startFigureAsset.ts`.
 *
 * ## Options
 *
 * - `--source PATH` — `.osf` project or `.fold` document. Required.
 * - `--component N` — keep the Nth connected component (descending vertex
 *   count). A canvas can hold several unrelated designs on one sheet.
 * - `--document N` — which `workspace.documents` entry of an `.osf` to read.
 * - `--out PATH` — where to write the asset. Defaults to
 *   `apps/web/public/start/<source stem>-figure.json`.
 * - `--yaw R` / `--pitch R` — the resting view, in radians, baked into the
 *   asset. Pick them from `--contact-sheet`.
 * - `--sweep R` — half-width of the auto-rotation, in radians (default 0.45).
 *   A full turn is deliberately not the default: most folded forms present
 *   nearly edge-on somewhere in a 360° sweep and read as a sliver there.
 * - `--steps N` — solver steps (default 20000). The default is measured, not
 *   guessed: the penguin's extent is stable from ~6k steps out to 30k.
 * - `--contact-sheet PATH` — write a PNG grid of candidate views instead of an
 *   asset, and exit.
 * - `--fold-percent P` — how far to fold (default 100).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import {
  OrigamiModel,
  ReferenceSolver,
  boundingRadius,
  centroid,
  prepareFoldModel,
} from '@treemaker/origami-simulator';
import { readFoldDocument } from './osf-fold-projection.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `usage: generate-start-figure.mjs --source <input.osf|input.fold>
  [--component N] [--document N] [--out PATH]
  [--yaw R] [--pitch R] [--sweep R] [--steps N] [--fold-percent P]
  [--contact-sheet PATH]`;

/**
 * Crease assignment codes, matching `EDGE_ASSIGNMENT_CODES` in
 * apps/web/src/simulator/simulatorSession.ts and the `a_assignment` attribute
 * the mesh renderer's edge shader indexes by. Anything else is dropped: the
 * renderer only draws 0..2, and shipping codes it ignores would put bytes in
 * the asset that can never become ink.
 */
const ASSIGNMENT_CODE = { B: 0, M: 1, V: 2, F: 3, U: 4 };

/** Coordinate precision. Three places on a unit-radius model is ~0.1% of span. */
const PRECISION = 4;

function parseArgs(argv) {
  const options = {
    source: null,
    component: null,
    document: 0,
    out: null,
    yaw: 0,
    pitch: -0.5,
    sweep: 0.45,
    steps: 20000,
    foldPercent: 100,
    contactSheet: null,
  };
  const numeric = {
    '--component': 'component',
    '--document': 'document',
    '--yaw': 'yaw',
    '--pitch': 'pitch',
    '--sweep': 'sweep',
    '--steps': 'steps',
    '--fold-percent': 'foldPercent',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') options.source = argv[(i += 1)];
    else if (arg === '--out') options.out = argv[(i += 1)];
    else if (arg === '--contact-sheet') options.contactSheet = argv[(i += 1)];
    else if (numeric[arg]) {
      const value = Number(argv[(i += 1)]);
      if (!Number.isFinite(value)) throw new Error(`${arg} needs a number`);
      options[numeric[arg]] = value;
    } else throw new Error(`${USAGE}\nunknown argument ${arg}`);
  }
  if (!options.source) throw new Error(USAGE);
  return options;
}

/** Fold the pattern and hand back everything both outputs need. */
function fold(options) {
  const document = readFoldDocument(options.source, {
    document: options.document,
    component: options.component,
  });
  const prepared = prepareFoldModel(document, {
    triangulate: true,
    foldUseAngles: true,
  });
  if (prepared.diagnostics.errors.length > 0) {
    throw new Error(
      `the pattern did not prepare: ${prepared.diagnostics.errors.join('; ')}`
    );
  }
  for (const warning of prepared.diagnostics.warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }

  const model = new OrigamiModel(prepared);
  // `timeStepScale` matches WHOLE_RUN_CONFIG in
  // apps/web/src/lib/simulatorRunConfig.ts, so the frozen form is the one the
  // app's own simulator would settle into rather than a second opinion.
  new ReferenceSolver(model, {
    foldPercent: options.foldPercent,
    timeStepScale: 0.35,
  }).step(options.steps);

  const positions = model.positions;
  for (let i = 0; i < positions.length; i += 1) {
    if (!Number.isFinite(positions[i])) {
      throw new Error(
        `the solve diverged at step ${options.steps} — lower --steps or --fold-percent`
      );
    }
  }
  return { prepared, positions };
}

/** Recentre on the centroid, so the asset needs no centre and orbits true. */
function centred(positions) {
  const centre = centroid(positions);
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = positions[i] - centre[0];
    out[i + 1] = positions[i + 1] - centre[1];
    out[i + 2] = positions[i + 2] - centre[2];
  }
  return out;
}

function round(value) {
  const factor = 10 ** PRECISION;
  return Math.round(value * factor) / factor;
}

function buildAsset(options, prepared, positions) {
  const centredPositions = centred(positions);
  const radius = boundingRadius(centredPositions, [0, 0, 0]);
  const edges = new Array(prepared.edgesVertices.length * 2);
  const assignments = new Array(prepared.edgesVertices.length);
  prepared.edgesVertices.forEach((edge, index) => {
    edges[index * 2] = edge[0];
    edges[index * 2 + 1] = edge[1];
    assignments[index] =
      ASSIGNMENT_CODE[prepared.edgesAssignment[index] ?? 'U'] ?? ASSIGNMENT_CODE.U;
  });

  return {
    version: 1,
    // Provenance, not decoration: the asset is the only thing committed, so if
    // nobody can tell what produced it, nobody can regenerate it.
    source: basename(options.source),
    vertexCount: prepared.vertexCount,
    positions: Array.from(centredPositions, round),
    indices: Array.from(prepared.indices),
    edges,
    assignments,
    radius: round(radius),
    view: {
      yaw: round(options.yaw),
      pitch: round(options.pitch),
      sweep: round(options.sweep),
    },
  };
}

function defaultOut(source) {
  const stem = basename(source, extname(source));
  return join(REPO, 'apps/web/public/start', `${stem}-figure.json`);
}

// --- the contact sheet --------------------------------------------------------

const SHEET_COLUMNS = 4;
const SHEET_CELL = 300;
const SHEET_BACKGROUND = [0x0e, 0x12, 0x16];
const SHEET_FRONT = [0xe8, 0xe0, 0x4a];
const SHEET_BACK = [0xf2, 0xf0, 0xe7];
/// The renderer's own inks: DEFAULT_MOUNTAIN_COLOR / DEFAULT_VALLEY_COLOR in
/// apps/web/src/simulator/simulatorPalette.ts, and the paper edge for a border.
/// Facet edges (F) and unassigned ones are absent because the mesh renderer
/// skips them too — they are triangulation diagonals, not folds.
const SHEET_CREASE_INK = {
  M: [0xdb, 0x1f, 0x24],
  V: [0x1c, 0x5c, 0xd9],
  B: [0x20, 0x24, 0x28],
};

const SHEET_LIGHT = (() => {
  const v = [-0.45, 0.58, 0.68];
  const length = Math.hypot(...v);
  return v.map((c) => c / length);
})();

/**
 * What the sheet shows, in two modes.
 *
 * With no `--yaw`, a coarse survey: a quarter-turn grid at three pitches, for
 * finding the side of the model worth looking at.
 *
 * With `--yaw`, the **sweep itself** — every cell a frame the auto-rotation will
 * actually reach, from `yaw - sweep` to `yaw + sweep`. That is the question that
 * matters once a pose is chosen, because a hero angle that reads beautifully can
 * still swing into an edge-on sliver by the end of its own travel, and no single
 * still would show it.
 */
function candidateViews(options) {
  const views = [];
  if (options.yaw === 0 && options.pitch === -0.5) {
    for (const pitch of [-0.3, -0.5, -0.75]) {
      for (let i = 0; i < SHEET_COLUMNS; i += 1) {
        views.push({ yaw: (i / SHEET_COLUMNS) * Math.PI * 2, pitch });
      }
    }
    return views;
  }
  const cells = SHEET_COLUMNS * 3;
  for (let i = 0; i < cells; i += 1) {
    const t = cells === 1 ? 0 : i / (cells - 1);
    views.push({
      yaw: options.yaw - options.sweep + t * 2 * options.sweep,
      pitch: options.pitch,
    });
  }
  return views;
}

/** The same orbit projection `webgl/camera.ts` computes uniforms for. */
function project(positions, view) {
  const cosYaw = Math.cos(view.yaw);
  const sinYaw = Math.sin(view.yaw);
  const cosPitch = Math.cos(view.pitch);
  const sinPitch = Math.sin(view.pitch);
  const points = [];
  for (let i = 0; i < positions.length; i += 3) {
    const yawX = cosYaw * positions[i] + sinYaw * positions[i + 2];
    const yawZ = -sinYaw * positions[i] + cosYaw * positions[i + 2];
    points.push({
      x: yawX,
      y: cosPitch * yawZ - sinPitch * positions[i + 1],
      depth: sinPitch * yawZ + cosPitch * positions[i + 1],
    });
  }
  return points;
}

function contactSheet(options, prepared, positions, radius) {
  const views = candidateViews(options);
  const rows = Math.ceil(views.length / SHEET_COLUMNS);
  const width = SHEET_COLUMNS * SHEET_CELL;
  const height = rows * SHEET_CELL;
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    pixels.set(SHEET_BACKGROUND, i * 3);
  }

  views.forEach((view, index) => {
    const originX = (index % SHEET_COLUMNS) * SHEET_CELL;
    const originY = Math.floor(index / SHEET_COLUMNS) * SHEET_CELL;
    const points = project(positions, view);
    const scale = (SHEET_CELL * 0.84) / (2 * radius);
    const sx = (p) => originX + SHEET_CELL / 2 + p.x * scale;
    const sy = (p) => originY + SHEET_CELL / 2 - p.y * scale;
    // A real depth buffer, not a painter's sort: a folded form stacks layers
    // that a centroid ordering interleaves wrongly, which is exactly the
    // artefact that would make a good angle look bad on the sheet.
    const depth = new Float32Array(SHEET_CELL * SHEET_CELL).fill(-Infinity);

    for (let t = 0; t < prepared.indices.length; t += 3) {
      const a = points[prepared.indices[t]];
      const b = points[prepared.indices[t + 1]];
      const c = points[prepared.indices[t + 2]];
      const ax = sx(a);
      const ay = sy(a);
      const bx = sx(b);
      const by = sy(b);
      const cx = sx(c);
      const cy = sy(c);
      const area = (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
      if (Math.abs(area) < 1e-6) continue;

      const base = area >= 0 ? SHEET_FRONT : SHEET_BACK;
      let nx = (b.y - a.y) * (c.depth - a.depth) - (b.depth - a.depth) * (c.y - a.y);
      let ny = (b.depth - a.depth) * (c.x - a.x) - (b.x - a.x) * (c.depth - a.depth);
      let nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      if (nz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const diffuse = Math.max(
        0,
        nx * SHEET_LIGHT[0] + ny * SHEET_LIGHT[1] + nz * SHEET_LIGHT[2]
      );
      const intensity = Math.min(1.08, Math.max(0.68, 0.74 + diffuse * 0.3 + nz * 0.04));
      const shade = base.map((channel) => Math.min(255, Math.round(channel * intensity)));

      const minX = Math.max(originX, Math.floor(Math.min(ax, bx, cx)));
      const maxX = Math.min(originX + SHEET_CELL - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(originY, Math.floor(Math.min(ay, by, cy)));
      const maxY = Math.min(originY + SHEET_CELL - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = (px - bx) * (cy - by) - (py - by) * (cx - bx);
          const w1 = (px - cx) * (ay - cy) - (py - cy) * (ax - cx);
          const w2 = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
          const inside =
            area > 0 ? w0 >= 0 && w1 >= 0 && w2 >= 0 : w0 <= 0 && w1 <= 0 && w2 <= 0;
          if (!inside) continue;
          const value =
            (w0 / area) * a.depth + (w1 / area) * b.depth + (w2 / area) * c.depth;
          const local = (y - originY) * SHEET_CELL + (x - originX);
          if (value < depth[local]) continue;
          depth[local] = value;
          pixels.set(shade, (y * width + x) * 3);
        }
      }
    }

    // Creases, depth-tested against the faces just drawn. Without them a folded
    // form reads as a solid blob and every angle looks equally bad — the linework
    // is most of what makes one view legible and another not, and the shipped
    // renderer draws it, so the sheet has to.
    prepared.edgesVertices.forEach((edge, index) => {
      const ink = SHEET_CREASE_INK[prepared.edgesAssignment[index]];
      if (!ink) return;
      const a = points[edge[0]];
      const b = points[edge[1]];
      const ax = sx(a);
      const ay = sy(a);
      const bx = sx(b);
      const by = sy(b);
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const x = Math.round(ax + (bx - ax) * t);
        const y = Math.round(ay + (by - ay) * t);
        if (x < originX || y < originY) continue;
        if (x >= originX + SHEET_CELL || y >= originY + SHEET_CELL) continue;
        const value = a.depth + (b.depth - a.depth) * t;
        const local = (y - originY) * SHEET_CELL + (x - originX);
        // A hair of bias, or a crease lying exactly in its own faces' plane
        // loses the depth test to them along its whole length.
        if (value < depth[local] - radius * 0.012) continue;
        pixels.set(ink, (y * width + x) * 3);
      }
    });
  });

  process.stderr.write(
    `${views
      .map(
        (view, index) =>
          `  cell ${index}: --yaw ${view.yaw.toFixed(4)} --pitch ${view.pitch.toFixed(2)}`
      )
      .join('\n')}\n`
  );
  return encodePng(pixels, width, height);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function encodePng(pixels, width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, y * width * 3, width * 3).copy(
      raw,
      y * (width * 3 + 1) + 1
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- entry point --------------------------------------------------------------

function main(argv) {
  const options = parseArgs(argv);
  const started = Date.now();
  const { prepared, positions } = fold(options);
  process.stderr.write(
    `folded ${basename(options.source)}: ${prepared.vertexCount} vertices, ` +
      `${prepared.indices.length / 3} triangles, ${prepared.edgesVertices.length} creases ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)}s\n`
  );

  if (options.contactSheet) {
    const centredPositions = centred(positions);
    const radius = boundingRadius(centredPositions, [0, 0, 0]);
    const png = contactSheet(options, prepared, centredPositions, radius);
    mkdirSync(dirname(resolve(options.contactSheet)), { recursive: true });
    writeFileSync(resolve(options.contactSheet), png);
    process.stderr.write(`wrote ${options.contactSheet}\n`);
    return;
  }

  const asset = buildAsset(options, prepared, positions);
  const out = resolve(options.out ?? defaultOut(options.source));
  mkdirSync(dirname(out), { recursive: true });
  const json = `${JSON.stringify(asset)}\n`;
  writeFileSync(out, json);
  process.stderr.write(
    `wrote ${out} (${(Buffer.byteLength(json) / 1024).toFixed(1)} KiB)\n`
  );
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
