import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowUpToLine, Trash2 } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';

/**
 * The verbs common to every annotation kind's floating toolbar: stacking
 * order and delete. Adjectives — opacity, rotation — moved to the Properties
 * pane, which edits them through the same annotation bracket; what stays on
 * the toolbar is what has no value to show.
 */
export function AnnotationActions({
  onBringToFront,
  onSendToBack,
  onDelete,
}: {
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:imageInspector.bringToFront', 'Bring to front')}
        onClick={onBringToFront}
      >
        <ArrowUpToLine size={14} />
      </IconButton>
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:imageInspector.sendToBack', 'Send to back')}
        onClick={onSendToBack}
      >
        <ArrowDownToLine size={14} />
      </IconButton>
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:annotationActions.delete', 'Delete')}
        onClick={onDelete}
      >
        <Trash2 size={14} />
      </IconButton>
    </>
  );
}
