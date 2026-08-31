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
 * The TreeMaker design tree's context menu, as content.
 *
 * Purely derived: every row is an Edit- or Design-menu command, so this file is
 * a list of ids and an order. That is the point — these verbs are today reachable
 * only from the menu bar and the Inspector's action rows, neither of which is
 * where your hands are while you are dragging nodes around.
 *
 * Free of React and of the store.
 */

/**
 * What the right-click landed on.
 *
 * Carries the id even though no row below reads it: the pane selects the target
 * before building, and passing the id along with the kind is what keeps "what
 * was clicked" and "what the menu is about" the same value rather than two
 * lookups that can disagree.
 */
export type DesignTreeContextTarget =
  | { kind: 'node'; id: number }
  | { kind: 'edge'; id: number }
  | { kind: 'path'; id: number }
  | { kind: 'empty' };

export interface DesignTreeContextMenuDeps {
  t: TFunction;
  action: ContextMenuActionContext;
}

/**
 * Rows for a selected node.
 *
 * Make Root first: it is the one verb here with no other home — the Inspector
 * offers it, but only while the node is selected *and* the Inspector is open.
 */
export function designNodeMenuItems(deps: DesignTreeContextMenuDeps): ContextMenuItem[] {
  const { t, action } = deps;
  const labels = menuActionLabelIndex(action.t);
  return pruneContextMenuItems([
    ...contextMenuActionItems(['edit.makeRoot'], action, labels),
    { kind: 'separator' },
    contextMenuActionSubmenu(
      'design-node-tools',
      t('panels:designTree.contextMenu.nodeTools', 'Node'),
      [
        'edit.absorbNodes',
        'edit.absorbRedundantNodes',
        'separator',
        'edit.perturbNodes',
        'edit.perturbAllNodes',
        'separator',
        'edit.addLargestStubForNodes',
        'edit.addLargestStubForPoly',
      ],
      action,
      labels
    ),
    contextMenuActionSubmenu(
      'design-node-strain',
      t('panels:designTree.contextMenu.strain', 'Strain'),
      ['edit.removeStrain', 'edit.relieveStrain', 'separator', 'edit.removeAllStrain', 'edit.relieveAllStrain'],
      action,
      labels
    ),
    { kind: 'separator' },
    ...destructive(contextMenuActionItems(['edit.delete'], action, labels)),
  ]);
}

/** Rows for a selected edge. The Edge submenu of the Edit menu, in place. */
export function designEdgeMenuItems(deps: DesignTreeContextMenuDeps): ContextMenuItem[] {
  const { t, action } = deps;
  const labels = menuActionLabelIndex(action.t);
  return pruneContextMenuItems([
    ...contextMenuActionItems(
      ['edit.setEdgeLength', 'edit.scaleEdgeLengths', 'edit.splitEdge'],
      action,
      labels
    ),
    { kind: 'separator' },
    contextMenuActionSubmenu(
      'design-edge-tools',
      t('panels:designTree.contextMenu.edgeTools', 'Edge'),
      ['edit.renormalizeToEdge', 'edit.renormalizeToUnitScale', 'separator', 'edit.absorbEdges'],
      action,
      labels
    ),
    contextMenuActionSubmenu(
      'design-edge-strain',
      t('panels:designTree.contextMenu.strain', 'Strain'),
      ['edit.removeStrain', 'edit.relieveStrain', 'separator', 'edit.removeAllStrain', 'edit.relieveAllStrain'],
      action,
      labels
    ),
    { kind: 'separator' },
    ...destructive(contextMenuActionItems(['edit.delete'], action, labels)),
  ]);
}

/**
 * Rows for a selected path.
 *
 * A path is derived from the tree rather than authored, so it has no verbs of
 * its own — what it offers is the selection it names, and the whole-tree verbs.
 */
export function designPathMenuItems(deps: DesignTreeContextMenuDeps): ContextMenuItem[] {
  return designCanvasMenuItems(deps);
}

/**
 * Rows for empty paper.
 *
 * Select, then the three optimizers, then Build — which is the order the work
 * actually happens in, and the reason this menu is worth having at all: the
 * optimize/build loop is the design workflow, and it currently lives two clicks
 * deep in a menu bar at the top of the window.
 */
export function designCanvasMenuItems(deps: DesignTreeContextMenuDeps): ContextMenuItem[] {
  const { t, action } = deps;
  const labels = menuActionLabelIndex(action.t);
  return pruneContextMenuItems([
    contextMenuActionSubmenu(
      'design-select',
      t('panels:designTree.contextMenu.select', 'Select'),
      [
        'edit.selectAll',
        'edit.deselectAll',
        'separator',
        'edit.selectMovableParts',
        'edit.selectCorridorFacets',
      ],
      action,
      labels
    ),
    { kind: 'separator' },
    ...contextMenuActionItems(
      ['optimize.scale', 'optimize.edges', 'optimize.strain'],
      action,
      labels
    ),
    { kind: 'separator' },
    ...contextMenuActionItems(['edit.triangulateTree', 'cp.build'], action, labels),
  ]);
}

/** Mark the last row destructive, so Delete reads as Delete. */
function destructive(items: ContextMenuItem[]): ContextMenuItem[] {
  return items.map((item) => (item.kind === 'action' ? { ...item, danger: true } : item));
}

/** Rows for whatever the pane resolved under the pointer. */
export function designTreeMenuItems(
  target: DesignTreeContextTarget,
  deps: DesignTreeContextMenuDeps
): ContextMenuItem[] {
  switch (target.kind) {
    case 'node':
      return designNodeMenuItems(deps);
    case 'edge':
      return designEdgeMenuItems(deps);
    case 'path':
      return designPathMenuItems(deps);
    case 'empty':
      return designCanvasMenuItems(deps);
  }
}
