import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import {
  contextMenuKeyboardAnchor,
  useContextMenuController,
  type ContextMenuController,
} from '../../menus/context/useContextMenuController';
import { handleMenuAction } from '../../commands/menuActions';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { CpImagePlacement } from '../annotations/useCpAnnotations';
import type { CanvasLayerBindings } from '../canvasObjects/canvasLayerBindings';
import type { FoldedFigureActionDeps } from '../folded/foldedFigureActions';
import { foldedFigureMenuItemsWith } from '../folded/foldedFigureMenuItems';
import type { CpContextMenuRequest } from '../contextMenuTarget';
import { cpHasSelection } from './cpRightClick';
import {
  cpBlankCanvasMenuItems,
  cpSelectionMenuItems,
  type CpContextMenuDeps,
} from './cpContextMenuItems';

/**
 * The crease-pattern canvas's context menus, wired.
 *
 * This is the seam AGENTS.md asks for: the panel is a composition site, so the
 * store bindings behind these menus live here rather than accumulating there.
 * The split inside this file is the same one again — `cpContextMenuItems` says
 * *what* each menu contains and is free of React and the store, and this says
 * which target maps to which menu and what its rows are bound to.
 *
 * Two entry points, because the canvas has two layers that can take a
 * right-click. `onCanvasContextMenu` is the WebGL surface's, reached only when
 * `cpRightClickOutcome` decided the press was a menu rather than an erase.
 * `onCanvasObjectContextMenu` is the DOM overlay's, which sits above the canvas
 * and takes the press first for anything with a box — figures, images, text.
 */

export interface UseCpCanvasContextMenuOptions {
  /** The merged overlay layers; an object's menu is its layer's to build. */
  bindings: CanvasLayerBindings;
  /**
   * For the *canvas's* folded-figure target — a right-click that reached the
   * GL surface through an inert 3D body, which the overlay never saw.
   */
  foldedFigures: readonly OristudioCpFoldedFigureEntry[];
  foldedFigureActionDeps: Omit<FoldedFigureActionDeps, 't'>;
  setActiveFoldedFigure: (id: string | null) => void;
  annotations: {
    /** Place a text box at a model point and open it for editing. */
    createTextAt: (modelPoint: { x: number; y: number }) => void;
    /** Park where and how the next picked image should land. */
    setPendingImagePoint: (placement: CpImagePlacement | null) => void;
  };
}

export interface CpCanvasContextMenu {
  controller: ContextMenuController;
  onCanvasContextMenu: (request: CpContextMenuRequest) => void;
  onCanvasObjectContextMenu: (id: string, clientX: number, clientY: number) => void;
  /**
   * The `viewport.contextMenu` chord. Returns whether it opened anything, so the
   * shortcut runtime can let the chord fall through when it did not.
   */
  openFromKeyboard: (container: HTMLElement | null) => boolean;
}

