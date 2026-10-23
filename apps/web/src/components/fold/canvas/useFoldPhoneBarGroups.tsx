import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Crosshair } from 'lucide-react';
import { setFoldAltLatched, useFoldAltLatched } from '../../../fold/canvas/foldAltLatch';
import type { FoldPaneId } from '../../../fold/canvas/foldPicking';
import { showFoldPhonePane, useFoldPhonePane } from '../../../fold/canvas/foldPhonePane';
import { useFoldRailGroups } from '../../../fold/canvas/useFoldRailGroups';
import {
  foldBarFavoriteCount,
  foldFavoriteItems,
  useFoldToolFavoriteIds,
} from '../../../fold/tools/foldToolFavorites';
import { ViewportToolbarButton, type ViewportToolbarGroupSpec } from '../../panels/ViewportToolbar';
import { FoldToolGlyph } from '../FoldToolGlyph';

/**
 * The Fold canvas's own controls on a phone (plan D14), at the head of its
 * bar, as Edit's phone bar carries its tools (`useCpFavoriteToolbarGroup`):
 * the starred tools first, in the user's order, the one in hand pressed — the
 * Tools pill in the header opens the rest — then the switch that swaps the one
 * pane on screen between the folded form and the crease pattern, named by the
 * pane it shows next.
 *
 * Groups through the bar's own `groups`, like every surface's controls, so the
 * seam, the wrap and the overflow trigger are the bar's; `pinned` keeps them
 * inline where an unpinned control would go to the menu they displaced.
 * Nothing off the phone layout, where the rail and both panes are on screen.
 *
 * While the free-point latch is on, it is on the bar too, before the switch,
 * pressed: a mode left on with nothing where the folding happens saying so
 * turns every tap on a corner into a free point, so the bar says it, and a
 * tap there lets it go. It takes the last favorite's place while it is
 * (`foldBarFavoriteCount`). Off, it is the sheet's alone.
 */
export function useFoldPhoneBarGroups(phone: boolean): ViewportToolbarGroupSpec[] {
  const { t } = useTranslation();
  const pane = useFoldPhonePane();
  const groups = useFoldRailGroups();
  // `ids` is the dependency, not the resolved items: the store hands back the
  // same array until a star changes it.
  const ids = useFoldToolFavoriteIds();
  // Never on for a fine pointer (`isFoldAltLatched`): a keyboard holds Alt instead.
  const latched = useFoldAltLatched();

  return useMemo(() => {
    if (!phone) return [];
    const favorites = foldFavoriteItems(groups, ids).slice(0, foldBarFavoriteCount(latched));
    const panes: { id: FoldPaneId; title: string }[] = [
      { id: 'folded', title: t('panels:fold.canvas.folded', 'Folded') },
      { id: 'crease-pattern', title: t('panels:fold.canvas.creasePattern', 'Crease pattern') },
    ];
    const other = panes.find((each) => each.id !== pane) ?? panes[0]!;
    return [
      {
        id: 'fold-favorites',
        items: favorites.map((item) => ({
          kind: 'action' as const,
          id: `favorite-${item.id}`,
          label: item.label,
          title: item.reason ?? item.label,
          icon: <FoldToolGlyph id={item.id} compact />,
          // Pressed inline: with the rail gone, the bar and the Tools pill are
          // what say which tool is in hand.
          checked: item.active,
          disabled: !item.available,
          onSelect: item.select,
          pinned: true,
        })),
      },
      {
        id: 'fold-pane',
        // The bar's own buttons as nodes, for what an action cannot carry: the
        // latch's pressed state, and the attributes a test finds them by.
        items: [
          latched && {
            kind: 'node' as const,
            id: 'fold-alt-latch',
            node: <FreePointLatchButton label={t('tools:fold.latch.freePoint', 'Free point')} />,
          },
          {
            kind: 'node' as const,
            id: 'fold-pane-switch',
            node: (
              <ViewportToolbarButton
                aria-label={other.title}
                title={other.title}
                data-fold-pane-switch={other.id}
                onClick={() => showFoldPhonePane(other.id)}
              >
                <ArrowLeftRight size={14} aria-hidden="true" />
              </ViewportToolbarButton>
            ),
          },
        ],
      },
    ];
  }, [phone, groups, ids, latched, pane, t]);
}

/** The free-point latch while it is on: pressed, and a tap lets it go. */
function FreePointLatchButton({ label }: { label: string }) {
  return (
    <ViewportToolbarButton
      aria-label={label}
      title={label}
      aria-pressed
      isActive
      data-fold-alt-latch-bar=""
      onClick={() => setFoldAltLatched(false)}
    >
      <Crosshair size={14} aria-hidden="true" />
    </ViewportToolbarButton>
  );
}
