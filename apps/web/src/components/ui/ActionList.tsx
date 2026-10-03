import type { LucideIcon } from 'lucide-react';
import styles from './ActionList.module.css';

/** One verb in an {@link ActionList}. */
export interface ActionListItem {
  /** Stable within the list; written as `data-action`, for a focus to find its way back to it. */
  id: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  /**
   * Refusing for now — a capture is running — but keeping the focus, which a
   * disabled control under it would drop on the page.
   */
  waiting?: boolean;
  /** Why it cannot run, or more about what it does: the row's tooltip. */
  hint?: string;
  /** A verb that takes something away. */
  tone?: 'danger';
  run: () => void;
}

/**
 * Verbs in a side pane, one to a row: an icon and a name, the whole row the
 * target, groups set apart by a rule. For a pane's handful of actions on one
 * thing, where buttons of mixed widths would wrap raggedly and a translated
 * label would not fit beside another.
 */
export function ActionList({
  groups,
  'aria-label': ariaLabel,
}: {
  /** Each group in order; an empty one is left out. */
  groups: readonly (readonly ActionListItem[])[];
  'aria-label': string;
}) {
  const shown = groups.filter((group) => group.length > 0);
  if (shown.length === 0) return null;
  return (
    <div className={styles.list} role="group" aria-label={ariaLabel}>
      {shown.map((group) => (
        <div key={group[0]!.id} className={styles.group}>
          {group.map(({ id, label, icon: Icon, disabled, waiting, hint, tone, run }) => (
            <button
              key={id}
              type="button"
              className={styles.item}
              data-action={id}
              data-tone={tone}
              disabled={disabled}
              aria-disabled={waiting || undefined}
              title={hint}
              onClick={() => {
                if (!waiting) run();
              }}
            >
              <Icon className={styles.icon} size={15} aria-hidden="true" />
              <span className={styles.label}>{label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
