import { useTranslation } from 'react-i18next';
import { LayoutGrid, Waypoints } from 'lucide-react';
import {
  FIRST_PAGE_NUMBER_RANGE,
  PAGE_COLUMNS_RANGE,
  PAGE_MARGIN_MM_RANGE,
  PAGE_ROWS_RANGE,
  type DiagramHanStyle,
  type DiagramPageLayout,
  type DiagramPageOrientation,
  type DiagramPageSide,
  type DiagramPaperSize,
  type DiagramPictureScale,
} from '../../diagram/document/diagramDocument';
import { layoutLabel, orientationLabel, paperSizeLabel } from '../../diagram/pages/pageSetupLabels';
import { useDiagramPageSetup } from '../../diagram/pages/useDiagramPageSetup';
import { DiagramStyleControl } from '../diagram/DiagramStyleControl';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { NumberRow, SegmentedRow, SelectRow, ToggleRow } from '../ui/fieldRows';
import { OptionCards } from '../ui/OptionCard';
import styles from './DiagramPagePanel.module.css';

const PAPER_SIZES: readonly DiagramPaperSize[] = ['a4', 'a5', 'b5-jis', 'letter'];

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
            options={PAPER_SIZES.map((size) => ({ id: size, label: paperSizeLabel(size, t) }))}
            onChange={(size) => setPage({ size: size as DiagramPaperSize }, 'size')}
          />
          <SegmentedRow
            label={t('panels:diagram.pagePane.orientation', 'Orientation')}
            value={page.orientation}
            disabled={readOnly}
            options={[
              // Words alone: with an icon each, the pair is wider than the
              // pane's default width leaves it, and both words were cut.
              { id: 'portrait', label: orientationLabel('portrait', t) },
              { id: 'landscape', label: orientationLabel('landscape', t) },
            ]}
            onChange={(orientation) =>
              setPage({ orientation: orientation as DiagramPageOrientation }, 'orientation')
            }
          />
          <NumberRow
            // The unit in the label, not after the field: the stepper with a
            // suffix ran past the pane at its default width.
            label={t('panels:diagram.pagePane.marginMm', 'Margin (mm)')}
            value={page.marginMm}
            min={PAGE_MARGIN_MM_RANGE.min}
            max={PAGE_MARGIN_MM_RANGE.max}
            step={1}
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
              // Flow first: the layout a new diagram starts in.
              options={[
                {
                  value: 'flow',
                  label: layoutLabel('flow', t),
                  description: t('panels:diagram.pagePane.flowHint', 'Rows turn back at each end.'),
                  icon: <Waypoints size={16} />,
                },
                {
                  value: 'grid',
                  label: layoutLabel('grid', t),
                  description: t('panels:diagram.pagePane.gridHint', 'Rows read left to right.'),
                  icon: <LayoutGrid size={16} />,
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
            label={t('panels:diagram.pagePane.firstPageSide', 'First page')}
            value={page.firstPageSide}
            disabled={readOnly}
            help={
              flow
                ? t(
                    'panels:diagram.pagePane.firstPageSideFlowHint',
                    'Which side of a printed spread page 1 falls on. Across each spread the path runs on over the spine, so a right-hand page starts at the bottom, where the left one ends. Page numbers print at the outer corners.'
                  )
                : t(
                    'panels:diagram.pagePane.firstPageSideHint',
                    'Which side of a printed spread page 1 falls on. Page numbers print at the outer corners.'
                  )
            }
            options={[
              { id: 'left', label: t('panels:diagram.pagePane.sideLeft', 'Left') },
              { id: 'right', label: t('panels:diagram.pagePane.sideRight', 'Right') },
            ]}
            onChange={(side) => setPage({ firstPageSide: side as DiagramPageSide }, 'first_page_side')}
          />
          <SegmentedRow
            label={t('panels:diagram.pagePane.scale', 'Scale')}
            value={page.scale}
            disabled={readOnly}
            help={t(
              'panels:diagram.pagePane.scaleHint',
              'Fit each keeps the paper one size from step to step while it fits, and zooms in where the model stays much smaller for several steps. One scale draws every pattern at the same size per unit of paper, so the model shrinks as it is folded.'
            )}
            options={[
              { id: 'fit', label: t('panels:diagram.pagePane.scaleFit', 'Fit each') },
              { id: 'paper', label: t('panels:diagram.pagePane.scalePaper', 'One scale') },
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
            help={t(
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
