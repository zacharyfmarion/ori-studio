import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronRight } from 'lucide-react';
import type { ComponentProps, HTMLAttributes, LabelHTMLAttributes } from 'react';
import styles from './Menu.module.css';

/*
 * The parts every dropdown and context menu is drawn with: the surface, its
 * rows, and what goes in a row. Radix's `DropdownMenu` supplies the behaviour —
 * focus, roving, typeahead, dismissal — and these supply the look, so a
 * toolbar's dropdown and the canvas's right-click menu are one thing rather
 * than a class list copied into each.
 */

type Unstyled<T> = Omit<T, 'className'>;
type SpanProps = Unstyled<HTMLAttributes<HTMLSpanElement>>;

/**
 * A menu's surface, portalled to the body so no container clips or transforms it.
 *
 * `fitTrigger` sizes it from its trigger, as a select list is, rather than at
 * the width a menu of commands gets: for a short list of values, such as the
 * zoom presets under a percentage readout.
 */
export function MenuContent({
  fitTrigger,
  ...props
}: Unstyled<ComponentProps<typeof DropdownMenu.Content>> & { fitTrigger?: boolean }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        className={styles.content}
        data-fit-trigger={fitTrigger || undefined}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

/** A submenu's surface, portalled like the menu's own. */
export function MenuSubContent(props: Unstyled<ComponentProps<typeof DropdownMenu.SubContent>>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.SubContent className={styles.content} {...props} />
    </DropdownMenu.Portal>
  );
}

/**
 * A row that acts. `asChild` makes a link of it; `data-danger` marks one that
 * destroys something.
 */
export function MenuItem(props: Unstyled<ComponentProps<typeof DropdownMenu.Item>>) {
  return <DropdownMenu.Item className={styles.item} {...props} />;
}

/**
 * A row that is on or off. Its check is the caller's to draw, in `MenuItemIcon`.
 * `multiline` for a row whose label runs to more than one line — a name and a
 * hint under it: its check then sits beside the first line, not the middle.
 */
export function MenuCheckboxItem({
  multiline,
  ...props
}: Unstyled<ComponentProps<typeof DropdownMenu.CheckboxItem>> & { multiline?: boolean }) {
  return <DropdownMenu.CheckboxItem className={styles.item} data-multiline={multiline || undefined} {...props} />;
}

/** A row that opens a submenu, with the chevron that says so. */
export function MenuSubTrigger({
  children,
  ...props
}: Unstyled<ComponentProps<typeof DropdownMenu.SubTrigger>>) {
  return (
    <DropdownMenu.SubTrigger className={styles.item} {...props}>
      {children}
      <span className={styles.subtriggerArrow} aria-hidden>
        <ChevronRight size={12} />
      </span>
    </DropdownMenu.SubTrigger>
  );
}

/**
 * A row that is not a menu item: a control laid out as one. A slider wrapped in
 * a `MenuItem` would lose its arrow keys to the menu's roving focus; in a
 * label it keeps them.
 */
export function MenuControlRow(props: Unstyled<LabelHTMLAttributes<HTMLLabelElement>>) {
  return <label className={styles.item} {...props} />;
}

/**
 * A row's leading slot: an icon, a check, a swatch. A row with nothing to draw
 * there can keep the slot empty, so its label lines up with its siblings'.
 */
export function MenuItemIcon(props: SpanProps) {
  return <span className={styles.icon} data-menu-icon="" {...props} />;
}

export function MenuItemLabel(props: SpanProps) {
  return <span className={styles.label} {...props} />;
}

/** Trailing text: a key chord, or a size. */
export function MenuItemShortcut(props: SpanProps) {
  return <span className={styles.shortcut} {...props} />;
}

export function MenuSeparator(props: Unstyled<ComponentProps<typeof DropdownMenu.Separator>>) {
  return <DropdownMenu.Separator className={styles.separator} {...props} />;
}

/** A heading over a group of rows — an operating system over its builds, say. */
export function MenuGroupLabel(props: Unstyled<ComponentProps<typeof DropdownMenu.Label>>) {
  return <DropdownMenu.Label className={styles.groupLabel} {...props} />;
}
