import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowUpToLine, Trash2 } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { Slider } from '../components/ui/Slider';

/**
 * The controls common to every annotation kind: opacity, stacking order, and
 * delete. Composed by both the image and text floating toolbars so the shared
 * behaviors stay identical.
 *
 * The opacity slider records a single undo entry per adjustment: the first
 * `input` of a drag snapshots the pre-state (gesture start) and the native
 * `change` event (fired once on mouse release / per keyboard step, which a
 * pointer-up on a range thumb can swallow) commits it.
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
  const opacityRef = useRef<HTMLInputElement | null>(null);
  const opacitySessionRef = useRef(false);

  useEffect(() => {
    const el = opacityRef.current;
    if (!el) return;
    const onCommit = () => {
      if (!opacitySessionRef.current) return;
      opacitySessionRef.current = false;
      onGestureCommit(t('panels:imageInspector.adjustOpacity', 'Adjust opacity'));
    };
    el.addEventListener('change', onCommit);
    return () => el.removeEventListener('change', onCommit);
  }, [onGestureCommit, t]);

  const handleOpacityInput = useCallback(
    (percent: number) => {
      if (!opacitySessionRef.current) {
        onGestureStart();
        opacitySessionRef.current = true;
      }
      onOpacity(percent / 100);
    },
    [onGestureStart, onOpacity],
  );

  return (
    <>
      <label
        className="floating-toolbar__opacity"
        title={t('panels:imageInspector.opacity', 'Opacity')}
      >
        <span aria-hidden="true">{t('panels:imageInspector.opacity', 'Opacity')}</span>
        <Slider
          ref={opacityRef}
          min={0}
          max={100}
          value={Math.round(opacity * 100)}
          onChange={handleOpacityInput}
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
