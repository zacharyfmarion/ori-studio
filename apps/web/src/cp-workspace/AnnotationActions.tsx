import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowUpToLine, Trash2 } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { GestureSlider } from '../components/ui/GestureSlider';

/**
 * The controls common to every annotation kind: opacity, stacking order, and
 * delete. Composed by both the image and text floating toolbars so the shared
 * behaviors stay identical.
 *
 * The opacity slider records a single undo entry per adjustment. That protocol
 * lives in {@link GestureSlider}, shared with the suppression-region chip's
 * image menu and the Properties pane — which need exactly the same
 * one-entry-per-drag behaviour and would otherwise be copies of it.
 */
export function AnnotationActions({
  opacity,
  onOpacity,
  onGestureStart,
  onGestureCommit,
  onBringToFront,
  onSendToBack,
  onDelete,
}: {
  opacity: number;
  onOpacity: (value: number) => void;
  /** Opens the annotation layer's bracket; false refuses the drag. */
  onGestureStart: () => boolean | void;
  onGestureCommit: (label: string) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <label className="floating-toolbar__opacity" title={t('panels:imageInspector.opacity', 'Opacity')}>
        <span aria-hidden="true">{t('panels:imageInspector.opacity', 'Opacity')}</span>
        <GestureSlider
          min={0}
          max={100}
          value={Math.round(opacity * 100)}
          onChange={(percent) => onOpacity(percent / 100)}
          onGestureStart={onGestureStart}
          onGestureCommit={onGestureCommit}
          commitLabel={t('panels:imageInspector.adjustOpacity', 'Adjust opacity')}
        />
        <span aria-hidden="true">{Math.round(opacity * 100)}%</span>
      </label>
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
