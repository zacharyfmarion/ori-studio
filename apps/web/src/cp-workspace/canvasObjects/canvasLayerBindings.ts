import type { ContextMenuTargetKind } from '../../analytics/events';
import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import type { CanvasObjectBoxUpdate } from '../CanvasObjectOverlay';
import type { AnnotationBox, AnnotationResizeHandle } from '../annotations/annotationTransform';
import type { CpContextMenuDeps } from '../contextMenu/cpContextMenuItems';
import type { CanvasObjectKind } from './canvasObjectKinds';
import type { TransformableCanvasObject } from './transformableObject';

/** The overlay's four gestures, each recorded under the layer's own label. */
export type CanvasObjectGestureKind = 'move' | 'resize' | 'rotate' | 'crop';

/** A box fit-to-view must include — the canvas prop shape, which carries `hidden`. */
export type CanvasOverlayBox = AnnotationBox & { hidden: boolean };

/** What a layer's context menu needs beyond its own verbs. */
export interface CanvasObjectMenuDeps extends CpContextMenuDeps {
  /** Keep focus where a row moves it (an inline text edit), rather than back on the canvas. */
  deferFocus(): void;
}

/** The part of a context-menu request the layer decides; the controller adds where. */
export interface CanvasObjectMenuRequest {
  targetKind: ContextMenuTargetKind;
  build(): ContextMenuItem[];
}

/**
 * One per overlay *layer* — annotations, folded figures, inline simulation
 * windows — produced by that layer's `use*` hook, which already owns the
 * layer's verbs, gesture bracket and transformable projections.
 *
 * The crease-pattern panel used to name every kind by hand in each of its
 * id-addressed callbacks (select, box update, begin/commit/cancel gesture,
 * delete, context menu) and in three merged lists (transformables, framing
 * boxes, inert bodies): seven per-kind arms a new kind had to be added to,
 * with nothing failing when one was missed — the documented half-registered
 * bug. A binding is the whole answer for a layer, and the panel dispatches
 * through {@link mergeCanvasLayerBindings} without naming a kind.
 */
export interface CanvasLayerBinding {
  /** The kinds this layer answers for — the annotation layer answers for three. */
  kinds: readonly CanvasObjectKind[];
  transformables: readonly TransformableCanvasObject[];
  overlayBoxes: readonly CanvasOverlayBox[];
  /** Bodies the overlay must leave alone (focused windows and figures, every region). */
  inertBodyIds: ReadonlySet<string>;
  /** Take the canvas selection for this object. */
  select(id: string): void;
  /** The layer's own release — the `null` arm of the old selectCanvasObject released every layer. */
  release(): void;
  applyBoxUpdate(id: string, patch: CanvasObjectBoxUpdate): void;
  /** Open the layer's undo bracket for a canvas gesture; false is a refusal the overlay honours. */
  beginGesture(id: string): boolean;
  commitGesture(id: string, kind: CanvasObjectGestureKind): void;
  cancelGesture(id: string): void;
  remove(id: string): void;
  /** The menu for this object, or null for a kind with none (windows today). */
  contextMenu(id: string, deps: CanvasObjectMenuDeps): CanvasObjectMenuRequest | null;
  /**
   * Image-only overlay inputs today — the overlay's `onCropUpdate` / `canCrop`
   * contract, which hands back the dragged handle and the pointer in object
   * space because the crop math needs the source pixels it cannot see.
   * Optional so the other layers omit them.
   */
  applyCrop?(id: string, handle: AnnotationResizeHandle, pointer: { x: number; y: number }): void;
  canCrop?(id: string): boolean;
  /** Text-only: open the box for editing. */
  requestEdit?(id: string): void;
}

export interface CanvasLayerBindings {
  /** The binding whose kinds include `id`'s, or null for an id no layer holds. */
  byId(id: string): CanvasLayerBinding | null;
  /** Release every layer's selection — deselecting is each layer's own business. */
  releaseAll(): void;
  transformables: readonly TransformableCanvasObject[];
  overlayBoxes: readonly CanvasOverlayBox[];
  inertBodyIds: ReadonlySet<string>;
}

/**
 * Concatenate the layers and dispatch by id through the kind table.
 *
 * `kindOf` is the resolver over the store (`canvasObjectKindOf`), passed in so
 * the merge stays pure: a binding declares which kinds it answers for and the
 * table says which kind an id is, so neither the merge nor the panel has to
 * recognise an id by its shape. Pure, so `useMemo` on the three bindings.
 */
export function mergeCanvasLayerBindings(
  bindings: readonly CanvasLayerBinding[],
  kindOf: (id: string) => CanvasObjectKind | null
): CanvasLayerBindings {
  const byKind = new Map<CanvasObjectKind, CanvasLayerBinding>();
  for (const binding of bindings) {
    for (const kind of binding.kinds) byKind.set(kind, binding);
  }
  return {
    byId: (id) => {
      const kind = kindOf(id);
      return kind === null ? null : (byKind.get(kind) ?? null);
    },
    releaseAll: () => {
      for (const binding of bindings) binding.release();
    },
    transformables: bindings.flatMap((binding) => binding.transformables),
    overlayBoxes: bindings.flatMap((binding) => binding.overlayBoxes),
    inertBodyIds: new Set(bindings.flatMap((binding) => [...binding.inertBodyIds])),
  };
}
