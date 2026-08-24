import type { ReactNode } from 'react';

/**
 * What the floating viewport toolbar is made of, and how it is arranged for a
 * given pointer.
 *
 * The bar used to be a flat run of controls with `<ViewportToolbarSeparator />`
 * hand-placed between the runs its author had in mind. On a coarse pointer every
 * control grows to a 44px target, the row outgrows a portrait canvas, and
 * `flex-wrap` then broke it wherever width happened to run out — mid-run, and
 * repeatedly just after a separator, leaving a hairline stranded at the end of a
 * line with nothing after it.
 *
 * Both halves of that are fixed here rather than in CSS, because both are really
 * questions about *structure*:
 *
 * - A separator is no longer authored. It is derived, by
 *   {@link viewportToolbarSlots}, from the seam between two groups that are both
 *   non-empty — so there is no arrangement of conditional controls that can
 *   produce a leading, trailing, or doubled one.
 * - A group is the unit that wraps (see `.viewport-toolbar__group`), so a line
 *   break can only fall on a seam an author chose.
 *
 * Free of React beyond the `ReactNode` an opaque item carries, and free of the
 * store, so the arrangement is directly testable — which matters because the
 * widths that motivate it are only measurable on a device.
 */

/** Which pointer an item is for, when it is not for both. */
export type ViewportToolbarPointer = 'fine' | 'coarse';

/**
 * A control the bar renders itself, and can therefore also render as a menu
 * item — which is what lets it move into the overflow menu on a touch device.
 */
export interface ViewportToolbarAction {
  kind: 'action';
  id: string;
  /** Accessible name inline, and the item's text in the overflow menu. */
  label: string;
  /** Tooltip, when it says more than the label does. Defaults to `label`. */
  title?: string;
  icon: ReactNode;
  disabled?: boolean;
  /**
   * Present ⇒ this is a mode rather than a verb: it renders pressed inline and
   * as a checked item in the menu.
   */
  checked?: boolean;
  /**
   * Set on a mode whose being on is not visible anywhere else. The pan tool
   * qualifies: it changes what a drag on the canvas does and draws nothing.
   * A layer toggle does not — you can see the layer — and neither does mirror
   * draw, which puts its axis on the paper.
   *
   * Such a mode lights the overflow trigger while it is collapsed, so it is
   * never silently on. Marking the ones that need no announcement is what keeps
   * that light meaningful: layers default to visible, so counting every checked
   * item would leave the trigger permanently lit.
   */
  unseenWhenCollapsed?: boolean;
  onSelect: () => void;
  /** Render only under this pointer. Both, when unset. */
  only?: ViewportToolbarPointer;
  /**
   * Keep inline even on a coarse pointer. For a control whose value is that it
   * is one tap away — the zoom cluster, Fit — or one no gesture replaces.
   */
  pinned?: boolean;
}

/**
 * A control the bar cannot render for itself: a popover, a form, a named toggle.
 *
 * These never collapse. A popover trigger inside a menu means a popover inside a
 * menu's focus trap, and two of the ones here (the box-pleating sheet and
 * symmetry menus) are forms — a segmented picker and number fields — which have
 * no menu-item form at all.
 */
export interface ViewportToolbarNode {
  kind: 'node';
  id: string;
  node: ReactNode;
  only?: ViewportToolbarPointer;
}

export type ViewportToolbarItem = ViewportToolbarAction | ViewportToolbarNode;

/**
 * An item, or the `false`/`null`/`undefined` a conditional control evaluates to.
 * Accepting those is what keeps a call site reading as a list rather than as a
 * chain of spreads.
 */
export type ViewportToolbarEntry = ViewportToolbarItem | false | null | undefined;

/** A run of controls that belongs together, and must not be split by a wrap. */
export interface ViewportToolbarGroupSpec {
  id: string;
  items: readonly ViewportToolbarEntry[];
}

export interface ViewportToolbarGroup {
  id: string;
  items: ViewportToolbarItem[];
}

export interface ViewportToolbarOverflowGroup {
  id: string;
  items: ViewportToolbarAction[];
}

export interface ViewportToolbarPlan {
  /** Groups the bar renders, in order. Every one has at least one item. */
  inline: ViewportToolbarGroup[];
  /** Actions behind the overflow trigger. Empty on a fine pointer. */
  overflow: ViewportToolbarOverflowGroup[];
}

function forPointer(item: ViewportToolbarItem, coarse: boolean): boolean {
  return item.only === undefined || item.only === (coarse ? 'coarse' : 'fine');
}

function staysInline(item: ViewportToolbarItem, coarse: boolean): boolean {
  return !coarse || item.kind === 'node' || item.pinned === true;
}

/**
 * Split the declared groups into what the bar shows and what the overflow menu
 * holds.
 *
 * On a fine pointer nothing collapses: the result is the same flat sequence the
 * bar rendered before groups existed, which is what keeps the desktop layout
 * untouched.
 */
export function planViewportToolbar(
  groups: readonly ViewportToolbarGroupSpec[],
  coarse: boolean
): ViewportToolbarPlan {
  const inline: ViewportToolbarGroup[] = [];
  const overflow: ViewportToolbarOverflowGroup[] = [];

  for (const group of groups) {
    const present: ViewportToolbarItem[] = [];
    for (const entry of group.items) {
      if (entry && forPointer(entry, coarse)) present.push(entry);
    }
    const inlineItems = present.filter((item) => staysInline(item, coarse));
    const overflowItems = present.filter(
      (item): item is ViewportToolbarAction => item.kind === 'action' && !staysInline(item, coarse)
    );
    if (inlineItems.length > 0) inline.push({ id: group.id, items: inlineItems });
    if (overflowItems.length > 0) overflow.push({ id: group.id, items: overflowItems });
  }

  return { inline, overflow };
}

/** A group, or the seam before it. What both renderers actually walk. */
export type ViewportToolbarSlot<Group extends { id: string }> =
  | { kind: 'separator'; id: string }
  | { kind: 'group'; id: string; group: Group };

/**
 * Interleave separators between groups.
 *
 * The one place a separator comes from, for the bar and for the menu alike. A
 * seam exists only *between* two groups, so a stranded one is not something a
 * caller can express — which is the whole reason separators stopped being
 * authored.
 */
export function viewportToolbarSlots<Group extends { id: string }>(
  groups: readonly Group[]
): ViewportToolbarSlot<Group>[] {
  const slots: ViewportToolbarSlot<Group>[] = [];
  for (const group of groups) {
    if (slots.length > 0) slots.push({ kind: 'separator', id: `separator-${group.id}` });
    slots.push({ kind: 'group', id: group.id, group });
  }
  return slots;
}

/**
 * Whether the menu hides a mode that is on and shows nowhere else.
 *
 * Hiding a mode is the one real risk in collapsing controls, and the trigger
 * carries this so the state stays visible. See `unseenWhenCollapsed` for why it
 * is not simply "any checked item".
 */
export function hasUnseenActiveMode(overflow: readonly ViewportToolbarOverflowGroup[]): boolean {
  return overflow.some((group) =>
    group.items.some((item) => item.checked === true && item.unseenWhenCollapsed === true)
  );
}
