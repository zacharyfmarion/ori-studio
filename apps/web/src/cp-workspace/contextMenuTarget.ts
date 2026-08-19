/**
 * What a right-click on the crease-pattern canvas landed on. The canvas resolves
 * the target under the pointer; the panel decides what menu (if any) to raise for
 * it. New surfaces (a crease line, the current selection) become new variants here
 * plus a branch in the panel's item builder — the canvas and menu component stay
 * unchanged.
 */
export type CpContextTarget = { kind: 'folded-figure'; figureId: string } | { kind: 'empty' };

/** A canvas request to open a context menu at viewport coordinates for `target`. */
export interface CpContextMenuRequest {
  clientX: number;
  clientY: number;
  target: CpContextTarget;
}
