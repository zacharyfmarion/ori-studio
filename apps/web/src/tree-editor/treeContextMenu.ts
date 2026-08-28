import type { TFunction } from 'i18next';
import type { ContextMenuItem } from '../components/ui/contextMenuTypes';
import {
  contextMenuActionItems,
  menuActionLabelIndex,
  pruneContextMenuItems,
  type ContextMenuActionContext,
} from '../menus/context/contextMenuActions';

/**
 * The tree canvas's context menu, as content.
 *
 * One catalog for two surfaces, because there is one editor: the box-pleat tree
 * and the ExplOri tree are `TreeEditor` mounted against different hosts. Every
 * verb below is asked of the host rather than of a design kind, so a third
 * surface adopting the editor gets the menu with it.
 *
 * Free of React and of the store — `useTreeContextMenu` binds it.
 */

export type TreeContextTarget = { kind: 'vertex' | 'edge'; id: number } | null;

export interface TreeContextMenuDeps {
  t: TFunction;
  action: ContextMenuActionContext;
  /**
   * Hang a new leaf off the selected vertex at the clicked point. Absent when
   * nothing is selected to hang it from — which is also when the canvas's own
   * click gesture does nothing.
   */
  addLeafHere: (() => void) | null;
  /** Break this vertex's explicit mirror pairing. Absent when it has none. */
  unpair: (() => void) | null;
  /** Mirror draw, when the surface has a mirror at all. */
  mirror: { enabled: boolean; toggle: () => void; label: string } | null;
  labels: { visible: boolean; toggle: () => void; label: string };
  clearSelection: () => void;
  hasSelection: boolean;
}

/**
 * Rows for a vertex.
 *
 * No "Rename": selecting a nameable vertex already puts its name field on
 * screen, so the row would name a thing the click has already done. The same
 * reasoning as the edge menu below, and it is why these menus are short — this
 * editor surfaces most of its verbs as contextual editors rather than commands.
 */
export function treeVertexMenuItems(deps: TreeContextMenuDeps): ContextMenuItem[] {
  const { t, action } = deps;
  const labels = menuActionLabelIndex(action.t);
  return pruneContextMenuItems([
    deps.unpair
      ? {
          kind: 'action',
          id: 'tree-unpair',
          // The same wording the packing pane's toolbar uses for the same verb.
          label: t('panels:bpPacking.unpair', 'Unpair from mirror'),
          onSelect: deps.unpair,
        }
      : null,
    { kind: 'separator' },
    ...contextMenuActionItems(['edit.delete'], action, labels).map(
      (item): ContextMenuItem => (item.kind === 'action' ? { ...item, danger: true } : item)
    ),
  ]);
}

/**
 * Rows for an edge.
 *
 * No "Set length…": selecting an edge already opens `TreeEdgeLengthEditor` over
 * it, and a menu row that opened a *second* way to type the same number would be
 * a worse version of the editor the click just produced.
 */
export function treeEdgeMenuItems(deps: TreeContextMenuDeps): ContextMenuItem[] {
  const labels = menuActionLabelIndex(deps.action.t);
  return pruneContextMenuItems(
    contextMenuActionItems(['edit.delete'], deps.action, labels).map(
      (item): ContextMenuItem => (item.kind === 'action' ? { ...item, danger: true } : item)
    )
  );
}

/**
 * Rows for empty canvas.
 *
 * "Add leaf here" is the same verb as the canvas's own click-with-a-vertex-
 * selected gesture, at the same point — offered as a row because that gesture is
 * invisible until someone discovers it, and this is where a new user looks.
 *
 * The two view toggles follow. A tree canvas has little to do with bare paper,
 * but mirror draw and labels live on a floating toolbar a zoomed-in user has
 * often scrolled away from, and this is the one place they are always a click
 * away.
 */
export function treeCanvasMenuItems(deps: TreeContextMenuDeps): ContextMenuItem[] {
  const { t } = deps;
  return pruneContextMenuItems([
    deps.addLeafHere
      ? {
          kind: 'action',
          id: 'tree-add-leaf',
          label: t('panels:treeEditor.contextMenu.addLeaf', 'Add leaf here'),
          onSelect: deps.addLeafHere,
        }
      : null,
    { kind: 'separator' },
    deps.hasSelection
      ? {
          kind: 'action',
          id: 'tree-deselect',
          label: t('panels:treeEditor.contextMenu.deselect', 'Deselect all'),
          onSelect: deps.clearSelection,
        }
      : null,
    { kind: 'separator' },
    deps.mirror
      ? {
          kind: 'radio',
          id: 'tree-mirror',
          label: deps.mirror.label,
          checked: deps.mirror.enabled,
          onSelect: deps.mirror.toggle,
        }
      : null,
    {
      kind: 'radio',
      id: 'tree-labels',
      label: deps.labels.label,
      checked: deps.labels.visible,
      onSelect: deps.labels.toggle,
    },
  ]);
}

/** Rows for whatever the scene resolved under the pointer. */
export function treeMenuItems(
  target: TreeContextTarget,
  deps: TreeContextMenuDeps
): ContextMenuItem[] {
  if (target === null) return treeCanvasMenuItems(deps);
  return target.kind === 'vertex' ? treeVertexMenuItems(deps) : treeEdgeMenuItems(deps);
}
