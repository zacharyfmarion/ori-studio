import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowUpToLine, Trash2 } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { AnnotationOpacitySlider } from './AnnotationOpacitySlider';

/**
 * The controls common to every annotation kind: opacity, stacking order, and
 * delete. Composed by both the image and text floating toolbars so the shared
 * behaviors stay identical.
 *
 * The opacity slider records a single undo entry per adjustment. That protocol
 * lives in {@link AnnotationOpacitySlider}, shared with the suppression-region
 * chip's image menu — which needs exactly the same one-entry-per-drag behaviour
 * and would otherwise be a second copy of it.
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
  onGestureStart: () => void;
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
        <AnnotationOpacitySlider
          opacity={opacity}
          onOpacity={onOpacity}
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
