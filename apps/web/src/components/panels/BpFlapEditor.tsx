import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OristudioBpFlap, OristudioBpSheet } from '../../engine/oristudioBpTypes';
import { bpPackingCanResizeFlap } from '../../lib/bpPackingViewport';
import { BpNameEditor } from './BpNameEditor';

/**
 * Contextual editor for a single selected BP flap, shown as the top-center pill
 * in the packing pane. Mirrors Box Pleating Studio's flap panel
 * (third_party/box-pleating-studio/src/app/vue/panel/flap.vue): Name, Radius,
 * Width, Height.
 *
 * - Radius is the flap/leaf length (min 1) and routes through the tree edge
 *   length; it is hidden when the flap has no source leaf edge.
 * - Width and Height (min 0) are the rectangular footprint. A value that would
 *   push more than one flap corner off the sheet is rejected client-side (the
 *   field snaps back) before any engine call, matching BP Studio's silent
 *   resize rejection and the engine's validate_flap_with_sheet.
 * - All three are integer grid units, capped at the sheet diameter.
 *
 * The numeric fields never take focus on their own (same rule as the name
 * field) and stop keydown propagation while focused, so arrow keys change the
 * number instead of nudging the flap and Delete/undo keep working on the canvas.
 */
export function BpFlapEditor({
  flap,
  namePlaceholder,
  nameAriaLabel,
  sheet,
  maxDimension,
  radiusValue,
  radiusMax,
  radiusEditable,
  onRename,
  onResize,
  onRadius,
  onEscape,
}: {
  flap: OristudioBpFlap;
  namePlaceholder?: string;
  nameAriaLabel: string;
  sheet: OristudioBpSheet;
  maxDimension: number;
  radiusValue: number;
  radiusMax: number | null;
  radiusEditable: boolean;
  onRename: (name: string) => void;
  onResize: (width: number, height: number) => Promise<boolean>;
  onRadius: (length: number) => Promise<boolean>;
  onEscape?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <BpNameEditor
      name={flap.name}
      placeholder={namePlaceholder}
      ariaLabel={nameAriaLabel}
      onRename={onRename}
      onEscape={onEscape}
    >
      {radiusEditable && (
        <BpFlapNumberField
          label={t('panels:bpPacking.flapRadius', 'R')}
          ariaLabel={t('panels:bpPacking.flapRadiusAria', 'Flap radius')}
          value={radiusValue}
          min={1}
          max={radiusMax ?? maxDimension}
          onCommit={onRadius}
        />
      )}
      <BpFlapNumberField
        label={t('panels:bpPacking.flapWidth', 'W')}
        ariaLabel={t('panels:bpPacking.flapWidthAria', 'Flap width')}
        value={flap.width}
        min={0}
        max={maxDimension}
        validate={(width) => bpPackingCanResizeFlap(flap.anchor, width, flap.height, sheet)}
        onCommit={(width) => onResize(width, flap.height)}
      />
      <BpFlapNumberField
        label={t('panels:bpPacking.flapHeight', 'H')}
        ariaLabel={t('panels:bpPacking.flapHeightAria', 'Flap height')}
        value={flap.height}
        min={0}
        max={maxDimension}
        validate={(height) => bpPackingCanResizeFlap(flap.anchor, flap.width, height, sheet)}
        onCommit={(height) => onResize(flap.width, height)}
      />
    </BpNameEditor>
  );
}

/**
 * A compact integer field in the flap pill. Commits a clamped, rounded value on
 * blur/Enter; reverts on Escape, on a non-numeric entry, or when `validate`
 * rejects the value (so an out-of-range resize snaps back). Reset on selection
 * is handled by keying the parent editor on the flap id.
 *
 * The commit is awaited: a successful edit updates `value` through props (the
 * effect below re-syncs the display), and one the engine rejects snaps the
 * field back to the real value — so the field can never show a value the model
 * did not accept, even if the client pre-check and the engine ever disagree.
 */
function BpFlapNumberField({
  label,
  ariaLabel,
  value,
  min,
  max,
  validate,
  onCommit,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  validate?: (value: number) => boolean;
  onCommit: (value: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(() => String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = async () => {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    if (clamped === value || (validate && !validate(clamped))) {
      setDraft(String(value));
      return;
    }
    setDraft(String(clamped));
    const accepted = await onCommit(clamped);
    if (!accepted) setDraft(String(value));
  };

  return (
    <label className="bp-flap-editor__field">
      <span className="bp-name-editor__label">{label}</span>
      <input
        className="bp-flap-editor__input"
        type="number"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        // Stop propagation so arrow keys edit the number instead of nudging the
        // selected flap, and Delete/undo shortcuts don't fire on the canvas.
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            commit();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
