import type { ReactNode } from 'react';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { Button } from './Button';
import styles from './Notice.module.css';

export type NoticeTone = 'info' | 'warning' | 'danger';

/**
 * A way out the notice offers, as a button under its sentence: a refusal's
 * fix ("Include Flap 1", "Mountain fold instead"). A plain descriptor, so an
 * action catalog can hand its verbs over without knowing how they are drawn.
 */
export interface NoticeAction {
  /** Stable among the notice's actions; the button's React key. */
  id: string;
  label: string;
  run: () => void;
  disabled?: boolean;
}

const TONE_ICONS = { info: Info, warning: TriangleAlert, danger: CircleAlert } as const;

/**
 * A sentence the surface needs read before it is used: a document that opens
 * read-only, the steps an export will leave blank. Not an error and not a
 * toast — it stays as long as what it describes does. A `status` region: a
 * notice that appears, or whose sentence changes, is announced. One already on
 * the page when it opens is not announced; it is read where it stands.
 *
 * `danger` is a refusal: what was just asked cannot be done, and the sentence
 * says why. It is an `alert` rather than a `status`, so it is announced at
 * once instead of waiting for the reader to finish — it answers the thing the
 * user just did. It still stays until what it describes changes; it is not
 * dismissed.
 *
 * `actions` are the fixes it offers, as buttons under the sentence. They are
 * inside the live region, so an announcement names the fixes with the reason,
 * and focus is never moved to them: the notice interrupts nothing.
 */
export function Notice({
  tone = 'info',
  actions = [],
  children,
}: {
  tone?: NoticeTone;
  actions?: readonly NoticeAction[];
  children: ReactNode;
}) {
  const Icon = TONE_ICONS[tone];
  return (
    <div className={styles.notice} data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={14} className={styles.icon} aria-hidden="true" />
      <div className={styles.body}>
        {children}
        {actions.length > 0 && (
          <div className={styles.actions}>
            {actions.map((action) => (
              <Button
                key={action.id}
                size="sm"
                variant="secondary"
                disabled={action.disabled}
                onClick={() => action.run()}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
