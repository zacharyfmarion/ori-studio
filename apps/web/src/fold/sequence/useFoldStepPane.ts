import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { handleMenuAction } from '../../commands/menuActions';
import type { FoldBranchPosition, FoldPendingFold, FoldStepPaneStep, FoldStepStatus } from '../../components/fold/FoldStepPane';
import type { NoticeAction } from '../../components/ui/Notice';
import { isLockedStep } from '../document/foldSequenceDocument';
import { foldCommand } from '../foldActions';
import { FOLD_STEP_SUMMARY_QUERY } from '../session/foldStateQueries';
import { useFoldStateQuery } from '../session/useFoldSession';
import { foldActionsAt, foldCommandActionId } from './foldCommands';
import { foldCompoundPaneRows } from './foldCompoundRows';
import { foldedStepCount, type FoldEntryStatus, type FoldPathEntry } from './foldSequencePath';
import { foldCreaseDiff } from './foldStepDiff';
import type { FoldSequenceView } from './useFoldSequenceView';

/** A path entry's standing as the Step pane says it: a step still folding stands as it should, rows to come. */
function paneStatus(status: FoldEntryStatus): FoldStepStatus {
  return status === 'pending' ? 'ok' : status;
}

/** What the Step pane shows (`FoldStepPane`'s props), but the start side. */
export interface FoldStepPaneModel {
  step: FoldStepPaneStep | null;
  pending: FoldPendingFold | null;
  branch: FoldBranchPosition | null;
  fixes: NoticeAction[];
}

/** The number a fold made at `index` would follow: the last numbered entry up to it. */
function numberAt(entries: readonly FoldPathEntry[], index: number): number {
  for (let at = index; at >= 0; at -= 1) {
    const number = entries[at]?.number;
    if (number !== null && number !== undefined) return number;
  }
  return 0;
}

/**
 * The Step pane of the sequence on screen (plan D14): the step at the cursor
 * in the words the strip uses, the engine's summary of it — its layers, its
 * crease counts and what it changed — the step a tool is folding, where
 * folding would start a branch, and a broken step's way out (its Delete, as
 * the catalog words it).
 */
export function useFoldStepPane(view: FoldSequenceView): FoldStepPaneModel {
  const { t } = useTranslation();
  const { document, entries, frames, words, cursor, pending, readOnly } = view;
  const entry = entries[cursor];
  const summarised = useFoldStateQuery(entry?.id ? entry.session.state : null, FOLD_STEP_SUMMARY_QUERY);
  const pendingSummary = useFoldStateQuery(pending?.state ?? null, FOLD_STEP_SUMMARY_QUERY);
  const frame = frames[cursor] ?? null;

  return useMemo((): FoldStepPaneModel => {
    const node = entry?.node ?? null;
    const summary = summarised?.summary ?? null;
    const imported = node !== null && !isLockedStep(node) && node.op.kind === 'cp-jump' ? node.op : null;
    const compound = entry ? foldCompoundPaneRows(entry.session.compound) : undefined;
    // Its own refusal only: a step broken above it says so instead.
    const cap = entry?.status === 'broken' ? entry.session.refusal?.cap : undefined;
    const step: FoldStepPaneStep | null =
      entry && node
        ? {
            words: words[cursor] ?? { op: 'unknown' },
            number: entry.number,
            layers: summary?.layers ?? null,
            creases: summary?.counts ?? null,
            // An import replaces the crease pattern rather than changing it:
            // its pattern is the counts, and there is no change to list.
            diff: summary && !imported ? foldCreaseDiff(summary, frame?.creases ?? null) : null,
            status: paneStatus(entry.status),
            ...(cap ? { cap } : {}),
            ...(imported ? { origin: imported.origin } : {}),
            ...(compound ? { compound } : {}),
          }
        : null;
    const landedSummary = pendingSummary?.summary ?? null;
    const pendingFold: FoldPendingFold | null = pending
      ? {
          words: pending.words,
          diff: landedSummary ? foldCreaseDiff(landedSummary, pending.frame?.creases ?? null) : null,
          refused: pending.status === 'refused',
        }
      : null;
    const atTip = cursor === entries.length - 1;
    const remove = foldCommand(foldActionsAt(t, document, entries, cursor, readOnly), 'delete-step');
    return {
      step,
      pending: pendingFold,
      branch: atTip || pending?.branch === false ? null : { at: numberAt(entries, cursor), total: foldedStepCount(entries) },
      fixes:
        entry?.status === 'broken' && remove && !remove.disabled
          ? [
              {
                id: remove.id,
                label: remove.label,
                // Through the chokepoint, as the menus run it.
                run: () => void handleMenuAction(foldCommandActionId('delete-step')),
              },
            ]
          : [],
    };
  }, [t, document, entries, words, cursor, entry, summarised, frame, pending, pendingSummary, readOnly]);
}
