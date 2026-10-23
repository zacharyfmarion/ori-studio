import { useTranslation } from 'react-i18next';
import { useFoldSessionState } from '../../../fold/session/useFoldSession';
import { foldNodeDigest } from '../../../fold/document/foldDigest';
import { rebuildFoldStep } from '../../../fold/sequence/foldCommands';
import { useWorkspaceStore } from '../../../store/workspaceStore/store';
import { Button } from '../../ui/Button';
import styles from './FoldRepeat.module.css';

/**
 * A saved Repeat step on screen, in the Step pane: how many operations it
 * holds, whether its source steps have changed since, the way to them, and
 * Update from source steps — the Repeat tool taken in hand to rebuild it in
 * place (`rebuildFoldStep`). Nothing for any other step: Repeat itself is a
 * tool on the rail.
 */
export function FoldRepeatControls() {
  const { t } = useTranslation();
  const snapshot = useFoldSessionState((s) => s);
  const node = snapshot.sequence?.steps.find((n) => n.id === snapshot.cursor);
  const repeat = node?.op?.kind === 'repeat' ? node.op : null;
  if (!node || !repeat) return null;
  const sourceAvailable = snapshot.sequence?.steps.some((s) => s.id === repeat.source.first);
  const sourceChanged = snapshot.sequence && foldNodeDigest(snapshot.sequence, repeat.source.last) !== repeat.source.revision;
  return (
    <div className={styles.controls}>
      <p className={styles.message}>
        {t('panels:fold.repeat.savedCount', {
          count: repeat.steps.length,
          defaultValue_one: 'One operation, saved as a Repeat step.',
          defaultValue_other: '{{count}} operations, saved as one Repeat step.',
        })}
      </p>
      {sourceChanged && (
        <p className={styles.message}>
          {t('panels:fold.repeat.sourceChanged', 'Source steps changed. Update to rebuild this Repeat.')}
        </p>
      )}
      <Button
        size="sm"
        disabled={!sourceAvailable}
        onClick={() => useWorkspaceStore.getState().moveFoldCursor(repeat.source.first)}
      >
        {t('panels:fold.repeat.goSource', 'Go to source steps')}
      </Button>
      <Button
        size="sm"
        disabled={snapshot.readOnly || !sourceAvailable || !node.parent || !snapshot.nodes.get(node.parent)?.state}
        onClick={() => rebuildFoldStep(node.id)}
      >
        {t('panels:fold.repeat.update', 'Update from source steps')}
      </Button>
    </div>
  );
}
