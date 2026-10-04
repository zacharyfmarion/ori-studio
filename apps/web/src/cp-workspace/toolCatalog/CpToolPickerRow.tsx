/**
 * One tool in the picker: a star, a glyph, a name and a description.
 *
 * Edit's content over the shared row (`ToolPickerRow`), which carries the
 * layout and the reasons for it.
 *
 * # Shared by both places a tool appears
 *
 * A favorited tool keeps its row in its own group as well as showing up under
 * Favorites: starring is a shortcut, not a move, and a tool that vanished from
 * Draw when starred would make the sheet's structure shift underfoot. So this
 * renders in two lists, and `reorder` is the only difference between them.
 */
import { useTranslation } from 'react-i18next';
import type { OristudioCpActionDefinition } from '../../lib/oristudioCpActions';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { cpActionLabel, cpActionTooltip } from '../../i18n/cpVocab';
import { ToolPickerRow, type ToolPickerRowReorder } from '../../components/ui/tools/ToolPickerRow';
import { CpToolFavoriteToggle } from './CpToolFavoriteToggle';
import { CpToolGlyph } from './cpToolGlyph';

export type CpToolPickerRowReorder = ToolPickerRowReorder;

export function CpToolPickerRow({
  action,
  isActive,
  glyphOperationId,
  available,
  favorited,
  onToggleFavorite,
  onSelect,
  reorder,
}: {
  action: OristudioCpActionDefinition;
  isActive: boolean;
  glyphOperationId: OristudioCpOperationId | null;
  available: boolean;
  favorited: boolean;
  onToggleFavorite: () => void;
  onSelect: () => void;
  /** Present only in the Favorites section, which is the one list you can reorder. */
  reorder?: CpToolPickerRowReorder;
}) {
  const { t } = useTranslation();
  const label = cpActionLabel(t, action);
  return (
    <ToolPickerRow
      label={label}
      // The one-line description the tooltip carried, which on a fine pointer
      // was the only place it appeared. There is room for it here, and "what
      // does Parallel Alternating Lines mean" is the question the picker is open
      // to answer.
      description={cpActionTooltip(t, action)}
      glyph={<CpToolGlyph action={action} glyphOperationId={glyphOperationId} size={18} />}
      isActive={isActive}
      available={available}
      leading={<CpToolFavoriteToggle toolLabel={label} favorited={favorited} onToggle={onToggleFavorite} />}
      onSelect={onSelect}
      reorder={reorder}
      data={{
        'data-line-color': action.kind === 'line-type' ? action.lineColor : undefined,
        // How `useLongPressReorder` finds its rows and reads their ids. Absent
        // outside Favorites, so a drag can never pick up a row from a group.
        'data-cp-favorite': reorder ? action.id : undefined,
      }}
    />
  );
}
