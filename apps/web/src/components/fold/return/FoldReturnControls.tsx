import { useTranslation } from 'react-i18next';
import { useFoldSessionState } from '../../../fold/session/useFoldSession';
import { foldReturnEntryLabel, foldReturnFailure } from '../../../fold/return/foldReturnWords';
import { useWorkspaceStore } from '../../../store/workspaceStore/store';
import { currentFoldPath, rebuildFoldStep } from '../../../fold/sequence/foldCommands';
import { Button } from '../../ui/Button';
import styles from './FoldReturn.module.css';

/**
 * A saved Unfold to step step on screen, in the Step pane: what it does, or
 * why it no longer replays; the way to the step it returns to; and Rebuild
 * unfold — the Unfold to step tool taken in hand to rebuild it in place
 * (`rebuildFoldStep`). Nothing for any other step.
 */
export function FoldReturnControls() {
  const { t } = useTranslation();
  const snapshot = useFoldSessionState((s) => s);
  const node = snapshot.sequence?.steps.find((n) => n.id === snapshot.cursor);
  if (!node?.op || node.op.kind !== 'unfold-to') return null;
  const target = node.op.target;
  const entries = currentFoldPath(snapshot).entries;
  const entry = entries.find((e) => e.id === target);
  const parent = node.parent ? snapshot.nodes.get(node.parent) : null;
  const refused = snapshot.nodes.get(node.id)?.refusal;
  return <div className={styles.controls}>
    <p>{refused ? foldReturnFailure(t, refused.code)
      : t('panels:fold.return.retain', 'Return to an earlier pose, keeping all creases.')}</p>
    <Button size="sm" disabled={!entry} onClick={() => useWorkspaceStore.getState().moveFoldCursor(target)}>
      {t('panels:fold.return.viewTarget', 'View target: {{target}}', { target: entry ? foldReturnEntryLabel(t, entry, entries) : '—' })}
    </Button>
    <Button size="sm" disabled={snapshot.readOnly || !parent?.state} onClick={() => rebuildFoldStep(node.id)}>
      {t('panels:fold.return.rebuild', 'Rebuild unfold')}
    </Button>
  </div>;
}
