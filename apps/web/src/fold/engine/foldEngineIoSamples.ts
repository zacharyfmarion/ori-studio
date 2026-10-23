/**
 * The crease patterns that ship with Fold as Import CP samples (plan D16):
 * small attributed FOLD files of traditional bases, kept with their
 * provenance in `tests/fixtures/fold-samples/` and bundled as text, as the
 * app's other samples are (`examples/catalog.ts`). An import of one is
 * stored with `origin: 'sample'`.
 *
 * Ids, not titles: the UI words each one.
 */

import pleatInEighths from '../../../../../tests/fixtures/fold-samples/pleat-in-eighths.fold?raw';
import preliminaryBase from '../../../../../tests/fixtures/fold-samples/preliminary-base.fold?raw';
import waterbombBase from '../../../../../tests/fixtures/fold-samples/waterbomb-base.fold?raw';
import type { FoldImportSource } from './foldEngineIoWire';

export type FoldSampleId = 'preliminary-base' | 'waterbomb-base' | 'pleat-in-eighths';

export interface FoldSample {
  id: FoldSampleId;
  text: string;
}

export const FOLD_SAMPLES: readonly FoldSample[] = [
  { id: 'preliminary-base', text: preliminaryBase },
  { id: 'waterbomb-base', text: waterbombBase },
  { id: 'pleat-in-eighths', text: pleatInEighths },
];

/** A sample as an import's source: its step records `origin: 'sample'`. */
export function foldSampleSource(sample: FoldSample): FoldImportSource {
  return { format: 'fold', sample: true, text: sample.text };
}
