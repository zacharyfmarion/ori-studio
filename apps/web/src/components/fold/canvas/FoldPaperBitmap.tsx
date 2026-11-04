import type { RefObject } from 'react';
import styles from './FoldPaperBitmap.module.css';
/** Paper under the transparent input/tool canvas. The host owns presentation. */
export function FoldPaperBitmap({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }) {
  return <canvas ref={canvasRef} className={styles.paper} aria-hidden="true" data-fold-paper-bitmap="" />;
}
