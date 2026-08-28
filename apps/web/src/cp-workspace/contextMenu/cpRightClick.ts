/**
 * What a right-button release on the crease-pattern canvas does.
 *
 * The right button on this surface is Oriedita's **erase** gesture, ported
 * verbatim: `Canvas.java:329` activates `LINE_SEGMENT_DELETE_3` on `BUTTON3`
 * unconditionally, and its drag/release pair erase a box or the primitive under
 * the cursor. A context menu on the same button is therefore not an addition —
 * it is a claim on a gesture that already means something.
 *
 * The rule, decided with the author and stated once here:
 *
 * | Gesture | Outcome |
 * | --- | --- |
 * | Right-**drag** | Erase box. Always — a menu can never interrupt a drag. |
 * | Right-click on a folded figure | That figure's menu (already true before this). |
 * | Right-click **with a selection** | The selection's menu. |
 * | Right-click with **nothing selected** | Erase, exactly as upstream. |
 *
 * The last two rows are the trade. Erasing is overwhelmingly something you do to
 * creases you have *not* selected — you point at a stray line and get rid of it —
 * so gating the menu on a live selection leaves that path untouched while giving
 * the verbs to the person who has just selected creases and is looking for
 * something to do with them.
 *
 * A pure function, for the same reason `cpPointerReleaseRoute` is one: the
 * precedence is the whole design, and it should be checkable without a canvas,
 * a kernel, or a pointer.
 */

export type CpRightClickOutcome =
  /** Raise the clicked folded figure's menu. */
  | 'folded-figure-menu'
  /** Raise the crease selection's menu. */
  | 'selection-menu'
  /** Hand back to the erase runtime — box, or the primitive under the cursor. */
  | 'erase'
  /** Cancelled mid-gesture; roll the erase runtime back and do nothing. */
  | 'cancel';

export interface CpRightClickState {
  /** The pointer travelled past the click threshold since the press. */
  moved: boolean;
  /** The release arrived as `pointercancel` rather than `pointerup`. */
  cancelled: boolean;
  /** The folded figure under the cursor, when the release was a click. */
  figureId: string | null;
  /** Whether the crease pattern has anything selected. */
  hasSelection: boolean;
}

export function cpRightClickOutcome(state: CpRightClickState): CpRightClickOutcome {
  if (state.cancelled) return 'cancel';
  // A drag is an erase box and nothing else. Tested before the target checks, so
  // no later branch can forget it — dragging *across* a folded figure or a
  // selection still erases, which is what the box is for.
  if (state.moved) return 'erase';
  if (state.figureId !== null) return 'folded-figure-menu';
  if (state.hasSelection) return 'selection-menu';
  return 'erase';
}

/** Whether any of the crease pattern's primitive kinds has a selection. */
export function cpHasSelection(selection: {
  lines: readonly number[];
  points: readonly number[];
  circles: readonly number[];
}): boolean {
  return (
    selection.lines.length > 0 || selection.points.length > 0 || selection.circles.length > 0
  );
}
