import { useRef } from 'react';
import type { FoldBrowserPicture } from '../../diagram/fold/foldPull';
import { useNearView } from '../../diagram/pictures/useStepPictureUrl';
import { useFoldCardPicture } from '../../fold/sequence/useFoldCardPictures';
import { PictureLoading } from '../ui/PictureLoading';
import { DiagramPullCardCantDraw } from './DiagramReferencesCard';
import styles from './DiagramFoldPicture.module.css';

/**
 * The Fold browser card's folded-paper picture, requested only as the card
 * comes into view. On its way — the replay still to land the step, the card
 * not yet near the view, the paper being painted — it shows the loading
 * state; it says it can't be drawn only when nothing will land, or the paint
 * came to nothing.
 */
export function DiagramFoldPicture({ picture }: { picture: FoldBrowserPicture }) {
  const element = useRef<HTMLSpanElement>(null);
  const near = useNearView(element);
  const painted = useFoldCardPicture(near && picture.status === 'landed' ? picture.source : null);
  const url = picture.status === 'none' ? null : near && picture.status === 'landed' ? painted : undefined;
  return (
    <span ref={element} className={styles.frame}>
      {url ? (
        <img className={styles.picture} src={url} alt="" draggable={false} decoding="async" data-fold-picture="paper" />
      ) : url === undefined ? (
        <PictureLoading />
      ) : (
        <DiagramPullCardCantDraw />
      )}
    </span>
  );
}
