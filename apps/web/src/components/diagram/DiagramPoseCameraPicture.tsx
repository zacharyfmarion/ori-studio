import styles from './DiagramPoseCameraPicture.module.css';

/** The same vector picture as Pages, framed exactly like the live camera. */
export function DiagramPoseCameraPicture({ url }: { url: string }) {
  return <div className={styles.frame} data-camera-picture="">
    <img className={styles.picture} src={url} alt="" draggable={false} />
  </div>;
}
