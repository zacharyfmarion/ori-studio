import type { TFunction } from 'i18next';
import type { ContextMenuItem } from '../components/ui/contextMenuTypes';
import {
  contextMenuActionItems,
  contextMenuActionSubmenu,
  menuActionLabelIndex,
  pruneContextMenuItems,
  type ContextMenuActionContext,
} from '../menus/context/contextMenuActions';

/**
 * The four grid-unit moves.
 *
 * Declared here rather than in the pane because two surfaces now name them —
 * the arrow keys and this menu — and a second local copy is how the two drift.
 */
export type BpPackingNudgeDirection = 'up' | 'down' | 'left' | 'right';

/**
 * The box-pleat packing canvas's context menu, as content.
 *
 * Free of React and of the store — the bindings are `useBpPackingContextMenu`'s
 * — so the ordering and the gating below are directly assertable.
 *
 * The sheet verbs are the interesting half: every one of them is already a
 * `MenuActionId` sitting behind the Design menu and the pane's own toolbar, so
 * they arrive here as a list of ids and inherit their labels, their shortcuts,
 * their capability gates and their analytics without restating any of it. That
 * is the same reason `useBpSheetTransforms` exists, applied to a menu.
 */

/** What the right-click landed on, once the pane has resolved it. */
export type BpPackingContextTarget =
  | { kind: 'flap'; count: number }
  | { kind: 'river' }
  | { kind: 'sheet' };

export interface BpPackingContextMenuDeps {
  t: TFunction;
  action: ContextMenuActionContext;
  /**
   * Move the selection one grid unit. Returns whether anything moved, which the
   * pane already answers for the arrow keys — the row is disabled when the
   * selection is against a wall in that direction rather than silently no-op.
   */
  canNudge: (direction: BpPackingNudgeDirection) => boolean;
  nudge: (direction: BpPackingNudgeDirection) => void;
  /**
   * The flap to unpair from its mirror, when exactly one paired flap is
   * selected. Null leaves the row out — an unpair with nothing to unpair is not
   * a disabled verb, it is a verb that does not apply.
   */
  unpairableId: number | null;
  unpair: (id: number) => void;
}

const NUDGE_DIRECTIONS: readonly BpPackingNudgeDirection[] = ['up', 'down', 'left', 'right'];

// Literal keys so the i18n extractor can see them (see apps/web/CLAUDE.md).
function nudgeLabel(t: TFunction, direction: BpPackingNudgeDirection): string {
  switch (direction) {
    case 'up':
      return t('panels:bpPacking.contextMenu.nudgeUp', 'Up');
    case 'down':
      return t('panels:bpPacking.contextMenu.nudgeDown', 'Down');
    case 'left':
      return t('panels:bpPacking.contextMenu.nudgeLeft', 'Left');
    case 'right':
      return t('panels:bpPacking.contextMenu.nudgeRight', 'Right');
  }
}

/**
 * The verbs on a selected flap or flap group.
 *
 * Nudge leads because it is the one thing you can do to a flap that a drag does
 * not already do better — a drag moves it anywhere, and nudge is how you move it
 * exactly one grid unit, which is the whole game in box pleating.
 */
export function bpFlapMenuItems(deps: BpPackingContextMenuDeps): ContextMenuItem[] {
  const { t, action } = deps;
  const labels = menuActionLabelIndex(action.t);
  return pruneContextMenuItems([
    {
      kind: 'submenu',
      id: 'bp-nudge',
      label: t('panels:bpPacking.contextMenu.nudge', 'Nudge'),
      disabled: !NUDGE_DIRECTIONS.some((direction) => deps.canNudge(direction)),
      items: NUDGE_DIRECTIONS.map((direction) => ({
        kind: 'action',
        id: `bp-nudge-${direction}`,
        label: nudgeLabel(t, direction),
        disabled: !deps.canNudge(direction),
        onSelect: () => deps.nudge(direction),
      })),
    },
    deps.unpairableId !== null
      ? {
          kind: 'action',
          id: 'bp-unpair',
          label: t('panels:bpPacking.unpair', 'Unpair from mirror'),
          onSelect: () => deps.unpair(deps.unpairableId as number),
        }
      : null,
    { kind: 'separator' },
    ...contextMenuActionItems(['edit.delete'], action, labels).map(
      (item): ContextMenuItem => (item.kind === 'action' ? { ...item, danger: true } : item)
    ),
  ]);
}

/** The verbs on a selected river. A river is derived from the tree, so: delete. */
export function bpRiverMenuItems(deps: BpPackingContextMenuDeps): ContextMenuItem[] {
  const labels = menuActionLabelIndex(deps.action.t);
  return pruneContextMenuItems(
    contextMenuActionItems(['edit.delete'], deps.action, labels).map(
      (item): ContextMenuItem => (item.kind === 'action' ? { ...item, danger: true } : item)
    )
  );
}

/**
 * The verbs on the sheet, or on empty paper.
 *
 * Grid size and the four transforms are the pane's own toolbar, and Optimize
 * Layout is the Design menu's — reached here without leaving the paper, which is
 * the point of a context menu on a canvas whose toolbar is a floating strip that
 * can be scrolled away from.
 */
export function bpSheetMenuItems(deps: BpPackingContextMenuDeps): ContextMenuItem[] {
  const { t, action } = deps;
  const labels = menuActionLabelIndex(action.t);
  return pruneContextMenuItems([
    ...contextMenuActionItems(['bp.layout.subdivide', 'bp.layout.unsubdivide'], action, labels),
    { kind: 'separator' },
    contextMenuActionSubmenu(
      'bp-transform',
      t('panels:bpPacking.transform', 'Transform'),
      [
        'bp.layout.rotateLeft',
        'bp.layout.rotateRight',
        'separator',
        'bp.layout.flipHorizontal',
        'bp.layout.flipVertical',
      ],
      action,
      labels
    ),
    { kind: 'separator' },
    ...contextMenuActionItems(['bp.optimize.layout'], action, labels),
  ]);
}

/** Rows for whatever the pane resolved under the pointer. */
export function bpPackingMenuItems(
  target: BpPackingContextTarget,
  deps: BpPackingContextMenuDeps
): ContextMenuItem[] {
  switch (target.kind) {
    case 'flap':
      return bpFlapMenuItems(deps);
    case 'river':
      return bpRiverMenuItems(deps);
    case 'sheet':
      return bpSheetMenuItems(deps);
  }
}
