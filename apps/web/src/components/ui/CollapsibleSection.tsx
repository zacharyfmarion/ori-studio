import { useId, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

/**
 * A titled group of rows in an options pane, optionally folded behind its
 * title.
 *
 * One disclosure for the panes: the Edit workspace's view pane and the Simulate
 * workspace's options pane each had their own (`GridSettingsSection`,
 * `Section`) with the same chevron, the same `data-open` hook and the same
 * component-local state, and the Properties pane would have been a third. The
 * state is local rather than a persisted preference on purpose — a section is
 * closed because most sessions never touch it, not because the user closed it.
 *
 * `action` is a small control in the header (a reset, say) and is shown only
 * while the section is open: an action against controls you cannot see is a
 * trap.
 */
export function CollapsibleSection({
  title,
  description,
  action,
  collapsible = false,
  defaultOpen = false,
  bodyLabel,
  className,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Accessible name for the body group, when the title alone would not do. */
  bodyLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const shown = !collapsible || open;
  const classes = ['collapsible-section', className].filter(Boolean).join(' ');
  const body = (
    <div
      id={bodyId}
      className="collapsible-section__body"
      role="group"
      aria-label={bodyLabel ?? title}
    >
      {description && <p className="collapsible-section__hint">{description}</p>}
      {children}
    </div>
  );

  return (
    <div className={classes} data-open={shown || undefined}>
      <div className="collapsible-section__header">
        {collapsible ? (
          <button
            type="button"
            className="collapsible-section__toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((current) => !current)}
          >
            <ChevronRight size={13} className="collapsible-section__chevron" aria-hidden="true" />
            <span className="collapsible-section__title">{title}</span>
          </button>
        ) : (
          <span className="collapsible-section__title">{title}</span>
        )}
        {shown && action}
      </div>
      {shown && body}
    </div>
  );
}
