import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { FoldStripCard } from '../../../fold/sequence/foldStripCards';
import { stepPlaceholder } from '../../../fold/sequence/foldSequenceWords';
import { useFoldStepMenu } from '../../../fold/sequence/useFoldStepMenu';
import { useFoldCardPicture, type FoldCardPictureSource } from '../../../fold/sequence/useFoldCardPictures';
import { useFoldStepStrip } from '../../../fold/sequence/useFoldStepStrip';
import type { FoldSequenceView } from '../../../fold/sequence/useFoldSequenceView';
import { useIsPhoneLayout } from '../../../platform/phoneLayout';
import { StepFilmstrip } from '../../steps/StepFilmstrip';
import { ContextMenu } from '../../ui/ContextMenu';
import styles from './FoldStepStrip.module.css';

/**
 * A card's picture: the state its step lands at, as the folded pane paints
 * it — the paper in the user's style, front and back — drawn small. Blank
 * while it is painted, and for a step with no state to draw.
 */
function StepPicture({ source, repeating }: { source: FoldCardPictureSource | null; repeating?: boolean }) {
  const picture = useFoldCardPicture(source);
  if (picture) return <img src={picture} alt="" className={styles.picture} draggable={false} data-fold-picture="paper" data-repeat-source={repeating || undefined} />;
  return <span className={styles.blank} data-fold-picture={picture === undefined ? 'painting' : 'none'} />;
}

/** Module-level, so the strip sees one function for the life of the app and redraws no picture for being re-rendered. */
function renderStepPicture(card: FoldStripCard) {
  return <StepPicture source={card.picture} repeating={card.repeatSource} />;
}

/**
 * The step strip along the top of the Fold canvas (plan D14, shot-0): the
 * flat sheet, every step of the active path and the step a tool is folding,
 * as numbered pictures, with the active one's sentence under them and its
 * branches beside that — "Branch 1 of 2", ↑ and ↓ to choose.
 *
 * The shared `StepFilmstrip` with Fold's pictures and words in it; a
 * right-click on a card offers that step's verbs. On a phone the chevrons go,
 * the cards are smaller so the paper keeps the height, and a swipe up or down
 * on a card chooses its branch, or a tap on the "2 / 3" readout steps to the
 * next, the first after the last.
 */
export function FoldStepStrip({ view }: { view: FoldSequenceView }) {
  const { t } = useTranslation();
  const phone = useIsPhoneLayout();
  const strip = useFoldStepStrip(view);
  const { cards } = strip;
  const stepAt = useCallback(
    (target: Element) => {
      // The strip's own marker for a card's place: it is windowed, so the index is the card's, not the child's.
      const item = target.closest<HTMLElement>('[role="listitem"][data-index]');
      const card = item ? cards[Number(item.dataset.index)] : undefined;
      // The step being folded has no verbs of its own yet.
      if (!card || card.entry === null) return null;
      return card.key;
    },
    [cards]
  );
  const menu = useFoldStepMenu(stepAt);
  return (
    <div className={styles.strip} onContextMenu={menu.onContextMenu} data-fold-strip="">
      <StepFilmstrip
        steps={strip.cards}
        renderThumbnail={renderStepPicture}
        label={strip.label}
        activeStep={strip.active}
        onSelectStep={strip.onSelectStep}
        onPrevious={strip.onPrevious}
        onNext={strip.onNext}
        placeholder={stepPlaceholder(t)}
        note={strip.note}
        previousLabel={strip.previousLabel}
        nextLabel={strip.nextLabel}
        navigation={!phone}
        compact={phone}
        previousDisabled={strip.previousDisabled}
        nextDisabled={strip.nextDisabled}
        onPreviousWay={strip.onPreviousWay}
        onNextWay={strip.onNextWay}
        onShiftWay={strip.onShiftWay}
        previousWayLabel={strip.previousWayLabel}
        nextWayLabel={strip.nextWayLabel}
        previousWayDisabled={strip.previousWayDisabled}
        nextWayDisabled={strip.nextWayDisabled}
        waysLabel={strip.waysLabel}
        wayReadout={strip.wayReadout}
        onCycleWay={strip.onCycleWay}
        cycleWayLabel={strip.cycleWayLabel}
        cycleWayDisabled={strip.cycleWayDisabled}
      />
      <ContextMenu
        open={menu.controller.open}
        x={menu.controller.x}
        y={menu.controller.y}
        items={menu.controller.items}
        onOpenChange={menu.controller.onOpenChange}
        onCloseAutoFocus={menu.controller.onCloseAutoFocus}
      />
    </div>
  );
}
