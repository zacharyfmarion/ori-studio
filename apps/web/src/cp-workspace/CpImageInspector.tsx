import { ArrowDownToLine, ArrowUpToLine, Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import type { CpImage, CpImageUpdate } from './images/cpImage';

/**
 * Floating controls for the selected reference image: opacity, lock, hide,
 * z-order, and delete. Shown only while the Images tool is active and an image
 * is selected. Discrete edits (buttons) record one undo entry each; the opacity
 * slider brackets its drag with gesture start/commit so a whole slide is one
 * entry.
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
  const discrete = (patch: CpImageUpdate, label: string) => {
    onGestureStart();
    onUpdate(patch);
    onGestureCommit(label);
  };

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
      <IconButton
        size="sm"
        variant="toolbar"
        title={image.hidden ? 'Show image' : 'Hide image'}
        aria-pressed={image.hidden}
        onClick={() => discrete({ hidden: !image.hidden }, image.hidden ? 'Show image' : 'Hide image')}
      >
        {image.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
      </IconButton>
      <IconButton
        size="sm"
        variant="toolbar"
        title={image.locked ? 'Unlock image' : 'Lock image'}
        aria-pressed={image.locked}
        onClick={() => discrete({ locked: !image.locked }, image.locked ? 'Unlock image' : 'Lock image')}
      >
        {image.locked ? <Lock size={14} /> : <LockOpen size={14} />}
      </IconButton>
      <IconButton size="sm" variant="toolbar" title="Delete image" onClick={onDelete}>
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}
