#!/usr/bin/env node
/**
 * Fold a crease pattern once, offline, and freeze the result as the 3D figure
 * the start screen turns.
 *
 * ## It is the real fold, not a simulation of one
 *
 * The geometry comes from `oristudio-cp`'s `Fold3dSession` — the exact folded
 * state the `G` key computes, with the kernel's own placement and layer
 * ordering. Not the origami simulator: that relaxes a spring model towards a
 * target and settles somewhere near it, which on a design with real fold angles
 * shows as softened creases and paper that never quite closes. The kernel
 * answers the same question exactly, and its answer is what the app draws
 * everywhere else.
 *
 * So this script is a pipeline, not a solver: extract the pattern, hand it to
 * the kernel, and store what comes back. What comes back is a
 * `Folded3dRenderModel`, the same payload an in-app folded figure is built
 * from, so the start screen runs the app's own mesh path over it rather than a
 * second one written for the welcome route.
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
 *   --orient 3.1236,1.2208,1.5508 --yaw 0 --pitch -1.5708
 *
 * # Swap in a different design: same command, different source. Get `--orient`
 * # from apps/web/start-figure-tuner.html rather than guessing it.
 * node scripts/generate-start-figure.mjs --source ~/designs/crane.fold \
 *   --out apps/web/public/start/crane-figure.json --orient 0,0,0 --pitch -1.5708
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
 * - `--solution N` — which layer ordering, 1-based. A folded state can have
 *   several; the penguin has eight, and `G` shows this one first.
 * - `--out PATH` — where to write the asset. Defaults to
 *   `apps/web/public/start/<source stem>-figure.json`.
 * - `--yaw R` / `--pitch R` — the resting view, in radians. `--pitch` should be
 *   −1.5708: that is the one pitch at which screen-up is the model's Y axis,
 *   which is the axis yaw turns about, so it is the only one where the figure
 *   turns like a turntable instead of swinging. The tuner emits it.
 * - `--orient RX,RY,RZ` — a fixed model-space rotation in radians, applied
 *   before the camera. This is what stands the figure up: the kernel hands back
 *   a figure in the paper's frame, where the paper normal is vertical, and a
 *   hero figure wants the design's own line of symmetry vertical instead. There
 *   is no way to derive it — for a folded form with no dominant long axis, which
 *   end is "up" is a fact about the design, not about the point cloud — so it is
 *   chosen by eye and recorded here.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFoldDocument } from './osf-fold-projection.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `usage: generate-start-figure.mjs --source <input.osf|input.fold>
  [--component N] [--document N] [--solution N] [--out PATH]
  [--yaw R] [--pitch R] [--orient RX,RY,RZ]`;

function parseArgs(argv) {
  const options = {
    source: null,
    component: null,
    document: 0,
    solution: 1,
    out: null,
    yaw: 0,
    pitch: -Math.PI / 2,
    orient: [0, 0, 0],
  };
  const numeric = {
    '--component': 'component',
    '--document': 'document',
    '--solution': 'solution',
    '--yaw': 'yaw',
    '--pitch': 'pitch',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') options.source = argv[(i += 1)];
    else if (arg === '--out') options.out = argv[(i += 1)];
    else if (arg === '--orient') {
      const parts = String(argv[(i += 1)])
        .split(',')
        .map(Number);
      if (parts.length !== 3 || !parts.every(Number.isFinite)) {
        throw new Error('--orient needs three comma-separated radians, e.g. 1.5708,0,0.28');
      }
      options.orient = parts;
    } else if (numeric[arg]) {
      const value = Number(argv[(i += 1)]);
      if (!Number.isFinite(value)) throw new Error(`${arg} needs a number`);
      options[numeric[arg]] = value;
    } else throw new Error(`${USAGE}\nunknown argument ${arg}`);
  }
  if (!options.source) throw new Error(USAGE);
  return options;
}

/**
 * Fold the pattern with the kernel and return its `Folded3dRenderModel`.
 *
 * Shelling out to the example rather than reimplementing anything: the fold, the
 * placement and the layer ordering are all `oristudio-cp`, and the one command
 * that emits a render model already exists. `--release` because a debug build of
 * the census is minutes rather than seconds on a model this size.
 */
function foldWithKernel(options) {
  const document = readFoldDocument(options.source, {
    document: options.document,
    component: options.component,
  });
  const scratch = mkdtempSync(join(tmpdir(), 'start-figure-'));
  try {
    const foldPath = join(scratch, 'pattern.fold');
    writeFileSync(foldPath, JSON.stringify(document));
    const json = execFileSync(
      'cargo',
      [
        'run',
        '--quiet',
        '--release',
        '-p',
        'oristudio-cp',
        '--example',
        'fold3d_render_model',
        '--',
        '--source',
        foldPath,
        '--solution',
        String(options.solution),
      ],
      { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    );
    return JSON.parse(json);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function defaultOut(source) {
  const stem = basename(source, extname(source));
  return join(REPO, 'apps/web/public/start', `${stem}-figure.json`);
}

function main(argv) {
  const options = parseArgs(argv);
  const model = foldWithKernel(options);
  if (model.undetermined_cells > 0) {
    // Not fatal — the renderer draws those cells translucent, which is the
    // honest way to show a stack whose order the kernel could not decide — but
    // a hero figure should not be the one model in the corpus that has them.
    process.stderr.write(
      `warning: ${model.undetermined_cells} cell(s) have an undecided layer order\n`,
    );
  }
  process.stderr.write(
    `folded ${basename(options.source)}: ${model.face_count} faces, ` +
      `${model.plane_count} planes, ${model.cell_count} cells, ${model.edge_count} creases ` +
      `(solution ${options.solution})\n`,
  );

  const asset = {
    version: 3,
    // Provenance, not decoration: the asset is the only thing committed, so if
    // nobody can tell what produced it, nobody can regenerate it.
    source: basename(options.source),
    solution: options.solution,
    view: {
      yaw: options.yaw,
      pitch: options.pitch,
      orient: options.orient,
    },
    model,
  };

  const out = resolve(options.out ?? defaultOut(options.source));
  mkdirSync(dirname(out), { recursive: true });
  const json = `${JSON.stringify(asset)}\n`;
  writeFileSync(out, json);
  process.stderr.write(`wrote ${out} (${(Buffer.byteLength(json) / 1024).toFixed(1)} KiB)\n`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
