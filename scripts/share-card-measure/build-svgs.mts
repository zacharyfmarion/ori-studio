/**
 * Step 1 of the share-card size measurement: corpus FOLD documents -> export SVGs.
 *
 * Runs the **real** export pipeline (`buildCreaseExportArtwork` + `composeCreaseExportSvg`)
 * with the share modal's option set, so what gets measured is what will ship. Rasterizing
 * has to happen in a browser — `canvas.toBlob` is the encoder we actually use — so this
 * writes SVGs and a manifest for `index.html` to pick up.
 *
 *   cargo run --release -p oristudio-cp --example export_corpus_fold -- <corpus> <folds>
 *   npx vite-node scripts/share-card-measure/build-svgs.mts -- <folds> <out>
 *
 * Then serve `<out>` with serve.mjs and open it in a browser.
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCreaseExportArtwork,
  composeCreaseExportSvg,
  DEFAULT_CREASE_EXPORT_OPTIONS,
} from '../../apps/web/src/lib/creaseExport';
import { segmentFoldDocument } from '../../apps/web/src/lib/creasePatternSegmentation';
import type { FoldDocument } from '../../apps/web/src/engine/types';

const [foldDir, outDir] = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
if (!foldDir || !outDir) {
  throw new Error('usage: build-svgs.mts <fold-dir> <out-dir>');
}

mkdirSync(join(outDir, 'svg'), { recursive: true });

interface IndexEntry {
  file: string;
  creases: number;
}

const index = JSON.parse(readFileSync(join(foldDir, 'index.json'), 'utf8')) as IndexEntry[];
const manifest: Array<{ svg: string; creases: number; width: number; height: number }> = [];

for (const [position, entry] of index.entries()) {
  const fold = JSON.parse(readFileSync(join(foldDir, entry.file), 'utf8')) as FoldDocument;
  let page;
  try {
    const segments = segmentFoldDocument(fold);
    // The share modal's options: defaults, no folded figure, and a title + author caption,
    // because the caption changes the page aspect and therefore how much the artwork is
    // scaled down to fit the card.
    const artwork = buildCreaseExportArtwork(fold, segments, {
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      segmentId: null,
    });
    page = composeCreaseExportSvg(artwork, {
      title: 'Bird base',
      subtitle: 'by Zachary Marion',
      description: '',
    });
  } catch (error) {
    console.warn(`skipped ${entry.file}: ${(error as Error).message}`);
    continue;
  }

  const name = `${String(position).padStart(4, '0')}.svg`;
  writeFileSync(join(outDir, 'svg', name), page.svg);
  manifest.push({
    svg: `svg/${name}`,
    creases: entry.creases,
    width: page.width,
    height: page.height,
  });
}

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest));
copyFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), join(outDir, 'index.html'));
console.log(`wrote ${manifest.length} SVGs to ${outDir}`);
