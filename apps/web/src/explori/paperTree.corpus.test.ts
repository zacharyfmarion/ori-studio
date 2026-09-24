import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exploriPaperPositions, exploriPatternMirror } from './paperTree';
import type { ExploriCp, ExploriGraph, ExploriSymmetry } from './types';

/**
 * Paper-position recovery over a slice of the local archive: the crease
 * pattern, packing and tree of the first tilings of every database, written by
 * `scripts/explori/export-local-packings.py`. Skipped when that artifact is not
 * there; see `scripts/explori/README.md`.
 *
 * Recovery is allowed to decline — a base with no single axis has no answer —
 * but never to answer wrongly, and it has to answer nearly always.
 */

// Vitest runs with `apps/web` as its root, so the repository root is two up.
const CORPUS = resolve(process.cwd(), '../../artifacts/explori/local-packings.json');
const available = existsSync(CORPUS);

interface Entry {
  N: number;
  symmetry: string;
  tilingId: number;
  cp: ExploriCp;
  packing: ExploriCp;
  tree: ExploriGraph;
}

describe.skipIf(!available)('paper positions over the local archive', () => {
  const entries = available
    ? (JSON.parse(readFileSync(CORPUS, 'utf8')) as { entries: Entry[] }).entries.filter(
        (entry) => entry.tree.nodes.length >= 4
      )
    : [];

  it('recovers a position for every node of nearly every tiling, and never throws', () => {
    const started = performance.now();
    let recovered = 0;
    const declined: string[] = [];
    for (const entry of entries) {
      const positions = exploriPaperPositions(entry.tree, entry.cp, entry.packing);
      if (positions && positions.size === entry.tree.nodes.length) recovered += 1;
      else declined.push(`${entry.N}${entry.symmetry[0]}.${entry.tilingId} (${entry.tree.nodes.length} nodes)`);
    }
    const elapsed = performance.now() - started;
    console.log(
      `paper positions: ${recovered} of ${entries.length} tilings recovered in ${elapsed.toFixed(0)} ms; declined: ${declined.join(', ') || 'none'}`
    );
    expect(recovered / entries.length).toBeGreaterThanOrEqual(0.97);
  });

  it('finds a mirror in every book and diag pattern but the one known to have none', () => {
    // 6b.1673 is book by database and mirrors across nothing — the case that
    // makes the pattern, not the database, the judge of whether a line is drawn.
    const NO_MIRROR = new Set(['6b.1673']);
    const missing: string[] = [];
    const found: string[] = [];
    for (const entry of entries) {
      if (entry.symmetry === 'none') continue;
      const label = `${entry.N}${entry.symmetry[0]}.${entry.tilingId}`;
      const mirror = exploriPatternMirror(entry.cp, entry.symmetry as ExploriSymmetry);
      if (NO_MIRROR.has(label)) {
        if (mirror) found.push(label);
      } else if (!mirror) missing.push(label);
    }
    expect(missing).toEqual([]);
    expect(found).toEqual([]);
    expect(entries.some((entry) => `${entry.N}${entry.symmetry[0]}.${entry.tilingId}` === '6b.1673')).toBe(true);
  });
});
