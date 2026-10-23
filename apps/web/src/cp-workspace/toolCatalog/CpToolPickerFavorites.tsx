/**
 * The starred crease-pattern tools, pinned below the crease types: Edit's rows
 * and words over the shared section (`ToolPickerFavorites`), which carries the
 * gesture and the reasons for its shape.
 */
import { useTranslation } from 'react-i18next';
import { trackCpToolFavoritesReordered } from '../../analytics';
import { ToolPickerFavorites } from '../../components/ui/tools/ToolPickerFavorites';
import type { OristudioCpActionDefinition, OristudioCpActionId } from '../../lib/oristudioCpActions';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import {
  CP_TOOLBAR_FAVORITE_LIMIT,
  cpFavoriteToolActions,
  useCpToolFavorites,
} from './cpToolFavorites';
import { CpToolPickerRow } from './CpToolPickerRow';
import { useCpToolFavoriteToggle } from './useCpToolFavoriteToggle';

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
  const actions = cpFavoriteToolActions(ids);
  const byId = new Map(actions.map((action) => [action.id, action]));
  const toggleFavorite = useCpToolFavoriteToggle('picker-sheet');

  return (
    <ToolPickerFavorites
      title={t('tools:cpToolPicker.favorites', 'Favorites')}
      // `limit`, not `count`: `count` is i18next's plural selector, and it
      // would split one sentence about a fixed number into a per-locale set
      // of plural forms — six of them in Russian — none of which this can
      // ever exercise.
      hint={t(
        'tools:cpToolPicker.favoritesHint',
        'The first {{limit}} favorites here are shown in the bottom toolbar. Long press and drag to reorder.',
        { limit: CP_TOOLBAR_FAVORITE_LIMIT }
      )}
      ids={actions.map((action) => action.id)}
      itemAttribute="data-cp-favorite"
      onMove={move}
      onReordered={(toIndex) =>
        trackCpToolFavoritesReordered({
          surface: 'picker-sheet',
          toIndex,
          favoriteCount: ids.length,
        })
      }
      renderRow={(id, reorder) => {
        const action = byId.get(id);
        if (!action) return null;
        return (
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
            reorder={reorder}
          />
        );
      }}
    />
  );
}
