import { useCallback, useEffect, useRef, type ChangeEvent } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Trash2 } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import type { CpImage, CpImageUpdate } from './images/cpImage';

/**
 * Floating controls for the selected reference image: opacity, z-order, and
 * delete. Shown only while the Images tool is active and an image is selected.
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
  onUpdate,
  onGestureStart,
  onGestureCommit,
  onBringToFront,
  onSendToBack,
  onDelete,
}: {
  image: CpImage;
  onUpdate: (patch: CpImageUpdate) => void;
  onGestureStart: () => void;
  onGestureCommit: (label: string) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
}) {
  const opacityRef = useRef<HTMLInputElement | null>(null);
  const opacitySessionRef = useRef(false);

  // Commit on the native `change` event (reliable on release / per keyboard step).
  useEffect(() => {
    const el = opacityRef.current;
    if (!el) return;
    const onCommit = () => {
      if (!opacitySessionRef.current) return;
      opacitySessionRef.current = false;
      onGestureCommit('Adjust opacity');
    };
    el.addEventListener('change', onCommit);
    return () => el.removeEventListener('change', onCommit);
  }, [onGestureCommit]);

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
    <div className="cp-image-inspector" role="toolbar" aria-label="Image controls">
      <label className="cp-image-inspector__opacity" title="Opacity">
        <span aria-hidden="true">Opacity</span>
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
      <IconButton size="sm" variant="toolbar" title="Bring to front" onClick={onBringToFront}>
        <ArrowUpToLine size={14} />
      </IconButton>
      <IconButton size="sm" variant="toolbar" title="Send to back" onClick={onSendToBack}>
        <ArrowDownToLine size={14} />
      </IconButton>
      <IconButton size="sm" variant="toolbar" title="Delete image" onClick={onDelete}>
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}
