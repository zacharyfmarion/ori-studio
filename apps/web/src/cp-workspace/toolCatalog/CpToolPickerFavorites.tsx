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
 * # Reordering
 *
 * Long press and drag, and nothing else. A pair of Move up / Move down buttons
 * shipped here first — `DesignTabStrip`'s answer, where they are the pointer-free
 * equivalent of its drag — and they were removed on purpose: this is the phone
 * surface, they spent 36px of a 375px row, and the two chevrons pushed most
 * descriptions onto a third line to offer a route for a keyboard the device does
 * not have. What that trade costs is real and worth writing down — with the
 * buttons gone, the drag is the only way to reorder, so VoiceOver, which claims
 * touch and cannot perform one, has none. The cheap fix if that matters later is
 * to bring them back visually hidden rather than to redesign the row.
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
import { useTranslation } from 'react-i18next';
import { trackCpToolFavoritesReordered } from '../../analytics';
import { useLongPressReorder } from '../../hooks/useLongPressReorder';
import type { OristudioCpActionDefinition, OristudioCpActionId } from '../../lib/oristudioCpActions';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { cpFavoriteToolActions, useCpToolFavorites } from './cpToolFavorites';
import { CpToolPickerRow } from './CpToolPickerRow';
import { useCpToolFavoriteToggle } from './useCpToolFavoriteToggle';

/** The attribute favorites rows carry, and the only rows a drag will pick up. */
const FAVORITE_ATTRIBUTE = 'data-cp-favorite';

export function CpToolPickerFavorites({
  activeActionId,
  activeOperationId,
  onSelectAction,
}: {
  activeActionId: OristudioCpActionId | null;
  activeOperationId: OristudioCpOperationId | null;
  onSelectAction: (action: OristudioCpActionDefinition) => void;
}) {
  const { t } = useTranslation();
  // Subscribed to for the re-render; the actions themselves are resolved from
  // the store so an id the catalogue has lost is dropped in one place.
  const { ids, move } = useCpToolFavorites();
  const actions = cpFavoriteToolActions();
  const toggleFavorite = useCpToolFavoriteToggle('picker-sheet');

  const { draggingId, handlers, consumeClick } = useLongPressReorder({
    itemAttribute: FAVORITE_ATTRIBUTE,
    onReorder: (id, toIndex) => move(id as OristudioCpActionId, toIndex),
    // Once per gesture, on release. `move` runs at pointer-move rate and would
    // otherwise emit dozens of events for one drag.
    onDragEnd: (_id, toIndex) =>
      trackCpToolFavoritesReordered({
        surface: 'picker-sheet',
        toIndex,
        favoriteCount: ids.length,
      }),
  });

  if (actions.length === 0) return null;

  const title = t('tools:cpToolPicker.favorites', 'Favorites');
  return (
    <section className="cp-tool-picker__group">
      <h3 className="cp-tool-picker__group-title">{title}</h3>
      <ul className="cp-tool-picker__list" aria-label={title}>
        {actions.map((action) => (
          // Namespaced, because this same action also renders in its own group
          // below and two identical keys in one tree is a collision.
          <CpToolPickerRow
            key={`favorite:${action.id}`}
            action={action}
            isActive={activeActionId === action.id}
            glyphOperationId={activeActionId === action.id ? activeOperationId : null}
            available={action.uiStatus === 'ready'}
            favorited
            onToggleFavorite={() => toggleFavorite(action.id)}
            onSelect={() => onSelectAction(action)}
            reorder={{ handlers, dragging: draggingId === action.id, consumeClick }}
          />
        ))}
      </ul>
    </section>
  );
}
