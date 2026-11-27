import type { FoldCpOrigin } from '../fold/document/foldSequenceDocument';
import { foldCapOf, type FoldCap } from '../fold/foldCaps';
import type { FoldImportRefusal } from '../fold/io/foldImportRefusal';
import type { FoldImportBatchEnd } from '../fold/io/foldImportQueue';
import {
  ANALYTICS_EVENTS,
  bucketCount,
  COUNT_BUCKETS,
  FOLD_FACE_COUNT_BUCKETS,
  FOLD_STACK_DEPTH_BUCKETS,
} from './events';
import { track } from './runtime';

/**
 * An Import CP the dialog refused (plan D16, D18), as `fold refused`: the
 * engine's stable code (`import_*`), or the dialog's own (`unsupported_file`,
 * `no_folded_figure`, …) — never a file name, a point or a crease. A refusal
 * of a cap also says how far over it was, bucketed: the face count over the
 * face cap, the deepest stack over the stacking cap.
 */
export function trackFoldImportRefused(refusal: FoldImportRefusal): void {
  if (refusal.kind === 'local') {
    track(ANALYTICS_EVENTS.foldRefused, { code: refusal.code });
    return;
  }
  const body = refusal.refused.refusal;
  const cap = foldCapOf(body);
  track(ANALYTICS_EVENTS.foldRefused, { code: body.code, ...(cap ? capBucket(cap) : {}) });
}

/** How far over its cap a refusal was, as one bucketed property. */
function capBucket(cap: FoldCap): Record<string, string> {
  return cap.kind === 'faces'
    ? { face_count_bucket: bucketCount(cap.faceCount, FOLD_FACE_COUNT_BUCKETS) }
    : { stack_depth_bucket: bucketCount(cap.deepest, FOLD_STACK_DEPTH_BUCKETS) };
}

/**
 * A crease pattern became a Fold step (plan D16, D18). `origin` is the step's
 * own closed enum — a format, `sample`, `edit_folded_figure` or `project_cp`
 * (a Collapse from the project's Edit pattern) — never a file name. `action`
 * is `insert` for a new step and `update` for a Collapse updated in place
 * from its source pattern.
 */
export function trackFoldCpImported(origin: FoldCpOrigin, action: 'insert' | 'update' = 'insert'): void {
  track(ANALYTICS_EVENTS.foldCpImported, { origin, action });
}

/**
 * Import CP of several files ended (`foldImportQueue`), once per batch of two
 * or more: how many files it held and how many became steps, bucketed;
 * `finished` when every file was imported or skipped, `stopped` when it ended
 * part way; and whether the files were dropped or picked. Never a file name.
 */
export function trackFoldCpBatchEnded({ files, imported, outcome, via }: FoldImportBatchEnd): void {
  track(ANALYTICS_EVENTS.foldCpBatchEnded, {
    files: bucketCount(files, COUNT_BUCKETS),
    imported: bucketCount(imported, COUNT_BUCKETS),
    outcome,
    via,
  });
}

/** A Fold sequence was sent to Edit (plan D10, D18): there is one Send to Edit, so no property. */
export function trackFoldSequenceSentToEdit(): void {
  track(ANALYTICS_EVENTS.foldSequenceSentToEdit);
}

/** Where Fold steps were sent to the Diagram from: Fold's Send to Diagram, or the Diagram's Fold browser. */
export type FoldSentToDiagramVia = 'fold' | 'diagram_browser';

/**
 * How a pull from Fold treated steps a book draws as one: whether Merge
 * symmetric steps was on, whether it made any run one step, and whether any
 * such run folds paper rather than only creasing it
 * (`diagram/fold/foldStepMerge.ts`).
 */
export interface FoldSentToDiagramMerge {
  option: 'on' | 'off';
  merged: 'none' | 'some';
  mergedFolds: 'none' | 'some';
}

/** What the Fold browser's Split or Join did, to which kind of run: a mirror image, a turned copy, precreases and their Repeat. */
export type FoldMergeChange = { action: 'split' | 'join'; kind: 'mirror' | 'turn' | 'repeat' };

/** Fold steps became Diagram steps (plan D17), from where, one or many, and what merged: enums only. */
export function trackFoldStepSentToDiagram(
  via: FoldSentToDiagramVia,
  scope: 'one' | 'many',
  merge: FoldSentToDiagramMerge
): void {
  track(ANALYTICS_EVENTS.foldStepSentToDiagram, {
    via,
    scope,
    merge_precreases: merge.option,
    merged: merge.merged,
    merged_folds: merge.mergedFolds,
  });
}

/** The reader split a merged card in the Fold browser, or joined two: whether the offers are used, turned copies' especially. */
export function trackDiagramFoldMergeChanged({ action, kind }: FoldMergeChange): void {
  track(ANALYTICS_EVENTS.diagramFoldMergeChanged, { action, kind });
}
