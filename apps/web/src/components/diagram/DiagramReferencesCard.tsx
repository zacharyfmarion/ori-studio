import { forwardRef, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { DiagramStyle } from '../../diagram/document/diagramDocument';
import { stepPictureUrl, useNearView } from '../../diagram/pictures/useStepPictureUrl';
import type { BrowserCard } from '../../diagram/references/referencesBrowserPlans';
import { shownCardPicture } from '../../diagram/references/referencesCardMarks';
import type { PaperExportMarks } from '../../lib/paperExportSettings';
import styles from './DiagramReferencesCard.module.css';

/**
 * One card in the References browser (D20): the picture it would become, in
 * the diagram's pens, its number or what it is, its sentence, and what the
 * reader needs before adding it — that a step already uses it, that it is the
 * card a replaced step shows now, how many ways it can be folded. An option
 * of the browser's list: a press adds it to what is chosen or takes it away,
 * with Shift every card from the last one pressed (`browserSelection.press`);
 * the list's own keys walk it.
 *
 * A card that cannot be chosen says why: its picture does not read, or it is
 * the ending of a plan that stopped before its end.
 */
export function DiagramReferencesCard({
  card,
  style,
  marks,
  selected,
  tabStop,
  inDiagram,
  shownNow,
  offered,
  choosable,
  onPress,
  onFocus,
}: {
  card: BrowserCard;
  style: DiagramStyle;
  /** The marks the Show menu shows (17d): the picture leaves the others out, as the pull does. */
  marks: PaperExportMarks;
  selected: boolean;
  /** The list's one Tab stop: the card last pressed, or the first. */
  tabStop: boolean;
  /** The step already made from this card, 1-based; null for none. */
  inDiagram: number | null;
  /** The card the step being replaced shows now. */
  shownNow: boolean;
  /** Not selected, but added with the selection: the turn-over just before it. */
  offered: boolean;
  /** It can be chosen (`selectable`). */
  choosable: boolean;
  onPress: (modifiers: { range: boolean }) => void;
  /** It took focus: where the keyboard is now. */
  onFocus: () => void;
}) {
  const { t } = useTranslation();
  const own = useRef<HTMLDivElement | null>(null);
  const near = useNearView(own);
  const { letters, highlights } = marks;
  const shown = card.step?.picture ?? null;
  const picture = useMemo(() => (shown ? shownCardPicture(shown, { letters, highlights }) : null), [shown, letters, highlights]);
  const url = useMemo(
    () => (near && picture ? stepPictureUrl({ kind: 'step-diagram', picture }, style) : null),
    [near, picture, style]
  );
  const title =
    card.kind === 'fold'
      ? t('panels:diagram.references.card', 'Card {{number}}', { number: card.number ?? '' })
      : card.kind === 'turn-over'
        ? t('panels:diagram.references.turnOver', 'Turn over')
        : t('panels:diagram.references.finished', 'Finished');
  const unreadable = card.step === null;
  return (
    <DiagramPullCard
      ref={own}
      index={card.index}
      kind={card.kind}
      title={title}
      badge={card.kind === 'fold' ? card.badge : ''}
      picture={url ? <img className={styles.picture} src={url} alt="" draggable={false} decoding="async" /> : null}
      unreadable={unreadable}
      why={
        unreadable
          ? t('panels:diagram.references.unreadableCard', 'This card’s picture can’t be read, so it can’t be added.')
          : !choosable
            ? t('panels:diagram.references.unfinishedCard', 'The plan stopped before its end, so it has no finished step to add.')
            : undefined
      }
      sentence={card.sentence}
      ways={card.ways}
      inDiagram={inDiagram}
      shownNow={shownNow}
      selected={selected}
      tabStop={tabStop}
      offered={offered}
      choosable={choosable}
      onPress={onPress}
      onFocus={onFocus}
    />
  );
}

/**
 * One card of a pull browser (D20; fold-workspace plan D17), as it looks:
 * its title and badge, its picture, its sentence, and what the reader needs
 * before adding it — that a step already uses it, that it is the card a
 * replaced step shows now, how many ways it can be folded. An option of the
 * browser's list: a press adds it to what is chosen or takes it away, with
 * Shift every card from the last one pressed; the list's own keys walk it.
 * A card that cannot be chosen says why (`why`).
 */
export const DiagramPullCard = forwardRef<
  HTMLDivElement,
  {
    index: number;
    kind: 'fold' | 'turn-over' | 'done';
    title: string;
    /** What a card that is not an ordinary fold is, or must tell; empty for none. */
    badge: string;
    /**
     * The picture it would become: drawn, or the loading state while it is
     * on its way; null while it is not asked for yet, or cannot be drawn.
     */
    picture: ReactNode;
    /**
     * The picture is on the paper it prints on, white in either theme (a
     * step's picture); false for lines in the theme's inks (a thumbnail).
     * True by default.
     */
    onPaper?: boolean;
    /** It cannot be added: a press does nothing; with no picture, the well says it cannot be drawn. */
    unreadable: boolean;
    /** Why it cannot be added, as its tooltip; absent when it can. */
    why?: string;
    sentence: string;
    /** How many ways its fold can be made, when more than one. */
    ways: number | null;
    /** The step already made from it, 1-based; null for none. */
    inDiagram: number | null;
    /** The card the step being replaced shows now. */
    shownNow: boolean;
    selected: boolean;
    /** The list's one Tab stop. */
    tabStop: boolean;
    /** Not selected, but added with the selection: the turn just before it. */
    offered: boolean;
    choosable: boolean;
    onPress: (modifiers: { range: boolean }) => void;
    onFocus: () => void;
  }
>(function DiagramPullCard(
  {
    index,
    kind,
    title,
    badge,
    picture,
    onPaper = true,
    unreadable,
    why,
    sentence,
    ways,
    inDiagram,
    shownNow,
    selected,
    tabStop,
    offered,
    choosable,
    onPress,
    onFocus,
  },
  ref
) {
  const { t } = useTranslation();
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      aria-disabled={!choosable || undefined}
      tabIndex={tabStop ? 0 : -1}
      className={styles.card}
      data-card-index={index}
      data-selected={selected || undefined}
      data-offered={offered || undefined}
      data-kind={kind}
      title={why}
      onFocus={onFocus}
      onClick={(event) => {
        if (unreadable) return;
        onPress({ range: event.shiftKey });
      }}
    >
      <div className={styles.header}>
        <span className={styles.mark} aria-hidden="true">
          {selected && <Check size={11} strokeWidth={3} />}
        </span>
        <span className={styles.title}>{title}</span>
        {badge && <span className={styles.badge}>{badge}</span>}
      </div>
      <div className={styles.well} data-picture={(picture !== null && onPaper) || undefined}>
        {picture ?? (unreadable ? <DiagramPullCardCantDraw /> : null)}
      </div>
      <p className={styles.sentence}>{sentence}</p>
      {/* Under the sentence, off the picture: on it, the flag covered a letter in the sheet's corner (17d review). */}
      {(ways !== null || inDiagram !== null || shownNow) && (
        <div className={styles.footer}>
          {ways !== null && (
            <p className={styles.ways}>
              {t('panels:diagram.references.ways', {
                count: ways,
                defaultValue_one: '{{count}} way',
                defaultValue_other: '{{count}} ways',
              })}
            </p>
          )}
          {(inDiagram !== null || shownNow) && (
            <span className={styles.flag} data-shown={shownNow || undefined}>
              {shownNow
                ? t('panels:diagram.references.shownNow', 'Shown now')
                : t('panels:diagram.references.inDiagram', 'In diagram · step {{number}}', { number: inDiagram })}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

/** A Fold step's picture in a pull card: its folded form, as Fold's strip draws it, in the card's well. */
export function DiagramPullCardThumbnail({ children }: { children: ReactNode }) {
  return <span className={styles.thumbnail}>{children}</span>;
}

/** What a pull card's well says when its picture failed to draw, or there is nothing to draw it from. */
export function DiagramPullCardCantDraw() {
  const { t } = useTranslation();
  return <span className={styles.placeholder}>{t('panels:diagram.references.cantDraw', 'Can’t be drawn')}</span>;
}
