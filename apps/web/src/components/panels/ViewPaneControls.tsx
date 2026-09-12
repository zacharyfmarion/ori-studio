import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Toggle } from '../ui/Toggle';

/**
 * The building blocks a workspace's View pane is made of: a titled group of
 * options, and a labelled switch inside one.
 *
 * Shared by the Simulate and References panes, which used to carry a copy each
 * — the same chevron, the same `data-open` hook, the same dimmed label on a
 * disabled row. The Edit pane's rows predate both and keep their own shape (its
 * disclosures are per-setting, `grid-settings`, rather than per-section).
 */

/**
 * One group of options.
 *
 * `collapsible` sections start closed, following `GridSettingsSection` in the
 * Edit workspace's view pane — same chevron, same `data-open` hook, same
 * component-local state rather than a persisted preference. A set of controls
 * most sessions never touch should not push the ones that matter below the
 * fold.
 */
export function ViewPaneSection({
  title,
  description,
  action,
  collapsible = false,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  collapsible?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const body = (
    <>
      {description && <p className="view-pane-section__hint">{description}</p>}
      {children}
    </>
  );

  if (!collapsible) {
    return (
      <div className="view-pane-section">
        <div className="view-pane-section__header">
          <span className="view-pane-section__title">{title}</span>
          {action}
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="view-pane-section" data-open={open || undefined}>
      <div className="view-pane-section__header">
        <button
          type="button"
          className="view-pane-section__toggle"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronRight size={13} className="view-pane-section__chevron" aria-hidden="true" />
          <span className="view-pane-section__title">{title}</span>
        </button>
        {/* The action only makes sense against controls you can see. */}
        {open && action}
      </div>
      {open && body}
    </div>
  );
}

/**
 * A labelled switch.
 *
 * `nested` sets the row a step in, for an option that qualifies the one above
 * it — "Only where needed" under "Precrease grid" — so the pair reads as one
 * setting, the way `.context-menu__item--nested` does in a menu.
 */
export function ViewPaneToggleRow({
  label,
  checked,
  disabled,
  nested = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  nested?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div
      className={nested ? 'control-row control-row--nested' : 'control-row'}
      data-disabled={disabled || undefined}
    >
      <span className="control-row__label">{label}</span>
      <div className="control-row__value control-row__value--toggle">
        <Toggle aria-label={label} checked={checked} disabled={disabled} onChange={onChange} />
      </div>
    </div>
  );
}
