import type { ReactNode } from 'react';

/**
 * A single entry in a {@link ContextMenu}. `action` items are selectable; a
 * `separator` draws a divider between groups; a `submenu` nests further items
 * behind a hover/arrow-key trigger; a `radio` item is a selectable member of a
 * mutually exclusive set (e.g. a display mode) and renders a check when current;
 * a `checkbox` is an on/off setting that leaves the menu open; a `color` row
 * opens the engine's colour picker for one value. Content is supplied by
 * whoever raises the menu, so the component stays target-agnostic and reusable.
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
      /** Why the trigger is disabled, as its tooltip — see `action.hint`. */
      hint?: string;
      items: ContextMenuItem[];
    }
  | {
      kind: 'radio';
      id: string;
      label: string;
      /** Whether this is the current member of its set. */
      checked: boolean;
      disabled?: boolean;
      /**
       * Leave the menu open after the pick. For a set that is adjusted alongside
       * its neighbours (a figure's render style, next to its colours) rather than
       * chosen and left.
       */
      keepOpen?: boolean;
      onSelect: () => void;
    }
  | {
      kind: 'checkbox';
      id: string;
      label: string;
      checked: boolean;
      disabled?: boolean;
      /** Why the row is disabled, as its tooltip. */
      hint?: string;
      /**
       * Leave the menu open after the toggle, so a run of toggles is one visit.
       * Only for a menu whose rows are rebuilt while it is open; a menu built
       * once at open would go on showing the old check.
       */
      keepOpen?: boolean;
      onToggle: () => void;
    }
  | {
      kind: 'color';
      id: string;
      label: string;
      /** `#rrggbb`, as a colour input takes and returns it. */
      value: string;
      disabled?: boolean;
      /** Per pointer move while the picker is open. */
      onChange: (hex: string) => void;
      /**
       * End of one adjustment. Called when the input blurs and again when the
       * row unmounts, since closing the menu does not always blur it first, so
       * it must tolerate a second call with nothing to commit.
       */
      onCommit: () => void;
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
