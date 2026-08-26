/**
 * One tool in the picker: a star, a glyph, a name and a description.
 *
 * # Two buttons, not one
 *
 * This row was a single `<button>` end to end until the star arrived. A control
 * nested inside a button is invalid HTML and the outer one takes the tap in
 * practice, so the star would have selected the tool it was meant to star. The
 * `<li>` is the flex container now, the star and the select target are siblings
 * in it, and the active treatment moved up to the row — otherwise its left bar
 * would draw between the star and the glyph rather than at the row's edge.
 *
 * # Shared by both places a tool appears
 *
 * A favorited tool keeps its row in its own group as well as showing up under
 * Favorites: starring is a shortcut, not a move, and a tool that vanished from
 * Draw when starred would make the sheet's structure shift underfoot. So this
 * renders in two lists, and `reorder` is the only difference between them.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { OristudioCpActionDefinition } from '../../lib/oristudioCpActions';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { cpActionLabel, cpActionTooltip } from '../../i18n/cpVocab';
import type { LongPressReorder } from '../../hooks/useLongPressReorder';
import { CpToolFavoriteToggle } from './CpToolFavoriteToggle';
import { CpToolGlyph } from './cpToolGlyph';

export interface CpToolPickerRowReorder {
  handlers: LongPressReorder['handlers'];
  dragging: boolean;
  /** True for the click that ends a drag — see {@link LongPressReorder.consumeClick}. */
  consumeClick: () => boolean;
}

export function CpToolPickerRow({
  action,
  isActive,
  glyphOperationId,
  available,
  shortcutLabel,
  favorited,
  onToggleFavorite,
  onSelect,
  reorder,
  trailing,
}: {
  action: OristudioCpActionDefinition;
  isActive: boolean;
  glyphOperationId: OristudioCpOperationId | null;
  available: boolean;
  shortcutLabel?: string;
  favorited: boolean;
  onToggleFavorite: () => void;
  onSelect: () => void;
  /** Present only in the Favorites section, which is the one list you can reorder. */
  reorder?: CpToolPickerRowReorder;
  /** Controls after the select target — the Favorites section's move buttons. */
  trailing?: ReactNode;
}) {
  const { t } = useTranslation();
  const label = cpActionLabel(t, action);
  return (
    <li
      className="cp-tool-picker__row"
      data-active={isActive || undefined}
      data-line-color={action.kind === 'line-type' ? action.lineColor : undefined}
      // How `useLongPressReorder` finds its rows and reads their ids. Absent
      // outside Favorites, so a drag can never pick up a row from a group.
      data-cp-favorite={reorder ? action.id : undefined}
      data-dragging={reorder?.dragging || undefined}
      {...reorder?.handlers}
    >
      <CpToolFavoriteToggle toolLabel={label} favorited={favorited} onToggle={onToggleFavorite} />
      <button
        type="button"
        className="cp-tool-picker__item"
        aria-disabled={!available}
        onClick={() => {
          // A press that became a drag is not also a selection. Without this,
          // holding a favorite to move it picks that tool and closes the sheet
          // the moment you let go.
          if (reorder?.consumeClick()) return;
          if (!available) return;
          onSelect();
        }}
      >
        <span className="cp-tool-picker__icon">
          <CpToolGlyph action={action} glyphOperationId={glyphOperationId} size={18} />
        </span>
        <span className="cp-tool-picker__text">
          <span className="cp-tool-picker__label">{label}</span>
          {/*
            The one-line description the tooltip carried, which on a fine pointer
            was the only place it appeared. There is room for it here, and "what
            does Parallel Alternating Lines mean" is the question the picker is
            open to answer.
          */}
          <span className="cp-tool-picker__hint">{cpActionTooltip(t, action)}</span>
        </span>
        {shortcutLabel && <kbd className="cp-tool-picker__shortcut">{shortcutLabel}</kbd>}
      </button>
      {trailing}
    </li>
  );
}
