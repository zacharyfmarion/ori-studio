/**
 * What a right-click on the crease-pattern canvas landed on. The canvas resolves
 * the target under the pointer; the panel decides what menu (if any) to raise for
 * it. New surfaces become new variants here plus a branch in the panel's item
 * builder — the canvas and menu component stay unchanged.
 */
export type CpContextTarget =
  | { kind: 'folded-figure'; figureId: string }
  /**
   * A right-click that should offer the crease selection's verbs.
   *
   * Raised only when the pattern has a live selection — see
   * `contextMenu/cpRightClick`, which owns that rule and states why. The menu is
   * about the *selection*, not about whatever the cursor happened to be over, so
   * this carries no hit: right-clicking one selected crease and right-clicking
   * empty space beside the selection mean the same thing.
   */
  | { kind: 'selection' }
  | { kind: 'empty' };

/** A canvas request to open a context menu at viewport coordinates for `target`. */
export interface CpContextMenuRequest {
  clientX: number;
  clientY: number;
  target: CpContextTarget;
}
