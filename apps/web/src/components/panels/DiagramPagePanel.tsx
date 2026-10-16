import { useTranslation } from 'react-i18next';
import { LayoutGrid, Waypoints } from 'lucide-react';
import {
  DEFAULT_PATH_WIDTH_MM,
  FIRST_PAGE_NUMBER_RANGE,
  PAGE_COLUMNS_RANGE,
  PAGE_MARGIN_MM_RANGE,
  PAGE_ROWS_RANGE,
  PATH_WIDTH_MM_RANGE,
  STEPS_PER_PAGE_RANGE,
  type DiagramHanStyle,
  type DiagramPageLayout,
  type DiagramPageOrientation,
  type DiagramPageSide,
  type DiagramPaperSize,
} from '../../diagram/document/diagramDocument';
import { hasTitleBlock } from '../../diagram/pages/pagePlan';
import { layoutLabel, orientationLabel, paperSizeLabel } from '../../diagram/pages/pageSetupLabels';
import { useDiagramPageSetup } from '../../diagram/pages/useDiagramPageSetup';
import { DiagramPagePacking } from '../diagram/DiagramPagePacking';
import { DiagramPagePlacements } from '../diagram/DiagramPagePlacements';
import { CurrentDiagramPageStepsRow } from '../diagram/DiagramPageStepsRow';
import { DiagramPathColorRow } from '../diagram/DiagramPathColorRow';
import { DiagramStyleControl } from '../diagram/DiagramStyleControl';
import { DiagramTitleBlockRows } from '../diagram/DiagramTitleBlockRows';
import { DiagramTitleRow } from '../diagram/DiagramTitleRow';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { NumberRow, SegmentedRow, SelectRow, ToggleRow } from '../ui/fieldRows';
import { OptionCards } from '../ui/OptionCard';
import styles from './DiagramPagePanel.module.css';

const PAPER_SIZES: readonly DiagramPaperSize[] = ['a4', 'a5', 'b5-jis', 'letter'];

/**
 * The Page pane: the paper, how steps are laid out on it — in the flow, how
 * its pages are packed (`DiagramPagePacking`), right under the counts, and the
 * path's look — what the header and footer carry, opening with the diagram's
 * title (`DiagramTitleRow`) and the first page's title block
 * (`DiagramTitleBlockRows`), and the style every step is
 * drawn in (D10, D13; `diagram-title-block.md`, Phase 1c, H-15 A and H-16 A).
 *
 * A composition site (AGENTS.md › Panel components): the bindings, each one
 * undo step and one count, are `useDiagramPageSetup`, and the page a count of
 * its own is for `useCurrentDiagramPage`; the rows are the shared field rows,
 * but for the path's colour (`DiagramPathColorRow`), whose pick re-renders its
 * row and not the pane, and the current page's count (`DiagramPageStepsRow`).
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
          {flow ? (
            <>
              {/* The flow takes a number of steps and chooses its rows to suit the paper (`flowShape`): the
                  default, and the current page's own. */}
              <NumberRow
                label={t('panels:diagram.pagePane.stepsPerPage', 'Steps per page')}
                value={page.stepsPerPage}
                min={STEPS_PER_PAGE_RANGE.min}
                max={STEPS_PER_PAGE_RANGE.max}
                step={1}
                disabled={readOnly}
                onCommit={(stepsPerPage) => setPage({ stepsPerPage }, 'steps_per_page')}
              />
              <CurrentDiagramPageStepsRow disabled={readOnly} onChange={setup.setPageSteps} />
            </>
          ) : (
            <>
              <NumberRow
                label={t('panels:diagram.pagePane.columns', 'Columns')}
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
            </>
          )}
        </CollapsibleSection>
        {flow && <DiagramPagePacking page={page} readOnly={readOnly} setPage={setPage} />}
        <DiagramPagePlacements />
        {flow && (
          <CollapsibleSection title={t('panels:diagram.pagePane.path', 'Path')}>
            <ToggleRow
              label={t('panels:diagram.pagePane.showPath', 'Show path')}
              checked={page.showPath}
              disabled={readOnly}
              onChange={(showPath) => setPage({ showPath }, 'path')}
            />
            {page.showPath && (
              <>
                <NumberRow
                  label={t('panels:diagram.pagePane.pathWidthMm', 'Path width (mm)')}
                  value={page.pathWidthMm}
                  min={PATH_WIDTH_MM_RANGE.min}
                  max={PATH_WIDTH_MM_RANGE.max}
                  step={1}
                  disabled={readOnly}
                  onCommit={(pathWidthMm) => setPage({ pathWidthMm }, 'path_width')}
                  onReset={
                    page.pathWidthMm !== DEFAULT_PATH_WIDTH_MM
                      ? () => setPage({ pathWidthMm: DEFAULT_PATH_WIDTH_MM }, 'path_width')
                      : undefined
                  }
                />
                <DiagramPathColorRow />
              </>
            )}
          </CollapsibleSection>
        )}
        <CollapsibleSection title={t('panels:diagram.pagePane.headerFooter', 'Header & footer')}>
          <DiagramTitleRow />
          <DiagramTitleBlockRows />
          <ToggleRow
            label={t('panels:diagram.pagePane.title', 'Title tab')}
            help={
              // The title block carries the title on the first page, which prints no tab (T-5 A).
              hasTitleBlock(page)
                ? t(
                    'panels:diagram.pagePane.titleHelpWithBlock',
                    'The diagram’s title, in a tab at the top of every page. On the first page the title block carries it instead.'
                  )
                : t('panels:diagram.pagePane.titleHelp', 'The diagram’s title, in a tab at the top of every page.')
            }
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
