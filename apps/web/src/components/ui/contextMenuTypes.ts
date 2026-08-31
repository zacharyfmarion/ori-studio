import type { ReactNode } from 'react';

/**
 * A single entry in a {@link ContextMenu}. `action` items are selectable; a
 * `separator` draws a divider between groups; a `submenu` nests further items
 * behind a hover/arrow-key trigger; a `radio` item is a selectable member of a
 * mutually exclusive set (e.g. a display mode) and renders a check when current.
 * Content is supplied by whoever raises the menu, so the component stays
 * target-agnostic and reusable.
 */
export type ContextMenuItem =
  | {
      kind: 'action';
      id: string;
      label: string;
      icon?: ReactNode;
      /** Optional right-aligned hint, e.g. a keyboard shortcut. */
      shortcut?: string;
      /**
       * Why this row is the way it is, shown on hover as the row's tooltip.
       *
       * Carried mainly by *disabled* rows, where it is the difference between a
       * dead end and an instruction ("Select one or more crease-pattern lines
       * first"). A menu has nowhere else to say that: there is no status line
       * under it and a greyed row explains itself to nobody.
       */
      hint?: string;
      disabled?: boolean;
      /** Renders the item in a destructive tone (e.g. Delete). */
      danger?: boolean;
      onSelect: () => void;
    }
  | { kind: 'separator' }
  | {
      kind: 'submenu';
      id: string;
      label: string;
      icon?: ReactNode;
      disabled?: boolean;
      items: ContextMenuItem[];
    }
  | {
      kind: 'radio';
      id: string;
      label: string;
      /** Whether this is the current member of its set. */
      checked: boolean;
      disabled?: boolean;
      onSelect: () => void;
    };

/**
 * A request to open a context menu at viewport coordinates `x`/`y` with the
 * given items. `null` means no menu is open.
 */
export interface ContextMenuRequest {
  x: number;
  y: number;
  items: ContextMenuItem[];
}
