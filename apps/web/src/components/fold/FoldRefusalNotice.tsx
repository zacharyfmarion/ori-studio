import type { FoldRefusalNoticeModel } from '../../fold/tools/refusalNotice';
import { Notice } from '../ui/Notice';
import styles from './FoldRefusalNotice.module.css';

/**
 * A refused fold in the tool window (plan D14): the app's `Notice` in its
 * danger tone, the refusal's title and sentence, and a button per fix the
 * engine offers. An alert, so it is announced as the refusal arrives; it
 * stays until the fold asked for changes. Import CP's dialog says its
 * refusals the same way, under codes of its own.
 */
export function FoldRefusalNotice({
  notice,
}: {
  notice: Omit<FoldRefusalNoticeModel, 'code'> & { code: string };
}) {
  return (
    <Notice tone="danger" actions={notice.actions}>
      <p className={styles.title} data-refusal={notice.code}>
        {notice.title}
      </p>
      <p className={styles.text}>{notice.text}</p>
    </Notice>
  );
}
