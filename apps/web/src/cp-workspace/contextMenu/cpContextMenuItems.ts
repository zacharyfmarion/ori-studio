import type { TFunction } from 'i18next';
import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import {
  contextMenuActionItems,
  contextMenuActionSubmenu,
  menuActionLabelIndex,
  pruneContextMenuItems,
  type ContextMenuActionContext,
} from '../../menus/context/contextMenuActions';

/**
 * The crease-pattern canvas's context menu, as content.
 *
 * Every row here is a command the app already has, gated by the capability that
 * already gates it and labelled by the menu bar that already names it — see
 * `menus/context/contextMenuActions`. So this module answers exactly one
 * question: *which* verbs, in what order, for what was clicked. It declares no
 * behaviour, holds no store bindings, and imports no React, which is what lets
 * the ordering below be asserted directly.
 *
 * Ordering follows the convention `buildFoldedFigureActions` set and AGENTS.md
 * names as the reference: frequency first, grouped by intent, destructive last.
 * For a crease selection that reads as clipboard → type → transform → select →
 * diagnose → delete, because changing a crease's type is the overwhelmingly
 * common reason to have selected creases at all.
 */

/** What the right-click landed on, once the canvas has resolved it. */
export type CpContextMenuTarget =
  | { kind: 'selection' }
  | { kind: 'circle' }
  | { kind: 'text' }
  | { kind: 'image' };

export interface CpContextMenuDeps {
  t: TFunction;
  action: ContextMenuActionContext;
  /**
   * The verbs an annotation offers, supplied by the panel because they are store
   * bindings rather than commands — there is no `MenuActionId` for "bring this
   * image to front". Absent leaves the annotation menu to its shared rows alone.
   */
  annotation?: {
    bringToFront: () => void;
    sendToBack: () => void;
    remove: () => void;
    /** Text only: start an inline edit. Moves focus, so it defers the close. */
    edit?: () => void;
  };
}

/**
 * Why Fold / Simulate / Export-selection are *not* here.
 *
 * They are real verbs on a crease selection, and `CpSelectionToolbar` offers
 * them — but only when the selection resolves to one complete, border-enclosed
 * sub-pattern, and answering that means segmentation, which takes ~1s on a large
 * document and is cached asynchronously. A menu builds its rows synchronously at
 * open time, so the honest options were a row that is present or absent
 * depending on whether a cache happened to be warm, or no row.
 *
 * No row. A menu whose contents vary with cache state for the same selection is
 * worse than one that is merely incomplete — and the floating toolbar already
 * puts these three directly over the selection the moment it qualifies, which is
 * more discoverable than a menu row would be.
 */

/**
 * Rows for a crease selection.
 *
 * This is the menu the feature was asked for: "if I've selected some creases and
 * I right click … I should be able to do all the actions I can do on those
 * creases". So it is deliberately the *whole* Selected Lines menu rather than a
 * curated subset — a context menu that offers three of the eleven type verbs
 * teaches people the menu bar is still the real one.
 */
