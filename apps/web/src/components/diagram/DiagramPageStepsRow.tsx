import { useTranslation } from 'react-i18next';
import { useCurrentDiagramPage, type CurrentDiagramPage } from '../../diagram/pages/useCurrentDiagramPage';
import { Button } from '../ui/Button';
import { NumberRow } from '../ui/fieldRows';
import styles from './DiagramPageStepsRow.module.css';

/** Subscribe here so turning a page doesn't rebuild the entire setup inspector. */
export function CurrentDiagramPageStepsRow({ disabled, onChange }: {
  disabled: boolean;
  onChange: (pageIndex: number, count: number | null) => void;
}) {
  const current = useCurrentDiagramPage();
  return current && current.page.steps.length > 0
    ? <DiagramPageStepsRow current={current} disabled={disabled} onChange={(count) => onChange(current.index, count)} />
    : null;
}

/**
 * The Page pane's count for one flow page, under Steps per page, which stays
 * the default for every page without one
 * (`implementation-plans/diagram-flow-pages.md`, UI): the current page
 * (`useCurrentDiagramPage`) with its own count and Use default, or what it is
 * cut for now and a quiet "Default". A count that holds a later page with one
 * still stays, and says so instead of offering Use default
 * (`countHoldsLaterPages`): taken away, it would leave a page in front of
 * that one which an added step spills off onto a page of one.
 *
 * Every page shows the steps it is laid out for (`layoutCount`): the steps it
 * holds — a counted page's too, which is laid out for them whatever its count
 * says — but on an automatic last page the default, which its few steps fill
 * in order. Typing their number there gives them the page to themselves; the
 * default, or more, leaves it as it is. The field offers only what the page
 * can be given (`pageStepsRange`).
 *
 * The line under the field holds the note or the action, so the stepper
 * stays where it is as one gives way to the other. On the first page under
 * the title block the row's help says why the page holds fewer than Steps
 * per page, or, where the page has a count of its own, how many turning the
 * block off adds to it, and that later pages keep theirs and shift
 * (`implementation-plans/diagram-title-block.md`, Zach's answer of
 * 2026-10-15).
 */
export function DiagramPageStepsRow({
  current,
  disabled,
  onChange,
}: {
  current: CurrentDiagramPage;
  disabled: boolean;
  /** A count for the page, or null to return it to the default. */
  onChange: (count: number | null) => void;
}) {
  const { t } = useTranslation();
  const { page, index, name, range, holdsLaterPages, titleBlockDefault, titleBlockOffAdds } = current;
  const own = page.ownCount;
  return (
    <div className={styles.row}>
      <NumberRow
        // Another page, another field: a number half typed for one page is never committed to the next.
        key={index}
        label={t('panels:diagram.pagePane.pageSteps', 'Steps on page {{number}}', { number: name })}
        help={
          titleBlockDefault === null
            ? undefined
            : own
              ? titleBlockOffAdds === null
                ? undefined
                : t(
                    'panels:diagram.pagePane.pageStepsTitleBlockOwn',
                    'Turning the title block off adds {{number}} to this count; later pages keep theirs and shift.',
                    { number: titleBlockOffAdds }
                  )
              : t(
                  'panels:diagram.pagePane.pageStepsTitleBlock',
                  'The title block takes room on this page, so it holds {{number}} by default.',
                  { number: titleBlockDefault }
                )
        }
        value={page.layoutCount}
        min={range.min}
        max={range.max}
        step={1}
        disabled={disabled}
        divider={false}
        onCommit={onChange}
      />
      <div className={styles.foot}>
        {own && holdsLaterPages ? (
          <span className={styles.note}>{t('panels:diagram.pagePane.pageStepsHolds', 'Keeps later pages in place')}</span>
        ) : own ? (
          <Button size="sm" variant="ghost" className={styles.action} disabled={disabled} onClick={() => onChange(null)}>
            {t('panels:diagram.pagePane.pageStepsUseDefault', 'Use default')}
          </Button>
        ) : (
          <span className={styles.note}>{t('panels:diagram.pagePane.pageStepsDefault', 'Default')}</span>
        )}
      </div>
    </div>
  );
}
