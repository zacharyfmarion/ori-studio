#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeDecodedVertexRefinerVertices,
  type VertexRefinerBoundarySide,
  type VertexRefinerDecodedVertex,
  type VertexRefinerFrame,
  type VertexRefinerProposal,
} from '../../apps/web/src/lib/vertexRefinerPipeline';

type PackSample = {
  id: string;
  input_png: string;
  gt_graph: string;
  render_metadata?: string;
};

type Point = {
  x: number;
  y: number;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const boundarySides: VertexRefinerBoundarySide[] = ['top', 'right', 'bottom', 'left'];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packPath = resolve(root, options.pack);
  const debugRunPath = resolve(root, options.debugRun);
  const outDir = resolve(root, options.out);
  const outSamplesDir = resolve(outDir, 'samples');
  await mkdir(outSamplesDir, { recursive: true });

  const packRoot = dirname(packPath);
  const debugRoot = dirname(debugRunPath);
  const pack = JSON.parse(await readFile(packPath, 'utf8'));
  const debugRun = JSON.parse(await readFile(debugRunPath, 'utf8'));
  const debugById = new Map(
    (debugRun.samples ?? []).map((sample: { id: string }) => [sample.id, sample]),
  );

  const cropSize = numberOption(options.cropSize, 96);
  const mergeRadiusPx = numberOption(options.mergeRadiusPx, 5);
  const boundaryMergeRadiusPx = numberOption(options.boundaryMergeRadiusPx, 5);
  const minSupportFraction = numberOption(options.minSupportFraction, 0.25);
  const splitSameCropConflicts = booleanOption(options.splitSameCropConflicts, true);
  const splitMinSupportFraction = numberOption(options.splitMinSupportFraction, 0.5);
  const boundaryTolerancePx = numberOption(options.boundaryTolerancePx, 3);
  const rows = [];

  for (const packSample of pack.samples as PackSample[]) {
    const debugRow = debugById.get(packSample.id) as
      { ok?: boolean; debug?: string; frame?: VertexRefinerFrame } | undefined;
    if (!debugRow?.ok || !debugRow.debug) {
      rows.push({ id: packSample.id, ok: false, debug: null });
      continue;
    }
    const sourceDebug = JSON.parse(await readFile(resolve(debugRoot, debugRow.debug), 'utf8'));
    const proposals = sourceDebug.proposals as VertexRefinerProposal[];
    const frame = loadFrame(sourceDebug.frame ?? debugRow.frame);
    const gtGraph = JSON.parse(await readFile(resolve(packRoot, packSample.gt_graph), 'utf8'));
    const gtVertices = (gtGraph.vertices_px as [number, number][]).map(([x, y]) => ({ x, y }));
    const degrees = vertexDegrees(gtVertices.length, gtGraph.edges_vertices ?? []);
    const rawVertices = perfectRawVertices({
      gtVertices,
      degrees,
      proposals,
      frame,
      cropSize,
      boundaryTolerancePx,
    });
    const mergedVertices = mergeDecodedVertexRefinerVertices(rawVertices, proposals, {
      cropSize,
      radiusPx: mergeRadiusPx,
      boundaryRadiusPx: boundaryMergeRadiusPx,
      minSupport: 1,
      minSupportFraction,
      splitSameCropConflicts,
      splitMinSupportFraction,
    });
    const outSample = {
      ...sourceDebug,
      schema: 'oristudio/cp-vertex-refiner-perfect-merge-sample/v1',
      source_debug: resolve(debugRoot, debugRow.debug),
      perfect_merge_options: {
        crop_size: cropSize,
        merge_radius_px: mergeRadiusPx,
        boundary_merge_radius_px: boundaryMergeRadiusPx,
        min_support_fraction: minSupportFraction,
        split_same_crop_conflicts: splitSameCropConflicts,
        split_min_support_fraction: splitMinSupportFraction,
        boundary_tolerance_px: boundaryTolerancePx,
      },
      rawVertices,
      mergedVertices,
    };
    const samplePath = resolve(outSamplesDir, `${packSample.id}.json`);
    await writeFile(samplePath, `${JSON.stringify(outSample, null, 2)}\n`, 'utf8');
    rows.push({
      id: packSample.id,
      ok: true,
      debug: `samples/${packSample.id}.json`,
      proposal_count: proposals.length,
      raw_vertex_count: rawVertices.length,
      merged_vertex_count: mergedVertices.length,
      frame,
    });
    process.stdout.write(`${JSON.stringify(rows[rows.length - 1])}\n`);
  }

  await writeFile(
    resolve(outDir, 'run_manifest.json'),
    `${JSON.stringify(
      {
        schema: 'oristudio/cp-vertex-refiner-perfect-merge-run/v1',
        implementation: 'perfect-vertex-refiner-merge-simulation',
        generated_by: 'scripts/cp-detect/simulate-perfect-vertex-refiner-merge.ts',
        generated_at: new Date().toISOString(),
        source_debug_run: debugRunPath,
        pack: packPath,
        sample_count: rows.length,
        ok_count: rows.filter((row) => row.ok).length,
        samples: rows,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function perfectRawVertices(args: {
  gtVertices: Point[];
  degrees: number[];
  proposals: VertexRefinerProposal[];
  frame: VertexRefinerFrame;
  cropSize: number;
  boundaryTolerancePx: number;
}): VertexRefinerDecodedVertex[] {
  const vertices: VertexRefinerDecodedVertex[] = [];
  for (let vertexIndex = 0; vertexIndex < args.gtVertices.length; vertexIndex += 1) {
    const gt = args.gtVertices[vertexIndex];
    for (let cropIndex = 0; cropIndex < args.proposals.length; cropIndex += 1) {
      const proposal = args.proposals[cropIndex];
      if (!proposalContainsPoint(proposal, gt, args.cropSize)) continue;
      const side = boundarySideForPoint(gt, args.frame, proposal, args.boundaryTolerancePx);
      const [x, y] = side ? snapPointToFrame(gt, args.frame, side) : [gt.x, gt.y];
      vertices.push({
        x,
        y,
        score: 1,
        kind_id: side ? 2 : 1,
        kind: side ? 'boundary_contact' : 'interior_junction',
        degree_class: args.degrees[vertexIndex] ?? 0,
        degree: args.degrees[vertexIndex] ?? 0,
        ray_bins: [],
        boundary_side_id: side ? boundarySides.indexOf(side) : null,
        boundary_side: side,
        side_coordinate: side ? sideCoordinate(x, y, args.frame, side) : null,
        crop_index: cropIndex,
      });
    }
  }
  return vertices;
}

function proposalContainsPoint(
  proposal: VertexRefinerProposal,
  point: Point,
  cropSize: number,
): boolean {
  const half = cropSize / 2;
  return Math.abs(point.x - proposal.x) <= half && Math.abs(point.y - proposal.y) <= half;
}

function boundarySideForPoint(
  point: Point,
  frame: VertexRefinerFrame,
  proposal: VertexRefinerProposal,
  tolerancePx: number,
): VertexRefinerBoundarySide | null {
  const distances: Record<VertexRefinerBoundarySide, number> = {
    top: Math.abs(point.y - frame.y_min),
    right: Math.abs(point.x - frame.x_max),
    bottom: Math.abs(point.y - frame.y_max),
    left: Math.abs(point.x - frame.x_min),
  };
  const bestDistance = Math.min(...boundarySides.map((side) => distances[side]));
  if (bestDistance > tolerancePx) return null;
  const nearSides = boundarySides.filter((side) => distances[side] <= bestDistance + 0.5);
  for (const side of nearSides) {
    if (proposal.provenance.some((item) => item === `boundary_contact_${side}`)) {
      return side;
    }
  }
  return nearSides[0] ?? null;
}

function snapPointToFrame(
  point: Point,
  frame: VertexRefinerFrame,
  side: VertexRefinerBoundarySide,
): [number, number] {
  if (side === 'top') return [clamp(point.x, frame.x_min, frame.x_max), frame.y_min];
  if (side === 'right') return [frame.x_max, clamp(point.y, frame.y_min, frame.y_max)];
  if (side === 'bottom') return [clamp(point.x, frame.x_min, frame.x_max), frame.y_max];
  return [frame.x_min, clamp(point.y, frame.y_min, frame.y_max)];
}

function sideCoordinate(
  x: number,
  y: number,
  frame: VertexRefinerFrame,
  side: VertexRefinerBoundarySide,
): number {
  const spanX = Math.max(1, frame.x_max - frame.x_min);
  const spanY = Math.max(1, frame.y_max - frame.y_min);
  if (side === 'top' || side === 'bottom') return clamp01((x - frame.x_min) / spanX);
  return clamp01((y - frame.y_min) / spanY);
}

function vertexDegrees(vertexCount: number, edges: [number, number][]): number[] {
  const degrees = Array.from({ length: vertexCount }, () => 0);
  for (const edge of edges) {
    const [left, right] = edge;
    if (left >= 0 && left < degrees.length) degrees[left] += 1;
    if (right >= 0 && right < degrees.length) degrees[right] += 1;
  }
  return degrees;
}

function loadFrame(value: unknown): VertexRefinerFrame {
  if (!value || typeof value !== 'object') throw new Error('Missing frame');
  const frame = value as Partial<VertexRefinerFrame>;
  if (
    typeof frame.x_min !== 'number' ||
    typeof frame.y_min !== 'number' ||
    typeof frame.x_max !== 'number' ||
    typeof frame.y_max !== 'number'
  ) {
    throw new Error(`Unsupported frame: ${JSON.stringify(value)}`);
  }
  return {
    x_min: frame.x_min,
    y_min: frame.y_min,
    x_max: frame.x_max,
    y_max: frame.y_max,
  };
}

function numberOption(value: string | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanOption(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function parseArgs(args: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith('--')) throw new Error(`Unexpected positional argument: ${item}`);
    const key = item.slice(2).replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
    const next = args[index + 1];
    if (next === undefined || next.startsWith('--')) {
      options[key] = 'true';
    } else {
      options[key] = next;
      index += 1;
    }
  }
  if (!options.pack) throw new Error('Missing --pack');
  if (!options.debugRun) throw new Error('Missing --debug-run');
  if (!options.out) throw new Error('Missing --out');
  return options;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message ?? error}\n`);
  process.exit(1);
});