export function cpSelectionMenuItems(deps: CpContextMenuDeps): ContextMenuItem[] {
  const { t, action } = deps;
  const labels = menuActionLabelIndex(action.t);

  return pruneContextMenuItems([
    ...contextMenuActionItems(['edit.cut', 'edit.copy', 'edit.paste'], action, labels),
    { kind: 'separator' },
    contextMenuActionSubmenu(
      'cp-crease-type',
      t('panels:creasePattern.contextMenu.creaseType', 'Crease type'),
      [
        'cp.makeMountain',
        'cp.makeValley',
        'cp.makeEdge',
        'cp.makeAuxiliary',
        'separator',
        'cp.makeUnassignedKeepDirection',
        'cp.makeUnassigned',
        'separator',
        'cp.changeCreaseType',
        'cp.advanceCreaseType',
        'cp.toggleMountainValley',
      ],
      action,
      labels
    ),
    contextMenuActionSubmenu(
      'cp-transform',
      t('panels:creasePattern.contextMenu.transform', 'Transform'),
      [
        'cp.transformFlipHorizontal',
        'cp.transformFlipVertical',
        'separator',
        'cp.transformRotateLeft',
        'cp.transformRotateRight',
      ],
      action,
      labels
    ),
    contextMenuActionSubmenu(
      'cp-select',
      t('panels:creasePattern.contextMenu.select', 'Select'),
      [
        'edit.selectAll',
        'edit.deselectAll',
        'edit.selectByIndex',
        'separator',
        'cp.replaceLineType',
        'cp.deleteLineType',
      ],
      action,
      labels
    ),
    { kind: 'separator' },
    contextMenuActionSubmenu(
      'cp-diagnostics',
      t('panels:creasePattern.contextMenu.diagnostics', 'Diagnostics'),
      ['cp.checkCamv', 'cp.check1', 'cp.check2', 'cp.check3', 'cp.check4'],
      action,
      labels
    ),
    contextMenuActionSubmenu(
      'cp-repair',
      t('panels:creasePattern.contextMenu.repair', 'Repair'),
      [
        'cp.fix1',
        'cp.fix2',
        'separator',
        'cp.deleteExtraVertices',
        'cp.deleteExtraVerticesIgnoreColor',
        'cp.fixInaccurate',
      ],
      action,
      labels
    ),
    { kind: 'separator' },
    // Last, and the only row rendered in the destructive tone.
    ...contextMenuActionItems(['cp.deleteSelectedLines'], action, labels).map(
      (item): ContextMenuItem => (item.kind === 'action' ? { ...item, danger: true } : item)
    ),
  ]);
}

/** Rows for a selected circle. Oriedita has no circle selection; these are ours. */
export function cpCircleMenuItems(deps: CpContextMenuDeps): ContextMenuItem[] {
  const labels = menuActionLabelIndex(deps.action.t);
  return pruneContextMenuItems([
    ...contextMenuActionItems(
      ['cp.changeCircleColor', 'cp.organizeCircles'],
      deps.action,
      labels
    ),
    { kind: 'separator' },
    ...contextMenuActionItems(['edit.delete'], deps.action, labels).map(
      (item): ContextMenuItem => (item.kind === 'action' ? { ...item, danger: true } : item)
    ),
  ]);
}

/**
 * Rows for a canvas annotation — a reference image or a text box.
 *
 * These verbs have no `MenuActionId` behind them: they are annotation-layer
 * store actions the floating toolbars call directly (`AnnotationActions`), so
 * unlike everything else here they are declared rather than derived. Opacity is
 * deliberately absent — it is a slider, and a menu has no row shape for one; the
 * floating toolbar remains the place to set it.
 */
export function cpAnnotationMenuItems(
  kind: 'text' | 'image',
  deps: CpContextMenuDeps
): ContextMenuItem[] {
  const { t } = deps;
  const annotation = deps.annotation;
  if (!annotation) return [];

  return pruneContextMenuItems([
    kind === 'text' && annotation.edit
      ? {
          kind: 'action',
          id: 'annotation-edit',
          label: t('panels:creasePattern.contextMenu.editText', 'Edit text'),
          onSelect: annotation.edit,
        }
      : null,
    { kind: 'separator' },
    {
      kind: 'action',
      id: 'annotation-front',
      label: t('panels:imageInspector.bringToFront', 'Bring to front'),
      onSelect: annotation.bringToFront,
    },
    {
      kind: 'action',
      id: 'annotation-back',
      label: t('panels:imageInspector.sendToBack', 'Send to back'),
      onSelect: annotation.sendToBack,
    },
    { kind: 'separator' },
    {
      kind: 'action',
      id: 'annotation-delete',
      label: t('panels:creasePattern.contextMenu.delete', 'Delete'),
      danger: true,
      onSelect: annotation.remove,
    },
  ]);
}
