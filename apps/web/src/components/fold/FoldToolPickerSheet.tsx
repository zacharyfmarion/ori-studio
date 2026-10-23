import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { trackFoldToolFavoritesReordered } from '../../analytics';
import type { FoldRailGroup, FoldRailItem } from '../../fold/tools/foldRailGroups';
import {
  FOLD_TOOLBAR_FAVORITE_LIMIT,
  foldFavoriteItems,
  moveFoldToolFavorite,
  toggleFoldToolFavorite,
  useFoldToolFavoriteIds,
} from '../../fold/tools/foldToolFavorites';
import { ToolFavoriteToggle } from '../ui/tools/ToolFavoriteToggle';
import { ToolPickerFavorites } from '../ui/tools/ToolPickerFavorites';
import { ToolPickerGroup, ToolPickerList } from '../ui/tools/ToolPickerGroup';
import { ToolPickerRow, type ToolPickerRowReorder } from '../ui/tools/ToolPickerRow';
import { ToolPickerSheet } from '../ui/tools/ToolPickerSheet';
import { FoldToolGlyph } from './FoldToolGlyph';

/** The attribute a Favorites row carries, and the only rows a drag picks up. */
const FAVORITE_ATTRIBUTE = 'data-fold-favorite';

/**
 * Every Fold tool, named, for the phone layout, which has no rail: the same
 * `foldRailGroups()` the rail draws, as the app's tool sheet — a titled list
 * per group, each row a star, its glyph, its name and what it does, or why it
 * cannot. A pick closes the sheet, as Edit's and Simulate's do.
 *
 * Edit's sheet in Fold's terms: the starred tools head it (`ToolPickerFavorites`,
 * long press and drag to reorder), and the first of them are the canvas's
 * bottom bar. A starred tool keeps its row in its own group too: starring is a
 * shortcut, not a move.
 *
 * The sheet's body only; the Fold header's Tools pill (`FoldToolsTrigger`)
 * opens it and portals it to the page.
 */
export function FoldToolPickerSheet({
  pickerId,
  groups,
  close,
  modes,
}: {
  /** DOM id the trigger points `aria-controls` at, and this dialog wears. */
  pickerId: string;
  groups: readonly FoldRailGroup[];
  close: () => void;
  /** The sheet's modes row: the free-point latch, as Edit's sheet holds its Shift latch. */
  modes?: ReactNode;
}) {
  const { t } = useTranslation();
  // Read here rather than passed in, as Edit's sheet reads its own: a user
  // preference the trigger that mounts this knows nothing about.
  const ids = useFoldToolFavoriteIds();
  const starred = foldFavoriteItems(groups, ids);
  const starredIds = new Set(starred.map((item) => item.id));
  const favoritesTitle = t('tools:fold.picker.favorites', 'Favorites');

  const row = (item: FoldRailItem, reorder?: ToolPickerRowReorder) => (
    <ToolPickerRow
      // Namespaced in Favorites, where the same item also has its group's row.
      key={reorder ? `favorite:${item.id}` : item.id}
      label={item.label}
      description={item.reason ?? item.description}
      glyph={<FoldToolGlyph id={item.id} />}
      isActive={item.active}
      available={item.available}
      leading={
        <ToolFavoriteToggle
          label={
            starredIds.has(item.id)
              ? t('tools:fold.picker.removeFavorite', 'Remove {{tool}} from favorites', { tool: item.label })
              : t('tools:fold.picker.addFavorite', 'Add {{tool}} to favorites', { tool: item.label })
          }
          favorited={starredIds.has(item.id)}
          onToggle={() => toggleFoldToolFavorite(item.id)}
        />
      }
      onSelect={() => {
        item.select();
        close();
      }}
      reorder={reorder}
      data={{
        'data-fold-tool': reorder ? undefined : item.id,
        [FAVORITE_ATTRIBUTE]: reorder ? item.id : undefined,
      }}
    />
  );

  return (
    <ToolPickerSheet
      pickerId={pickerId}
      title={t('tools:fold.picker.title', 'Fold tools')}
      closeLabel={t('tools:fold.picker.close', 'Close tool list')}
      close={close}
      modes={modes}
    >
      <ToolPickerFavorites
        title={favoritesTitle}
        // `limit`, not `count`, as Edit's: `count` would make it a plural.
        hint={t(
          'tools:fold.picker.favoritesHint',
          'The first {{limit}} favorites here are shown in the bottom toolbar. Long press and drag to reorder.',
          { limit: FOLD_TOOLBAR_FAVORITE_LIMIT }
        )}
        ids={starred.map((item) => item.id)}
        itemAttribute={FAVORITE_ATTRIBUTE}
        onMove={moveFoldToolFavorite}
        onReordered={(toIndex) => trackFoldToolFavoritesReordered({ toIndex, favoriteCount: ids.length })}
        renderRow={(id, reorder) => {
          const item = starred.find((each) => each.id === id);
          return item ? row(item, reorder) : null;
        }}
      />
      {groups.map((group) => (
        <ToolPickerGroup key={group.id} title={group.label}>
          <ToolPickerList label={group.label}>{group.items.map((item) => row(item))}</ToolPickerList>
        </ToolPickerGroup>
      ))}
    </ToolPickerSheet>
  );
}
