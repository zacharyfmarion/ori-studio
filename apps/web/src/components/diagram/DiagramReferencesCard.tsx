import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { DiagramStyle } from '../../diagram/document/diagramDocument';
import { stepPictureUrl, useNearView } from '../../diagram/pictures/useStepPictureUrl';
import type { BrowserCard } from '../../diagram/references/referencesBrowserPlans';
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
  const picture = card.step?.picture ?? null;
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
    <div
      ref={own}
      role="option"
      aria-selected={selected}
      aria-disabled={!choosable || undefined}
      tabIndex={tabStop ? 0 : -1}
      className={styles.card}
      data-card-index={card.index}
      data-selected={selected || undefined}
      data-offered={offered || undefined}
      data-kind={card.kind}
      title={
        unreadable
          ? t('panels:diagram.references.unreadableCard', 'This card’s picture can’t be read, so it can’t be added.')
          : !choosable
            ? t('panels:diagram.references.unfinishedCard', 'The plan stopped before its end, so it has no finished step to add.')
            : undefined
      }
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
        {card.badge && card.kind === 'fold' && <span className={styles.badge}>{card.badge}</span>}
      </div>
      <div className={styles.well} data-picture={url !== null || undefined}>
        {url ? (
          <img className={styles.picture} src={url} alt="" draggable={false} decoding="async" />
        ) : unreadable ? (
          <span className={styles.placeholder}>{t('panels:diagram.references.cantDraw', 'Can’t be drawn')}</span>
        ) : null}
        {(inDiagram !== null || shownNow) && (
          <span className={styles.flag} data-shown={shownNow || undefined}>
            {shownNow
              ? t('panels:diagram.references.shownNow', 'Shown now')
              : t('panels:diagram.references.inDiagram', 'In diagram · step {{number}}', { number: inDiagram })}
          </span>
        )}
      </div>
      <p className={styles.sentence}>{card.sentence}</p>
      {card.ways !== null && (
        <p className={styles.ways}>
          {t('panels:diagram.references.ways', {
            count: card.ways,
            defaultValue_one: '{{count}} way',
            defaultValue_other: '{{count}} ways',
          })}
        </p>
      )}
    </div>
  );
}
