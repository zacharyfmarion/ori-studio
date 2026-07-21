import { useCallback, useEffect, useRef, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowUpToLine, Trash2 } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { FloatingToolbar, type FloatingAnchorRect } from '../components/ui/FloatingToolbar';
import type { CpImage, CpImageUpdate } from './images/cpImage';

/**
 * Floating controls for the selected reference image: opacity, z-order, and
 * delete. Hovers above the selected image via {@link FloatingToolbar}.
 *
 * The opacity slider records a single undo entry per adjustment: the first
 * `input` event of a drag snapshots the pre-state (gesture start) and the native
 * `change` event (which fires once on release for the mouse, and per-step for
 * the keyboard — unlike React's `onPointerUp`, which a native range thumb drag
 * can swallow) commits it.
 *
 * (Hide/lock live on the model for forward-compat but are intentionally not
 * surfaced here — those belong to the future general layer model.)
 */
export function CpImageInspector({
  image,
  anchorRect,
  onUpdate,
  onGestureStart,
  onGestureCommit,
  onBringToFront,
  onSendToBack,
  onDelete,
}: {
  image: CpImage;
  anchorRect: FloatingAnchorRect | null;
  onUpdate: (patch: CpImageUpdate) => void;
  onGestureStart: () => void;
  onGestureCommit: (label: string) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const opacityRef = useRef<HTMLInputElement | null>(null);
  const opacitySessionRef = useRef(false);

  // Commit on the native `change` event (reliable on release / per keyboard step).
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
    (event: ChangeEvent<HTMLInputElement>) => {
      // First input of a drag/keypress snapshots the pre-state for undo.
      if (!opacitySessionRef.current) {
        onGestureStart();
        opacitySessionRef.current = true;
      }
      onUpdate({ opacity: Number(event.target.value) / 100 });
    },
    [onGestureStart, onUpdate]
  );

  return (
    <FloatingToolbar
      anchorRect={anchorRect}
      className="cp-image-inspector"
      ariaLabel={t('panels:imageInspector.imageControls', 'Image controls')}
    >
      <label className="floating-toolbar__opacity" title={t('panels:imageInspector.opacity', 'Opacity')}>
        <span aria-hidden="true">{t('panels:imageInspector.opacity', 'Opacity')}</span>
        <input
          ref={opacityRef}
          type="range"
          min={0}
          max={100}
          value={Math.round(image.opacity * 100)}
          onChange={handleOpacityInput}
        />
        <span aria-hidden="true">{Math.round(image.opacity * 100)}%</span>
      </label>
      <IconButton size="sm" variant="toolbar" title={t('panels:imageInspector.bringToFront', 'Bring to front')} onClick={onBringToFront}>
        <ArrowUpToLine size={14} />
      </IconButton>
      <IconButton size="sm" variant="toolbar" title={t('panels:imageInspector.sendToBack', 'Send to back')} onClick={onSendToBack}>
        <ArrowDownToLine size={14} />
      </IconButton>
      <IconButton size="sm" variant="toolbar" title={t('panels:imageInspector.deleteImage', 'Delete image')} onClick={onDelete}>
        <Trash2 size={14} />
      </IconButton>
    </FloatingToolbar>
  );
}
