/**
 * The starred tools, pinned below the crease types.
 *
 * # Why a bespoke section and not a catalogue group
 *
 * `cpRailGroups()` is a pure read of the shipped catalogue, shared with the
 * tablet rail. Making it depend on mutable user state would break that purity
 * and hand the rail a Favorites group we are not shipping there yet. Favorites
 * is a *view* of the catalogue, not a member of it, which is also why it has no
 * `OristudioCpActionGroupId`.
 *
 * # Reordering, and its keyboard equivalent
 *
 * Long press and drag. The gesture has no visible affordance, so it is not the
 * only route: each row also offers Move up / Move down, which is what
 * `DesignTabStrip` reached for and documents as the accessible equivalent of a
 * drag rather than a convenience. Here it is doing double duty, since it is also
 * the only route for anyone who never discovers the hold.
 *
 * Reorder-as-you-go, like that strip: the stored array permutes live and the DOM
 * follows, so there is no placeholder to manage and no drop indicator to keep in
 * sync with a list that is already showing the answer.
 *
 * # Empty means gone
 *
 * Un-star everything and the section unmounts rather than showing an empty-state
 * row. The stars in the groups below are how it comes back, they are visible on
 * every row, and a permanent instructional row would spend height on the surface
 * with the least of it.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { trackCpToolFavoritesReordered } from '../../analytics';
import { useLongPressReorder } from '../../hooks/useLongPressReorder';
import { cpActionLabel } from '../../i18n/cpVocab';
import type { OristudioCpActionDefinition, OristudioCpActionId } from '../../lib/oristudioCpActions';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { shortcutLabelForAction, type ShortcutResolution } from '../../keyboard/shortcuts';
import { cpFavoriteToolActions, useCpToolFavorites } from './cpToolFavorites';
import { CpToolPickerRow } from './CpToolPickerRow';
import { useCpToolFavoriteToggle } from './useCpToolFavoriteToggle';

/** The attribute favorites rows carry, and the only rows a drag will pick up. */
const FAVORITE_ATTRIBUTE = 'data-cp-favorite';

export function CpToolPickerFavorites({
  activeActionId,
  activeOperationId,
  shortcutResolution,
  onSelectAction,
}: {
  activeActionId: OristudioCpActionId | null;
  activeOperationId: OristudioCpOperationId | null;
  shortcutResolution: ShortcutResolution;
  onSelectAction: (action: OristudioCpActionDefinition) => void;
}) {
  const { t } = useTranslation();
  // Subscribed to for the re-render; the actions themselves are resolved from
  // the store so an id the catalogue has lost is dropped in one place.
  const { ids, move } = useCpToolFavorites();
  const actions = cpFavoriteToolActions();
  const toggleFavorite = useCpToolFavoriteToggle('picker-sheet');

  const reportReorder = useCallback(
    (toIndex: number, method: 'drag' | 'menu') => {
      trackCpToolFavoritesReordered({
        method,
        surface: 'picker-sheet',
        toIndex,
        favoriteCount: ids.length,
      });
    },
    [ids.length]
  );

  const { draggingId, handlers, consumeClick } = useLongPressReorder({
    itemAttribute: FAVORITE_ATTRIBUTE,
    onReorder: (id, toIndex) => move(id as OristudioCpActionId, toIndex),
    // Once per gesture, on release. `move` runs at pointer-move rate and would
    // otherwise emit dozens of events for one drag.
    onDragEnd: (_id, toIndex) => reportReorder(toIndex, 'drag'),
  });

  if (actions.length === 0) return null;

  const title = t('tools:cpToolPicker.favorites', 'Favorites');
  return (
    <section className="cp-tool-picker__group">
      <h3 className="cp-tool-picker__group-title">{title}</h3>
      <ul className="cp-tool-picker__list" aria-label={title}>
        {actions.map((action, index) => (
          // Namespaced, because this same action also renders in its own group
          // below and two identical keys in one tree is a collision.
          <CpToolPickerRow
            key={`favorite:${action.id}`}
            action={action}
            isActive={activeActionId === action.id}
            glyphOperationId={activeActionId === action.id ? activeOperationId : null}
            available={action.uiStatus === 'ready'}
            shortcutLabel={shortcutLabelForAction(action.id, shortcutResolution)}
            favorited
            onToggleFavorite={() => toggleFavorite(action.id)}
            onSelect={() => onSelectAction(action)}
            reorder={{ handlers, dragging: draggingId === action.id, consumeClick }}
            trailing={
              <CpToolMoveControls
                toolLabel={cpActionLabel(t, action)}
                index={index}
                canMoveUp={index > 0}
                canMoveDown={index < actions.length - 1}
                onMove={(toIndex) => {
                  move(action.id, toIndex);
                  reportReorder(toIndex, 'menu');
                }}
              />
            }
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * Move up / Move down, the keyboard-reachable half of the reorder.
 *
 * Rendered as real buttons in the row rather than hidden behind a context menu:
 * this surface is a phone, where there is no right-click to hide them behind,
 * and they double as the visible hint that the list is orderable at all — which
 * a long press with no affordance badly needs.
 */
function CpToolMoveControls({
  toolLabel,
  index,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  toolLabel: string;
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (toIndex: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <span className="cp-tool-picker__move">
      <button
        type="button"
        className="cp-tool-picker__move-button"
        aria-label={t('tools:cpToolPicker.moveFavoriteUp', 'Move {{tool}} up', { tool: toolLabel })}
        disabled={!canMoveUp}
        // The row owns a press-and-hold; a press starting here is not a drag.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onMove(index - 1);
        }}
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        className="cp-tool-picker__move-button"
        aria-label={t('tools:cpToolPicker.moveFavoriteDown', 'Move {{tool}} down', {
          tool: toolLabel,
        })}
        disabled={!canMoveDown}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onMove(index + 1);
        }}
      >
        <ChevronDown size={14} />
      </button>
    </span>
  );
}
