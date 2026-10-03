import type { ReactNode } from 'react';
import { Info, TriangleAlert } from 'lucide-react';
import styles from './Notice.module.css';

export type NoticeTone = 'info' | 'warning';

/**
 * A sentence the surface needs read before it is used: a document that opens
 * read-only, the steps an export will leave blank. Not an error and not a
 * toast — it stays as long as what it describes does. A `status` region, so a
 * screen reader hears it when it appears.
 */
export function Notice({ tone = 'info', children }: { tone?: NoticeTone; children: ReactNode }) {
  const Icon = tone === 'warning' ? TriangleAlert : Info;
  return (
    <div className={styles.notice} data-tone={tone} role="status">
      <Icon size={14} className={styles.icon} aria-hidden="true" />
      <div className={styles.body}>{children}</div>
    </div>
  );
}
