import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { annotationColorLabel } from '../../diagram/annotate/annotateTools';
import { ANNOTATION_PALETTE, isAnnotationColor, paletteEntryOf } from '../../diagram/annotate/annotationColors';
import { openColorPicker } from '../ui/openColorPicker';
import { Select, SelectContent, SelectItem, SelectSwatch, SelectTrigger, SelectValue } from '../ui/Select';
import { FieldRowSelectTrigger } from '../ui/fieldRows/FieldRow';
import styles from './DiagramColorSelect.module.css';

/** Radix keeps `''` for "nothing chosen": the style's ink travels as this. */
const INK = 'ink';
/** The item that opens the engine's colour picker, which no colour is. */
const CUSTOM = 'custom';
/** Custom…'s swatch: every hue, so its name lines up with the colours' over it. */
const CUSTOM_SWATCH = 'conic-gradient(#e03131, #e8590c, #f2c94c, #2f9e44, #1971c2, #7048e8, #e03131)';

/** Each opening of the picker, numbered: every move of one pick is one change of a mark (`onChange`'s `pick`). Negative, so it never meets a text field's session. */
let picks = 0;

/**
 * The colour a solid line is drawn in (17a, RM2 of
 * `diagram-references-annotations.md`): Ink — the style's arrow ink, no
 * colour stored — References' magenta, five print colours, and Custom…,
 * which opens the engine's colour picker as a context menu's colour row does
 * (`ContextMenuColorItem`), the focus staying on the trigger. A colour picked
 * by hand shows as its own item, by its value, while it is the one chosen.
 * Each item is a swatch and a name, as Edit's text colour is.
 *
 * `rail` fills the rail's column under its Line Type; `row` is a Layers row's
 * select. `onChange` gets null for Ink, and while the picker is up, each
 * colour it moves to with `pick` naming that opening of it: the same for
 * every move, so a caller can make one undo step and one count of them.
 */
export function DiagramColorSelect({
  value,
  ink,
  label,
  variant,
  disabled = false,
  onChange,
}: {
  value: string | null;
  /** The style's arrow ink: Ink's swatch. */
  ink: string;
  /** The select's accessible name. */
  label: string;
  variant: 'rail' | 'row';
  disabled?: boolean;
  onChange: (color: string | null, pick?: number) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  // Custom… was chosen: the list's closing opens the picker too.
  const opening = useRef(false);
  const pick = useRef(0);
  // A palette colour stored in capitals is that colour, not one picked by hand; the file keeps it as written.
  const listed = value === null ? null : (paletteEntryOf(value)?.color ?? null);
  const custom = value !== null && listed === null ? value : null;
  const shown = <SelectValue />;
  return (
    <span className={styles.root} data-variant={variant}>
      <Select
        value={listed ?? custom ?? INK}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === CUSTOM) {
            opening.current = true;
            return;
          }
          onChange(next === INK ? null : next);
        }}
      >
        {variant === 'row' ? (
          <FieldRowSelectTrigger ref={trigger} aria-label={label}>
            {shown}
          </FieldRowSelectTrigger>
        ) : (
          <SelectTrigger ref={trigger} aria-label={label}>
            {shown}
          </SelectTrigger>
        )}
        <SelectContent
          // Every colour and Custom… in view: the shared cap cut Custom… in half, and hid it behind a colour picked by hand.
          fit="available"
          onCloseAutoFocus={(event) => {
            if (!opening.current || !input.current) return;
            opening.current = false;
            picks -= 1;
            pick.current = picks;
            // The focus stays on the trigger: a picker leaves it on its hidden input, which owns every key (`isShortcutEditingTarget`).
            event.preventDefault();
            trigger.current?.focus({ preventScroll: true });
            openColorPicker(input.current, { focusInput: false });
          }}
        >
          <SelectItem value={INK}>
            <SelectSwatch color={ink} />
            {annotationColorLabel(t, 'ink')}
          </SelectItem>
          {ANNOTATION_PALETTE.map((entry) => (
            <SelectItem key={entry.name} value={entry.color}>
              <SelectSwatch color={entry.color} />
              {annotationColorLabel(t, entry.name)}
            </SelectItem>
          ))}
          {custom !== null && (
            <SelectItem value={custom}>
              <SelectSwatch color={custom} />
              {custom}
            </SelectItem>
          )}
          <SelectItem value={CUSTOM}>
            <SelectSwatch color={CUSTOM_SWATCH} />
            {t('panels:diagram.annotations.colorCustom', 'Custom…')}
          </SelectItem>
        </SelectContent>
      </Select>
      {/* The engine's picker, laid invisibly over the trigger so it opens beside it; reached through Custom…, never by Tab. */}
      <input
        ref={input}
        className={styles.picker}
        type="color"
        tabIndex={-1}
        aria-hidden="true"
        value={value ?? ink}
        disabled={disabled}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (isAnnotationColor(next)) onChange(next, pick.current);
        }}
      />
    </span>
  );
}