export function useCpCanvasContextMenu(
  options: UseCpCanvasContextMenuOptions
): CpCanvasContextMenu {
  const { t } = useTranslation();
  const controller = useContextMenuController('crease-pattern');
  const { bindings, foldedFigures, foldedFigureActionDeps, setActiveFoldedFigure, annotations } =
    options;

  /** The shared half of every builder below. Read at open time, never in render. */
  const menuDeps = useCallback(
    (): CpContextMenuDeps => ({ t, action: controller.actionContext() }),
    [controller, t]
  );

  const openFoldedFigureMenu = useCallback(
    (figureId: string, clientX: number, clientY: number): boolean => {
      const figure = foldedFigures.find((candidate) => candidate.id === figureId);
      if (!figure) return false;
      // Act on the *clicked* figure, not the active one, so the menu is correct
      // even before the selection this sets has settled.
      setActiveFoldedFigure(figureId);
      controller.request({
        clientX,
        clientY,
        targetKind: 'folded-figure',
        hasSelection: true,
        build: () => foldedFigureMenuItemsWith(figure, foldedFigureActionDeps, t),
      });
      return true;
    },
    [controller, foldedFigures, foldedFigureActionDeps, setActiveFoldedFigure, t]
  );

  const onCanvasContextMenu = useCallback(
    (request: CpContextMenuRequest) => {
      const { target, clientX, clientY } = request;
      if (target.kind === 'folded-figure') {
        openFoldedFigureMenu(target.figureId, clientX, clientY);
        return;
      }
      if (target.kind === 'blank') {
        const modelPoint = target.modelPoint;
        controller.request({
          clientX,
          clientY,
          targetKind: 'empty',
          // The canvas raises this target only with nothing selected.
          hasSelection: false,
          build: () =>
            cpBlankCanvasMenuItems({
              ...menuDeps(),
              insert: {
                image: () => {
                  // Park the placement, *then* dispatch the ordinary command.
                  // Going through `handleMenuAction` is what keeps this on the
                  // analytics chokepoint and inside the capability gate; the
                  // parked point is the only thing that differs from the Insert
                  // menu, and the picker's `change` handler consumes it.
                  // `top-left`, not the default centre: the menu means "start
                  // it here", the same rule the paste row below follows.
                  annotations.setPendingImagePoint({
                    x: clientX,
                    y: clientY,
                    anchor: 'top-left',
                  });
                  void handleMenuAction('insert.image');
                },
                text: () => {
                  // Not `handleMenuAction('insert.text')`: that *arms the text
                  // tool* so the next canvas click places a box, which is right
                  // for a menu with no click point and wrong for one raised at
                  // a point. Placing directly means this row does not reach the
                  // chokepoint — `context menu opened` is what measures it.
                  controller.deferFocus();
                  annotations.createTextAt(modelPoint);
                },
              },
              // The pasted bounding box's top-left lands on the click, the same
              // anchoring as the image above. Called directly rather than via
              // `handleMenuAction`, because a destination cannot travel through
              // an id — the cost is that this row is invisible to
              // `command invoked`, which `context menu opened` covers.
              pasteAt: () => {
                void useWorkspaceStore.getState().pasteClipboard(modelPoint);
              },
            }),
        });
        return;
      }
      if (target.kind !== 'selection') return;
      controller.request({
        clientX,
        clientY,
        targetKind: 'selection',
        // The canvas only raises this target when something is selected — see
        // `cpRightClickOutcome` — so this is a statement of that, not a guess.
        hasSelection: true,
        build: () => cpSelectionMenuItems(menuDeps()),
      });
    },
    [annotations, controller, menuDeps, openFoldedFigureMenu]
  );

  // An object's menu is its layer's to build: the binding says which rows and
  // selects first, so the floating surface and the menu agree about what is
  // being acted on; this only says where. A layer with no menu for the kind (a
  // window, whose verbs are on its inspector) answers null.
  const onCanvasObjectContextMenu = useCallback(
    (id: string, clientX: number, clientY: number) => {
      const request = bindings
        .byId(id)
        ?.contextMenu(id, { ...menuDeps(), deferFocus: controller.deferFocus });
      if (!request) return;
      controller.request({
        clientX,
        clientY,
        targetKind: request.targetKind,
        hasSelection: true,
        build: request.build,
      });
    },
    [bindings, controller, menuDeps]
  );

  const openFromKeyboard = useCallback(
    (container: HTMLElement | null): boolean => {
      const anchor = contextMenuKeyboardAnchor(container);
      if (!anchor) return false;
      // The selection menu, always — a keyboard press has no cursor, so there is
      // no figure or annotation "under" it to prefer. The rows are gated by
      // capability anyway, so with nothing selected this is a menu of greyed
      // verbs that each say what they want, which is a better answer to the
      // chord than nothing happening.
      controller.request({
        ...anchor,
        targetKind: 'selection',
        // The real answer, read at press time. The pointer paths can assert this
        // because the gesture that reached them implies it; a chord cannot, and
        // reporting `true` regardless would quietly make the property useless.
        hasSelection: cpHasSelection(useWorkspaceStore.getState().oristudioCpSelection),
        source: 'keyboard',
        build: () => cpSelectionMenuItems(menuDeps()),
      });
      return true;
    },
    [controller, menuDeps]
  );

  return { controller, onCanvasContextMenu, onCanvasObjectContextMenu, openFromKeyboard };
}
