import { ArrowDownToLine, ArrowUpToLine, Trash2 } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import type { CpImage, CpImageUpdate } from './images/cpImage';

/**
 * Floating controls for the selected reference image: opacity, z-order, and
 * delete. Shown only while the Images tool is active and an image is selected.
 * The opacity slider brackets its drag with gesture start/commit so a whole
 * slide is one undo entry.
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
  return (
    <div className="cp-image-inspector" role="toolbar" aria-label="Image controls">
      <label className="cp-image-inspector__opacity" title="Opacity">
        <span aria-hidden="true">Opacity</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(image.opacity * 100)}
          onPointerDown={onGestureStart}
          onChange={(event) => onUpdate({ opacity: Number(event.target.value) / 100 })}
          onPointerUp={() => onGestureCommit('Adjust opacity')}
          onKeyUp={() => onGestureCommit('Adjust opacity')}
        />
        <span aria-hidden="true">{Math.round(image.opacity * 100)}%</span>
      </label>
      <IconButton
        size="sm"
        variant="toolbar"
        title="Bring to front"
        onClick={onBringToFront}
      >
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
