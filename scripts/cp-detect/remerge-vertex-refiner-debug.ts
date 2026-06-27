#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeDecodedVertexRefinerVertices,
  type VertexRefinerDecodedVertex,
  type VertexRefinerProposal,
} from '../../apps/web/src/lib/vertexRefinerPipeline';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const debugRunPath = resolve(root, options.debugRun);
  const debugRoot = dirname(debugRunPath);
  const debugRun = JSON.parse(await readFile(debugRunPath, 'utf8'));
  const outDir = resolve(root, options.out);
  const outSamplesDir = resolve(outDir, 'samples');
  await mkdir(outSamplesDir, { recursive: true });

  const rows = [];
  for (const row of debugRun.samples ?? []) {
    if (!row.ok || !row.debug) {
      rows.push({ ...row, ok: false, debug: null });
      continue;
    }
    const sourcePath = resolve(debugRoot, row.debug);
    const sample = JSON.parse(await readFile(sourcePath, 'utf8'));
    const cropSize = Number(options.cropSize ?? sample.manifest?.inference?.crop_size ?? sample.options?.crop_size ?? 96);
    const mergedVertices = mergeDecodedVertexRefinerVertices(
      sample.rawVertices as VertexRefinerDecodedVertex[],
      sample.proposals as VertexRefinerProposal[],
      {
        cropSize,
        radiusPx: numberOption(options.mergeRadiusPx, 5),
        boundaryRadiusPx: numberOption(options.boundaryMergeRadiusPx, 5),
        minSupport: numberOption(options.minSupport, 1),
        minSupportFraction: numberOption(options.minSupportFraction, 0.25),
      },
    );
    const outSample = {
      ...sample,
      schema: 'oristudio/cp-vertex-refiner-debug-sample/v1',
      source_debug: sourcePath,
      remerge_options: {
        crop_size: cropSize,
        merge_radius_px: numberOption(options.mergeRadiusPx, 5),
        boundary_merge_radius_px: numberOption(options.boundaryMergeRadiusPx, 5),
        min_support: numberOption(options.minSupport, 1),
        min_support_fraction: numberOption(options.minSupportFraction, 0.25),
      },
      mergedVertices,
    };
    const sampleDebugPath = resolve(outSamplesDir, `${row.id}.json`);
    await writeFile(sampleDebugPath, `${JSON.stringify(outSample, null, 2)}\n`, 'utf8');
    rows.push({
      id: row.id,
      ok: true,
      debug: `samples/${row.id}.json`,
      manifest_id: sample.manifestId ?? row.manifest_id ?? null,
      proposal_count: sample.proposals?.length ?? row.proposal_count ?? null,
      raw_vertex_count: sample.rawVertices?.length ?? row.raw_vertex_count ?? null,
      merged_vertex_count: mergedVertices.length,
      frame: sample.frame ?? row.frame ?? null,
    });
    process.stdout.write(`${JSON.stringify(rows[rows.length - 1])}\n`);
  }

  const runManifest = {
    ...debugRun,
    schema: 'oristudio/cp-vertex-refiner-debug-run/v1',
    implementation: 'offline-vertex-refiner-remerge',
    generated_by: 'scripts/cp-detect/remerge-vertex-refiner-debug.ts',
    generated_at: new Date().toISOString(),
    source_debug_run: debugRunPath,
    sample_count: rows.length,
    ok_count: rows.filter((row) => row.ok).length,
    samples: rows,
  };
  await writeFile(resolve(outDir, 'run_manifest.json'), `${JSON.stringify(runManifest, null, 2)}\n`, 'utf8');
}

function numberOption(value: string | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseArgs(args: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${item}`);
    }
    const key = item.slice(2).replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
    const next = args[index + 1];
    if (next === undefined || next.startsWith('--')) {
      options[key] = 'true';
    } else {
      options[key] = next;
      index += 1;
    }
  }
  if (!options.debugRun) throw new Error('Missing --debug-run');
  if (!options.out) throw new Error('Missing --out');
  return options;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message ?? error}\n`);
  process.exit(1);
});
