/**
 * Star a tool, and report it.
 *
 * The two places a star appears — a tool's own group and the Favorites section —
 * would otherwise each hold a copy of "flip it, then work out which direction
 * that was and what the count is now". The direction is easy to get backwards
 * and the count is off by one in whichever copy forgets that the store has
 * already changed, so there is one of it.
 */
import { useCallback } from 'react';
import { trackCpToolFavorited, type CpFavoriteSurface } from '../../analytics';
import type { OristudioCpActionId } from '../../lib/oristudioCpActions';
import { cpToolFavoriteIds, isCpToolFavorite, toggleCpToolFavorite } from './cpToolFavorites';

export function useCpToolFavoriteToggle(
  surface: CpFavoriteSurface
): (actionId: OristudioCpActionId) => void {
  return useCallback(
    (actionId: OristudioCpActionId) => {
      const favorited = !isCpToolFavorite(actionId);
      toggleCpToolFavorite(actionId);
      // Read after the toggle, so the count is the state the user is now in
      // rather than the one they left.
      trackCpToolFavorited({
        actionId,
        favorited,
        surface,
        favoriteCount: cpToolFavoriteIds().length,
      });
    },
    [surface]
  );
}
