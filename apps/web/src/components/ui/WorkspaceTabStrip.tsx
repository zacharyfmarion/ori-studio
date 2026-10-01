import * as Tabs from '@radix-ui/react-tabs';
import { Plus, X } from 'lucide-react';
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { IconButton } from './IconButton';
import styles from './WorkspaceTabStrip.module.css';

/**
 * A workspace's row of tabs: the Design workspace's open designs, and the
 * References workspace's two jobs (find a reference, or read the precreasing
 * sequence).
 *
 * One component for both, so the two strips cannot drift apart. They used to
 * get that by sharing global classes, which also let any stylesheet restyle
 * them; the variations a context needs are props here instead.
 *
 * Radix `Tabs` supplies the roles, `aria-selected`, roving tabindex and arrow
 * keys. What an owner does beyond that — drag, rename, a context menu — it
 * composes through {@link WorkspaceTab} and the parts beside it.
 */
export interface WorkspaceTabStripProps {
  /** The active tab's value. */
  value: string;
  onValueChange: (value: string) => void;
  /** Radix's activation mode. `manual` activates on press, not on arrowing past. */
  activationMode?: 'automatic' | 'manual';
  /** The tablist's accessible name. */
  label: string;
  /**
   * Inside a header that already has the height, ground and bottom border (a
   * panel toolbar), rather than being the header itself.
   */
  embedded?: boolean;
  /**
   * `documents`: the active tab dominates and the rest recede (Design's open
   * designs). `peers`: an inactive tab keeps its colour, so the second of two
   * jobs does not read as disabled (References).
   */
  tone?: 'documents' | 'peers';
  /** The tabs share the strip's width, each a touch target tall (a phone). */
  fill?: boolean;
  /** Offers a "new tab" button after the tabs. */
  onAdd?: () => void;
  addLabel?: string;
  /** Placement by the parent, on the root only (`docs/styling.md`, rule 3). */
  className?: string;
  'data-testid'?: string;
  children: ReactNode;
}

export function WorkspaceTabStrip({
  value,
  onValueChange,
  activationMode,
  label,
  embedded = false,
  tone = 'documents',
  fill = false,
  onAdd,
  addLabel,
  className,
  'data-testid': testId,
  children,
}: WorkspaceTabStripProps) {
  return (
    <div
      className={className ? `${styles.strip} ${className}` : styles.strip}
      data-embedded={embedded || undefined}
      data-tone={tone}
      data-fill={fill || undefined}
      data-testid={testId}
    >
      <Tabs.Root
        className={styles.root}
        value={value}
        onValueChange={onValueChange}
        activationMode={activationMode}
        orientation="horizontal"
      >
        <Tabs.List className={styles.list} aria-label={label}>
          {children}
        </Tabs.List>
      </Tabs.Root>
      {onAdd ? (
        <IconButton
          size="sm"
          className={styles.add}
          title={addLabel}
          aria-label={addLabel}
          onClick={onAdd}
        >
          <Plus size={14} />
        </IconButton>
      ) : null}
    </div>
  );
}

export interface WorkspaceTabProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** The Radix tab value. */
  value: string;
  /** The tab's label. */
  title: ReactNode;
  icon?: ReactNode;
  /** The trigger's tooltip. */
  hint?: string;
  disabled?: boolean;
  /** Being dragged to a new place. */
  dragging?: boolean;
  /**
   * Shown in place of the trigger, such as an inline rename field
   * ({@link WorkspaceTabInput}). It replaces the trigger rather than nesting in
   * it: a focusable control inside `role="tab"` is invalid, and a disabled
   * trigger would swallow the field's pointer events.
   */
  editor?: ReactNode;
  /** A {@link WorkspaceTabClose}, floated over the trigger's end. */
  close?: ReactNode;
}

/**
 * One tab. The wrapper takes the owner's gestures and data attributes; the
 * trigger fills it, so every point of the tab activates it.
 */
export function WorkspaceTab({
  value,
  title,
  icon,
  hint,
  disabled,
  dragging = false,
  editor,
  close,
  ...wrapper
}: WorkspaceTabProps) {
  return (
    <div className={styles.tab} data-dragging={dragging || undefined} {...wrapper}>
      {editor ?? (
        <Tabs.Trigger value={value} className={styles.trigger} title={hint} disabled={disabled}>
          {icon}
          <span className={styles.title}>{title}</span>
        </Tabs.Trigger>
      )}
      {close}
    </div>
  );
}

/** A tab's close button: a sibling of the trigger, never a child. */
export function WorkspaceTabClose(
  props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'type'>
) {
  return (
    <button type="button" className={styles.close} {...props}>
      <X size={12} />
    </button>
  );
}

/** The field a tab's title is edited in, shown through {@link WorkspaceTabProps.editor}. */
export const WorkspaceTabInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>
>(function WorkspaceTabInput(props, ref) {
  return <input ref={ref} className={styles.nameInput} {...props} />;
});
