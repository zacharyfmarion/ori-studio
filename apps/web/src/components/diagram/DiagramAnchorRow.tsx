import { useTranslation } from 'react-i18next';
import type { ZoomAction } from '../../diagram/zoom/zoomActions';
import { FieldRow } from '../ui/fieldRows';
import { DiagramZoomVerb } from './DiagramZoomVerb';
import styles from './DiagramAnchorRow.module.css';

/**
 * The Anchor row in the Layers pane (Revision 2, Z9): an enlargement's — an
 * enlarge area's or an enlarged step's frame's: the rule it is anchored by,
 * Picked or Auto, and its verbs, Pick and, while picked, Reset. One line in
 * both states, so picking or resetting moves no row below it: the rule's
 * words are its tooltip, each target's own (`autoHint`, `pickedHint`).
 */
export function DiagramAnchorRow({
  picked,
  actions,
  editable,
  autoHint,
  pickedHint,
}: {
  picked: boolean;
  /** Pick, and Reset while picked (`buildAnchorActions`). */
  actions: readonly ZoomAction[];
  editable: boolean;
  /** What Auto anchors to: an enlargement's backmost face outside its frame. */
  autoHint: string;
  /** What Picked anchors to. */
  pickedHint: string;
}) {
  const { t } = useTranslation();
  return (
    <FieldRow label={t('panels:diagram.annotations.enlargeAnchor', 'Anchor')} kind="text" disabled={!editable}>
      <span className={styles.anchor}>
        <span className={styles.anchorRule} title={picked ? pickedHint : autoHint}>
          {picked ? t('panels:diagram.annotations.anchorPicked', 'Picked') : t('panels:diagram.annotations.anchorAuto', 'Auto')}
        </span>
        {actions.map((action) => (
          <DiagramZoomVerb key={action.id} action={action} />
        ))}
      </span>
    </FieldRow>
  );
}
