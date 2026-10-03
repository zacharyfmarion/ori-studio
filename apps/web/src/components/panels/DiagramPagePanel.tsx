import { useTranslation } from 'react-i18next';
import { LayoutGrid, RectangleHorizontal, RectangleVertical, Waypoints } from 'lucide-react';
import {
  FIRST_PAGE_NUMBER_RANGE,
  PAGE_COLUMNS_RANGE,
  PAGE_MARGIN_MM_RANGE,
  PAGE_ROWS_RANGE,
  type DiagramHanStyle,
  type DiagramPageLayout,
  type DiagramPageOrientation,
  type DiagramPaperSize,
  type DiagramPictureScale,
} from '../../diagram/document/diagramDocument';
import { useDiagramPageSetup } from '../../diagram/pages/useDiagramPageSetup';
import { DiagramStyleControl } from '../diagram/DiagramStyleControl';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { NumberRow, SegmentedRow, SelectRow, ToggleRow } from '../ui/fieldRows';
import { OptionCards } from '../ui/OptionCard';
import styles from './DiagramPagePanel.module.css';

/**
 * The Page pane: the paper, how steps are laid out on it, what the header and
 * footer carry, and the style every step is drawn in (D10, D13).
 *
 * A composition site (AGENTS.md › Panel components): the bindings, each one
 * undo step and one count, are `useDiagramPageSetup`; the rows are the shared
 * field rows.
 */
