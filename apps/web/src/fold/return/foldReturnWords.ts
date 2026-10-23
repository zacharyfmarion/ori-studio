import type { TFunction } from 'i18next';
import type { FoldPathEntry } from '../sequence/foldSequencePath';

export function foldReturnFailure(t: TFunction, code: string): string {
  switch (code) {
    case 'return_source_changed':
      return t('panels:fold.return.changed', 'Earlier folds changed. Rebuild this unfold to review the new result.');
    case 'return_target_invalid':
      return t('panels:fold.return.invalidTarget', 'Choose an earlier step on this branch.');
    case 'return_limit':
      return t('panels:fold.return.limit', 'This crease history is too large to restore safely.');
    case 'return_unavailable':
    case 'return_state_unavailable':
      return t('panels:fold.return.unavailable', 'Wait for the earlier steps to finish replaying, then try again.');
    default:
      return t('panels:fold.return.refused', 'The engine could not restore this pose while preserving the crease history. No step was changed.');
  }
}

export function foldReturnEntryLabel(t: TFunction, entry: FoldPathEntry, entries: readonly FoldPathEntry[]): string {
  if (entry.id === null) return t('panels:fold.return.sheet', 'Starting sheet');
  if (entry.number !== null) return t('panels:fold.return.step', 'Step {{number}}', { number: entry.number });
  return t('panels:fold.return.turn', 'Turn after step {{number}}', {
    number: entries.slice(0, entries.indexOf(entry)).filter((e) => e.kind === 'fold').length,
  });
}
