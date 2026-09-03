import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { OristudioBpSelection } from '../engine/oristudioBpTypes';
import {
  bpPackingMenuItems,
  type BpPackingContextTarget,
  type BpPackingNudgeDirection,
} from '../lib/bpPackingContextMenu';
import {
  contextMenuKeyboardAnchor,
  useContextMenuController,
  type ContextMenuController,
  type ContextMenuSource,
} from '../menus/context/useContextMenuController';

/**
 * The packing canvas's context menu, wired.
 *
 * Sibling of `useBpPackingDragRequests` and `useBpSheetTransforms`: the pane
 * stays a composition site, and the store bindings behind a menu live in a hook
 * beside the concern rather than accumulating in `BpPackingPanel`.
 *
 * What the pane still owns is the *hit* — which flap, river or bare sheet a
 * press landed on. It already resolves that for selection, so asking it again
 * here would be a second hit test that could disagree with the first.
 */

export interface UseBpPackingContextMenuOptions {
  selection: OristudioBpSelection;
  /**
   * Whether a move in this direction would do anything — the pane's `planNudge`,
   * which answers without moving. A menu has to grey a blocked direction *before*
   * the press, which is why the commit below cannot double as the probe.
   */
  canNudge: (direction: BpPackingNudgeDirection) => boolean;
  /** Move the selection one unit; returns whether anything actually moved. */
  nudge: (direction: BpPackingNudgeDirection) => boolean;
  symmetry: { unpairableId: number | null; unpair: (id: number) => void };
}

export interface BpPackingContextMenu {
  controller: ContextMenuController;
  /** Raise the menu for what the pane resolved under the pointer. */
  open: (
    target: BpPackingContextTarget,
    clientX: number,
    clientY: number,
    source?: ContextMenuSource
  ) => void;
  /**
   * The `viewport.contextMenu` chord, anchored at the middle of the pane.
   * Returns whether it opened anything, so an unopened chord falls through.
   */
  openFromKeyboard: (container: HTMLElement | null) => boolean;
}

/** Whether a selection names anything at all. */
function hasBpSelection(selection: OristudioBpSelection): boolean {
  if (selection.kind === 'bp-none') return false;
  if (selection.kind !== 'bp-multi') return true;
  return (
    selection.vertices.length +
      selection.edges.length +
      selection.flaps.length +
      selection.rivers.length +
      selection.stretches.length +
      selection.devices.length +
      selection.invalidJunctions.length >
    0
  );
}

export function useBpPackingContextMenu(
  options: UseBpPackingContextMenuOptions
): BpPackingContextMenu {
  const { t } = useTranslation();
  const controller = useContextMenuController('bp-packing');
  const { selection, canNudge, nudge, symmetry } = options;

  const open = useCallback(
    (
      target: BpPackingContextTarget,
      clientX: number,
      clientY: number,
      source: ContextMenuSource = 'pointer'
    ) => {
      controller.request({
        clientX,
        clientY,
        targetKind: target.kind,
        hasSelection: hasBpSelection(selection),
        source,
        build: () =>
          bpPackingMenuItems(target, {
            t,
            action: controller.actionContext(),
            // Asked per direction, so a flap against the left wall greys only
            // "Left" rather than the whole submenu.
            canNudge,
            nudge: (direction) => void nudge(direction),
            unpairableId: symmetry.unpairableId,
            unpair: symmetry.unpair,
          }),
      });
    },
    [canNudge, controller, nudge, selection, symmetry, t]
  );

  const openFromKeyboard = useCallback(
    (container: HTMLElement | null): boolean => {
      const anchor = contextMenuKeyboardAnchor(container);
      if (!anchor) return false;
      // The sheet menu, not the selection's: a chord has no cursor, so there is
      // no flap "under" it, and the sheet verbs are the ones that apply whatever
      // is selected.
      open({ kind: 'sheet' }, anchor.clientX, anchor.clientY, 'keyboard');
      return true;
    },
    [open]
  );

  return { controller, open, openFromKeyboard };
}