export function DiagramPagePanel() {
  const { t } = useTranslation();
  const setup = useDiagramPageSetup();
  const { page, readOnly, setPage } = setup;
  const flow = page.layout === 'flow';
  return (
    <section className="panel-shell" aria-label={t('panels:diagram.pagePane.label', 'Page setup')}>
      <div className="panel-body">
        <CollapsibleSection title={t('panels:diagram.pagePane.paper', 'Paper')}>
          <SelectRow
            label={t('panels:diagram.pagePane.size', 'Size')}
            value={page.size}
            disabled={readOnly}
            options={[
              { id: 'a4', label: t('panels:diagram.pagePane.sizes.a4', 'A4') },
              { id: 'a5', label: t('panels:diagram.pagePane.sizes.a5', 'A5') },
              { id: 'b5-jis', label: t('panels:diagram.pagePane.sizes.b5Jis', 'B5 (JIS)') },
              { id: 'letter', label: t('panels:diagram.pagePane.sizes.letter', 'US Letter') },
            ]}
            onChange={(size) => setPage({ size: size as DiagramPaperSize }, 'size')}
          />
          <SegmentedRow
            label={t('panels:diagram.pagePane.orientation', 'Orientation')}
            value={page.orientation}
            disabled={readOnly}
            options={[
              {
                id: 'portrait',
                label: t('panels:diagram.pagePane.portrait', 'Portrait'),
                icon: <RectangleVertical size={14} aria-hidden="true" />,
              },
              {
                id: 'landscape',
                label: t('panels:diagram.pagePane.landscape', 'Landscape'),
                icon: <RectangleHorizontal size={14} aria-hidden="true" />,
              },
            ]}
            onChange={(orientation) =>
              setPage({ orientation: orientation as DiagramPageOrientation }, 'orientation')
            }
          />
          <NumberRow
            label={t('panels:diagram.pagePane.margin', 'Margin')}
            value={page.marginMm}
            min={PAGE_MARGIN_MM_RANGE.min}
            max={PAGE_MARGIN_MM_RANGE.max}
            step={1}
            suffix={t('panels:diagram.pagePane.mm', 'mm')}
            disabled={readOnly}
            onCommit={(marginMm) => setPage({ marginMm }, 'margin')}
          />
        </CollapsibleSection>
        <CollapsibleSection title={t('panels:diagram.pagePane.layout', 'Layout')}>
          <div className={styles.cards}>
            <OptionCards<DiagramPageLayout>
              label={t('panels:diagram.pagePane.layout', 'Layout')}
              value={page.layout}
              disabled={readOnly}
              options={[
                {
                  value: 'grid',
                  label: t('panels:diagram.pagePane.grid', 'Grid'),
                  description: t('panels:diagram.pagePane.gridHint', 'Rows read left to right.'),
                  icon: <LayoutGrid size={16} />,
                },
                {
                  value: 'flow',
                  label: t('panels:diagram.pagePane.flow', 'Flow'),
                  description: t('panels:diagram.pagePane.flowHint', 'Rows turn back at each end.'),
                  icon: <Waypoints size={16} />,
                },
              ]}
              onChange={(layout) => setPage({ layout }, 'layout')}
            />
          </div>
          <NumberRow
            label={
              flow
                ? t('panels:diagram.pagePane.perRow', 'Steps per row')
                : t('panels:diagram.pagePane.columns', 'Columns')
            }
            value={page.columns}
            min={PAGE_COLUMNS_RANGE.min}
            max={PAGE_COLUMNS_RANGE.max}
            step={1}
            disabled={readOnly}
            onCommit={(columns) => setPage({ columns }, 'columns')}
          />
          <NumberRow
            label={t('panels:diagram.pagePane.rows', 'Rows')}
            value={page.rows}
            min={PAGE_ROWS_RANGE.min}
            max={PAGE_ROWS_RANGE.max}
            step={1}
            disabled={readOnly}
            onCommit={(rows) => setPage({ rows }, 'rows')}
          />
          {flow && (
            <ToggleRow
              label={t('panels:diagram.pagePane.showPath', 'Show path')}
              checked={page.showPath}
              disabled={readOnly}
              onChange={(showPath) => setPage({ showPath }, 'path')}
            />
          )}
          <SegmentedRow
            label={t('panels:diagram.pagePane.scale', 'Scale')}
            value={page.scale}
            disabled={readOnly}
            title={t(
              'panels:diagram.pagePane.scaleHint',
              'One scale draws every pattern at the same size per unit of paper, as a book does. Fit draws each as large as its box.'
            )}
            options={[
              { id: 'paper', label: t('panels:diagram.pagePane.scalePaper', 'One scale') },
              { id: 'fit', label: t('panels:diagram.pagePane.scaleFit', 'Fit each') },
            ]}
            onChange={(scale) => setPage({ scale: scale as DiagramPictureScale }, 'scale')}
          />
          <p className={styles.readout}>
            {t('panels:diagram.pagePane.perPage', {
              count: setup.perPage,
              defaultValue_one: '1 step per page',
              defaultValue_other: '{{count}} steps per page',
            })}
            {' · '}
            {t('panels:diagram.pagePane.pageCount', {
              count: setup.pageCount,
              defaultValue_one: '1 page',
              defaultValue_other: '{{count}} pages',
            })}
          </p>
        </CollapsibleSection>
        <CollapsibleSection title={t('panels:diagram.pagePane.headerFooter', 'Header & footer')}>
          <ToggleRow
            label={t('panels:diagram.pagePane.title', 'Title')}
            help={t('panels:diagram.pagePane.titleHelp', 'The diagram’s title, in a tab at the top of every page.')}
            checked={page.showTitle}
            disabled={readOnly}
            onChange={(showTitle) => setPage({ showTitle }, 'title')}
          />
          <ToggleRow
            label={t('panels:diagram.pagePane.pageNumbers', 'Page numbers')}
            checked={page.pageNumbers.enabled}
            disabled={readOnly}
            onChange={(enabled) => setPage({ pageNumbers: { ...page.pageNumbers, enabled } }, 'page_numbers')}
          />
          {page.pageNumbers.enabled && (
            <NumberRow
              label={t('panels:diagram.pagePane.firstPage', 'First number')}
              value={page.pageNumbers.first}
              min={FIRST_PAGE_NUMBER_RANGE.min}
              max={FIRST_PAGE_NUMBER_RANGE.max}
              step={1}
              disabled={readOnly}
              onCommit={(first) => setPage({ pageNumbers: { ...page.pageNumbers, first } }, 'first_page')}
            />
          )}
        </CollapsibleSection>
        <CollapsibleSection title={t('panels:diagram.pagePane.styleSection', 'Style')}>
          <DiagramStyleControl value={setup.style} disabled={readOnly} onChange={setup.setStyle} />
          <SelectRow
            label={t('panels:diagram.pagePane.hanStyle', 'Han characters')}
            title={t(
              'panels:diagram.pagePane.hanStyleHint',
              'How Chinese characters are drawn where a text has no kana or Hangul to say which language it is.'
            )}
            value={setup.hanStyle}
            disabled={readOnly}
            options={[
              { id: 'sc', label: t('panels:diagram.pagePane.han.sc', 'Simplified Chinese') },
              { id: 'tc', label: t('panels:diagram.pagePane.han.tc', 'Traditional Chinese') },
              { id: 'jp', label: t('panels:diagram.pagePane.han.jp', 'Japanese') },
              { id: 'kr', label: t('panels:diagram.pagePane.han.kr', 'Korean') },
            ]}
            onChange={(hanStyle) => setup.setHanStyle(hanStyle as DiagramHanStyle)}
          />
        </CollapsibleSection>
      </div>
    </section>
  );
}
