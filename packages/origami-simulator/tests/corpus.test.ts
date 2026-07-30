import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareFoldModel } from '../src/prepare.js';
import type { FoldDocument, PreparedOrigamiModel } from '../src/types.js';

/**
 * Invariant checks over a private crease-pattern corpus.
 *
 * Real design files are not committed (see `tests/corpus/README.md`); point this
 * at a directory instead:
 *
 *   ORIGAMI_SIMULATOR_CORPUS_DIR=~/cps npx vitest run tests/corpus.test.ts
 *
 * It skips silently when the variable is unset, so CI stays green without it.
 *
 * `.osf` projects are read for a crease pattern that already carries faces. Most
 * do not -- the app infers those with `inferTopology`, which lives in apps/web and
 * cannot be imported here -- so a project whose FOLD projection is face-less is
 * counted as skipped rather than failed. To cover those, export them as `.fold`
 * with faces first.
 */
const CORPUS = process.env.ORIGAMI_SIMULATOR_CORPUS_DIR;

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (/\.(fold|osf)$/.test(entry)) found.push(full);
  }
  return found.sort();
}

function creasePatternsIn(path: string): FoldDocument[] {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!path.endsWith('.osf')) return raw?.vertices_coords ? [raw as FoldDocument] : [];
  const found: FoldDocument[] = [];
  for (const doc of raw.workspace?.documents ?? []) {
    const fold = doc.creasePattern?.foldProjection ?? doc.creasePattern?.sourceFold;
    if (fold?.faces_vertices?.length) found.push(fold as FoldDocument);
  }
  return found;
}

/** Driven creases the solver will silently ignore and the renderer never draws. */
function orphanedCreases(prepared: PreparedOrigamiModel): number {
  return prepared.edgesVertices.filter((_edge, index) => {
    const assignment = prepared.edgesAssignment[index];
    return (assignment === 'M' || assignment === 'V') && prepared.edgesFaces[index]?.length !== 2;
  }).length;
}

describe.skipIf(!CORPUS)('private crease-pattern corpus', () => {
  it('prepares every pattern without stranding a crease', () => {
    const failures: string[] = [];
    let checked = 0;
    let skipped = 0;

    for (const path of walk(CORPUS!)) {
      let patterns: FoldDocument[];
      try {
        patterns = creasePatternsIn(path);
      } catch (error) {
        failures.push(`${path}: unreadable -- ${(error as Error).message}`);
        continue;
      }
      if (!patterns.length) {
        skipped += 1;
        continue;
      }
      for (const fold of patterns) {
        let prepared: PreparedOrigamiModel;
        try {
          prepared = prepareFoldModel(fold);
        } catch (error) {
          failures.push(`${path}: ${(error as Error).message}`);
          continue;
        }
        checked += 1;
        const orphans = orphanedCreases(prepared);
        if (orphans) failures.push(`${path}: ${orphans} crease(s) with fewer than two faces`);
        if (!prepared.faceCount) failures.push(`${path}: prepared to zero faces`);
        const finite = prepared.originalPositions.every((value) => Number.isFinite(value));
        if (!finite) failures.push(`${path}: non-finite vertex position`);
      }
    }

    console.error(`corpus: ${checked} patterns checked, ${skipped} files without faces`);
    expect(failures).toEqual([]);
  });
});
