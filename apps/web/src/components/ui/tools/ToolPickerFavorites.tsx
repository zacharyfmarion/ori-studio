/**
 * The starred tools, as a section of the phone tool sheet: Edit's below its
 * crease types, Fold's at the head of its list.
 *
 * # Why a bespoke section and not a catalogue group
 *
 * A workspace's rail groups are a pure read of its shipped catalogue, shared
 * with the tablet rail. Making them depend on mutable user state would break
 * that purity and hand the rail a Favorites group we are not shipping there.
 * Favorites is a *view* of the catalogue, not a member of it.
 *
 * # Reordering
 *
 * Long press and drag, and nothing else. A pair of Move up / Move down buttons
 * shipped here first — `DesignTabStrip`'s answer, where they are the pointer-free
 * equivalent of its drag — and they were removed on purpose: this is the phone
 * surface, they spent 36px of a 375px row, and the two chevrons pushed most
 * descriptions onto a third line to offer a route for a keyboard the device does
 * not have. What that trade costs is real and worth writing down — with the
 * buttons gone, the drag is the only way to reorder, so VoiceOver, which claims
 * touch and cannot perform one, has none. The cheap fix if that matters later is
 * to bring them back visually hidden rather than to redesign the row.
 *
 * Reorder-as-you-go, like that strip: the stored array permutes live and the DOM
 * follows, so there is no placeholder to manage and no drop indicator to keep in
 * sync with a list that is already showing the answer.
 *
 * # Empty means gone
 *
 * Un-star everything and the section unmounts rather than showing an empty-state
 * row. The stars in the groups below are how it comes back, they are visible on
 * every row, and a permanent instructional row would spend height on the surface
 * with the least of it.
 *
 * The chrome and the gesture only: the rows, the words and the analytics event
 * are the workspace's.
 */
import type { ReactNode } from 'react';
import { useLongPressReorder } from '../../../hooks/useLongPressReorder';
import { ToolPickerGroup, ToolPickerList, ToolPickerNote } from './ToolPickerGroup';
import type { ToolPickerRowReorder } from './ToolPickerRow';

export function ToolPickerFavorites<Id extends string>({
  title,
  hint,
  ids,
  itemAttribute,
  onMove,
  onReordered,
  renderRow,
}: {
  title: string;
  /**
   * What the surface cannot show on its own: how many reach the bottom bar,
   * which is invisible until someone stars one past it and nothing happens, and
   * that the drag exists, which has no affordance at all.
   */
  hint: string;
  /** The favorites to list, resolved against the catalogue, in the user's order. */
  ids: readonly Id[];
  /**
   * The attribute each row carries holding its id (`data-cp-favorite`), set by
   * `renderRow` on a row given `reorder`: how the drag finds its rows, and why
   * it can never pick up a row from a group below.
   */
  itemAttribute: `data-${string}`;
  /** Called at pointer-move rate while a row is dragged. */
  onMove: (id: Id, toIndex: number) => void;
  /** Once per completed drag, on release, with where the row ended up. */
  onReordered: (toIndex: number) => void;
  renderRow: (id: Id, reorder: ToolPickerRowReorder) => ReactNode;
}) {
  const { draggingId, handlers, consumeClick } = useLongPressReorder({
    itemAttribute,
    onReorder: (id, toIndex) => onMove(id as Id, toIndex),
    // Once per gesture, on release. `onMove` runs at pointer-move rate and would
    // otherwise emit dozens of events for one drag.
    onDragEnd: (_id, toIndex) => onReordered(toIndex),
  });

  if (ids.length === 0) return null;

  return (
    <ToolPickerGroup title={title}>
      <ToolPickerNote>{hint}</ToolPickerNote>
      <ToolPickerList label={title}>
        {ids.map((id) => renderRow(id, { handlers, dragging: draggingId === id, consumeClick }))}
      </ToolPickerList>
    </ToolPickerGroup>
  );
}
