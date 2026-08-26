/**
 * The starred tools, as the phone's bottom toolbar.
 *
 * # Why the bar is the right place for them
 *
 * The phone layout has no tool rail, so before this the bar carried view
 * controls — zoom, fit, rotate — and picking a tool meant opening the sheet and
 * scrolling. That is backwards for the thing you do most: a pinch already zooms
 * and already fits, while nothing at all stands in for "switch to the eraser".
 * So the bar spends its one row on tools, and the view controls it displaced
 * fall into the overflow menu it already had (see `phoneViewControls`).
 *
 * # Capped, and the cap is visible
 *
 * {@link CP_TOOLBAR_FAVORITE_LIMIT} of them, in the user's own order — which is
 * what makes the drag in the sheet worth having, since it is the only way to
 * decide *which* six a long list puts on the bar. The sheet says so in as many
 * words rather than leaving someone to notice that their seventh star did
 * nothing.
 *
 * # A group, not a bar of its own
 *
 * It goes through `groups` like every other surface's controls, so it inherits
 * the wrap behaviour, the separator between runs, and the overflow trigger
 * without any of them being reimplemented here. `pinned` keeps it inline where
 * an unpinned action would collapse into the very menu it just displaced.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ViewportToolbarGroupSpec } from '../../components/panels/viewportToolbarLayout';
import { cpActionLabel } from '../../i18n/cpVocab';
import type {
  OristudioCpActionDefinition,
  OristudioCpActionId,
} from '../../lib/oristudioCpActions';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { CP_TOOLBAR_FAVORITE_LIMIT, cpFavoriteToolActions, useCpToolFavorites } from './cpToolFavorites';
import { CpToolGlyph } from './cpToolGlyph';

export function useCpFavoriteToolbarGroup({
  enabled,
  activeActionId,
  activeOperationId,
  onSelectAction,
}: {
  /** False everywhere but the phone layout, where the rail is absent. */
  enabled: boolean;
  activeActionId: OristudioCpActionId | null;
  /**
   * The operation the active tool would run. For a merged tool this is the
   * variant its mode currently names, so the bar draws the same glyph the rail
   * would — see `cpToolSurface`.
   */
  activeOperationId: OristudioCpOperationId | null;
  onSelectAction: (action: OristudioCpActionDefinition) => void;
}): ViewportToolbarGroupSpec | null {
  const { t } = useTranslation();
  // `ids` is the dependency, not the resolved actions: the store hands back the
  // same array identity until something changes it, whereas
  // `cpFavoriteToolActions()` builds a fresh one per call and would defeat the
  // memo on every render of a bar that re-renders on every camera frame.
  const { ids } = useCpToolFavorites();

  return useMemo(() => {
    if (!enabled) return null;
    const shown = cpFavoriteToolActions(ids).slice(0, CP_TOOLBAR_FAVORITE_LIMIT);
    if (shown.length === 0) return null;
    return {
      id: 'cp-favorites',
      items: shown.map((action) => ({
        kind: 'action' as const,
        id: `favorite-${action.id}`,
        label: cpActionLabel(t, action),
        icon: <CpToolGlyph
          action={action}
          glyphOperationId={activeActionId === action.id ? activeOperationId : null}
          size={14}
        />,
        // Renders pressed inline, which is the only place a phone says which
        // tool is armed now that the rail is gone. The Tools pill says it too,
        // but that is off to the side and shows one glyph rather than a set.
        checked: activeActionId === action.id,
        disabled: action.uiStatus !== 'ready',
        onSelect: () => onSelectAction(action),
        pinned: true,
      })),
    };
  }, [enabled, ids, activeActionId, activeOperationId, onSelectAction, t]);
}
