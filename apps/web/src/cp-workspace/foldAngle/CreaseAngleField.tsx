/**
 * The active crease angle on the viewport bar: an editable readout, and a caret
 * that opens {@link CreaseAnglePopover}.
 *
 * Both halves already exist on this bar in isolation — `ZoomReadout` is a value
 * that opens a preset list, `RotationField` is an editable numeric readout — and
 * this is the one control that wants both. The editing model is `RotationField`'s
 * verbatim, because the two fields have the same problem: they track a live value
 * while idle and must not be overwritten mid-keystroke.
 *
 * Fine pointers only, mounted by the panel through `only: 'fine'`. A coarse
 * pointer gets a single overflow-menu row that opens the popover, which is
 * already the touch-shaped form of this control.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp } from 'lucide-react';
import { useSelectAllOnClick } from '../../components/ui/useSelectAllOnClick';
import {
  formatCreaseAngle,
  formatCreaseAngleValue,
  isClassicCreaseAngle,
  parseCreaseAngle,
} from './activeCreaseAngle';

export interface CreaseAngleFieldProps {
  degrees: number;
  onChange: (degrees: number) => void;
  /** Open the popover. The panel owns whether it is mounted. */
  onOpenPopover: () => void;
  /** Resolved chord for the popover, shown in the caret's tooltip. */
  shortcutLabel?: string;
  /** Set on the wrapper so the popover can anchor to this control. */
  anchorRef?: (element: HTMLDivElement | null) => void;
}

export function CreaseAngleField({
  degrees,
  onChange,
  onOpenPopover,
  shortcutLabel,
  anchorRef,
}: CreaseAngleFieldProps) {
  const { t } = useTranslation();
  // Null while idle, so the field tracks the pen; a string while editing, so a
  // half-typed number is not overwritten from under the cursor.
  const [draft, setDraft] = useState<string | null>(null);
  const selectAllOnClick = useSelectAllOnClick();

  const label = t('tools:creaseAngle.title', 'Crease angle');
  const openLabel = shortcutLabel ? `${label} (${shortcutLabel})` : label;

  const commit = () => {
    if (draft === null) return;
    const parsed = parseCreaseAngle(draft);
    setDraft(null);
    // An unparseable or out-of-range entry reverts rather than resetting the
    // pen: `setDraft(null)` alone puts the live value back on screen.
    if (parsed !== null) onChange(parsed);
  };

  return (
    <div
      className="crease-angle-field"
      ref={anchorRef}
      // Says at a glance whether the pen is doing anything, which the number
      // alone does not — 180 and "off" are the same state.
      data-angled={isClassicCreaseAngle(degrees) ? undefined : true}
    >
      <input
        type="text"
        inputMode="decimal"
        className="crease-angle-field__input"
        aria-label={t('tools:creaseAngle.degrees', 'Crease angle in degrees')}
        title={t(
          'tools:creaseAngle.fieldTitle',
          'Fold angle given to new mountain and valley creases'
        )}
        value={draft ?? formatCreaseAngle(degrees)}
        onFocus={(event) => {
          // Drop the degree sign while editing so the field holds a plain
          // number, and select it so typing replaces the angle outright. That
          // covers Tab; a *click* needs `useSelectAllOnClick` as well, because
          // the mouseup that follows would otherwise collapse this to a caret.
          setDraft(formatCreaseAngleValue(degrees));
          event.currentTarget.select();
        }}
        {...selectAllOnClick}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(null);
            event.currentTarget.blur();
          }
          // Digits typed here cannot reach the canvas shortcuts:
          // `isShortcutEditingTarget` bails on any input at the capture-phase
          // listener, before dispatch.
        }}
        onBlur={commit}
      />
      <button
        type="button"
        className="crease-angle-field__caret"
        aria-haspopup="dialog"
        aria-label={openLabel}
        title={openLabel}
        onClick={onOpenPopover}
      >
        <ChevronUp size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
