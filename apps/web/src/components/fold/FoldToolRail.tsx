import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { FoldKeyLabel } from '../../fold/tools/foldToolCatalog';
import { foldRailTooltip, type FoldRailGroup } from '../../fold/tools/foldRailGroups';
import { STORAGE_KEYS, storageKey } from '../../lib/storage';
import { ToolRail, type ToolRailGroup } from '../ui/ToolRail';
import { FoldToolGlyph } from './FoldToolGlyph';

const RAIL_GROUPS_STORAGE_KEY = storageKey(STORAGE_KEYS.foldToolRailGroups);

/**
 * The Fold tools down the left of the workspace (plan D14), seated by
 * `FoldWorkspaceRail`: the app's `ToolRail`,
 * in `foldRailGroups()`'s groups — the folds, Reference points, Locate line,
 * the model verbs, and the sinks. Icon-only; each names its
 * key in its tooltip, resolved against the user's layout by `keyLabel`. A
 * phone has no rail, and shows the same groups in `FoldToolPickerSheet`.
 */
export function FoldToolRail({
  groups,
  keyLabel,
  header,
}: {
  groups: readonly FoldRailGroup[];
  /** The label of a Fold key; without it the tooltips name none. */
  keyLabel?: FoldKeyLabel;
  /** A full-width row above the groups: a touch tablet's free-point latch. */
  header?: ReactNode;
}) {
  const { t } = useTranslation();
  const railGroups: ToolRailGroup[] = groups.map((group) => ({
    id: group.id,
    label: group.label,
    railLabel: group.label,
    collapsedByDefault: group.collapsedByDefault,
    content: {
      tools: group.items.map((item) => ({
        id: item.id,
        label: item.label,
        tooltip: foldRailTooltip(item, item.shortcut ? keyLabel?.(item.shortcut) : undefined),
        glyph: <FoldToolGlyph id={item.id} />,
        active: item.active,
        available: item.available,
        onSelect: item.select,
      })),
    },
  }));
  return (
    <ToolRail
      aria-label={t('tools:fold.railLabel', 'Fold tools')}
      idPrefix="fold-rail-group"
      groups={railGroups}
      header={header}
      // A group opened or closed stays so.
      storageKey={RAIL_GROUPS_STORAGE_KEY}
    />
  );
}
