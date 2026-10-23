import { LoaderCircle } from 'lucide-react';
import styles from './PictureLoading.module.css';

/**
 * A lazily drawn picture still on its way: a spinner in the middle of the
 * space the picture will fill. The Diagram's step cards and pages show it
 * until their bitmap is on screen, the Fold browser's cards until their
 * paper is painted. Decorative, as the pictures it stands in for are.
 */
export function PictureLoading() {
  return (
    <span className={styles.loading} data-picture-loading="">
      <LoaderCircle size={16} className={styles.spinner} aria-hidden="true" />
    </span>
  );
}
