import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronLeft, ChevronRight, ScanLine } from 'lucide-react';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import {
  ExploriCpFigure,
  ExploriFoldFigure,
  ExploriGraphFigure,
  type ExploriThumbMode,
} from '../../explori/renderers';
import { exploriMatchQuality, exploriMatchQualityLabel } from '../../explori/matchQuality';
import { exploriTilingLabel, type ExploriResult } from '../../explori/types';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { selectExploriDesignOrEmpty } from '../../store/workspaceStore/designTabs';

/**
 * The results half of an ExplOri design: a grid of matches, and a detail view
 * for one of them.
 *
 * The detail is a state of this pane, not a route and not a modal. A route would
 * be workspace-scoped and so immediately wrong with several designs open; a
 * modal would cover the tree, and comparing your tree against a candidate is the
 * entire point of the two-pane layout.
 */

const THUMB_SIZE = 220;
const DETAIL_SIZE = 400;

function ResultFigure({
  result,
  mode,
  size,
}: {
  result: ExploriResult;
  mode: ExploriThumbMode;
  size: number;
}) {
  if (mode === 'packing') return <ExploriCpFigure cp={result.packing} size={size} variant="packing" />;
  if (mode === 'fold' && result.fold) return <ExploriFoldFigure fold={result.fold} size={size} />;
  if (mode === 'tree' && result.tree) return <ExploriGraphFigure graph={result.tree} size={size} />;
  return <ExploriCpFigure cp={result.cp} size={size} />;
}

/** One detail figure with the toggle that chooses what it shows. */
function ExploriDetailPane({
  figure,
  name,
  value,
  options,
  onChange,
}: {
  figure: ReactNode;
  name: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="explori-detail__pane">
      <div className="explori-detail__figure">{figure}</div>
      <div className="explori-detail__modes" role="radiogroup">
        {options.map((option) => (
          <label key={option.value} className="explori-detail__mode">
            <input
              type="radio"
              name={name}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function ExploriResultsPanel() {
  const { t } = useTranslation();
  const design = useWorkspaceStore((state) => selectExploriDesignOrEmpty(state));
  const selectResult = useWorkspaceStore((state) => state.selectExploriResult);
  const sendToEdit = useWorkspaceStore((state) => state.sendExploriToEdit);
  const [thumbMode, setThumbMode] = useState<ExploriThumbMode>('cp');
  const [leftMode, setLeftMode] = useState<'cp' | 'packing'>('cp');
  const [rightMode, setRightMode] = useState<'tree' | 'fold'>('tree');

  const { results, detailIndex, searching, error } = design;
  const detail = detailIndex !== null ? (results[detailIndex] ?? null) : null;

  /**
   * Choose a result and send it straight to Edit.
   *
   * `null` for the detail index, deliberately: passing one is what *opens* the
   * detail, so a quick send with an index flashed the drill-down on its way past
   * — the exact detour this action exists to skip.
   */
  const quickSend = async (result: ExploriResult) => {
    await selectResult(result, null);
    await sendToEdit('card');
  };

  if (searching) {
    return (
      <section className="panel-shell explori-results-panel">
        <p className="explori-results__status">{t('panels:explori.searchingStatus', 'Searching the archive…')}</p>
      </section>
    );
  }

  if (detail) {
    const quality = exploriMatchQuality(detail.distance);
    const step = (delta: number) => {
      if (detailIndex === null) return;
      const next = detailIndex + delta;
      if (next < 0 || next >= results.length) return;
      void selectResult(results[next] ?? null, next);
    };
    return (
      <section className="panel-shell explori-results-panel explori-results-panel--detail">
        <header className="explori-detail__header">
          <IconButton
            size="sm"
            variant="toolbar"
            title={t('panels:explori.backToResults', 'Back to results')}
            onClick={() => void selectResult(detail, null)}
          >
            <ArrowLeft size={14} />
          </IconButton>
          <div className="explori-detail__identity">
            <span className="explori-detail__title">{exploriTilingLabel(detail)}</span>
            <span className={`explori-quality explori-quality--${quality}`}>
              {exploriMatchQualityLabel(t, quality)}
            </span>
          </div>
          <Button size="sm" variant="primary" onClick={() => void sendToEdit('detail')}>
            <ScanLine size={14} />
            {t('common:toolbar.sendToEdit', 'Send to Edit')}
          </Button>
        </header>

        {/* The two figures, each with its own mode toggle underneath — upstream's
            arrangement, and the reason the drill-down is a pane rather than a
            modal: the tree you drew stays visible beside the candidate. */}
        <div className="explori-detail__panes">
          <ExploriDetailPane
            figure={<ResultFigure result={detail} mode={leftMode} size={DETAIL_SIZE} />}
            name="explori-left"
            value={leftMode}
            options={[
              { value: 'cp', label: t('panels:explori.viewCp', 'Crease pattern') },
              { value: 'packing', label: t('panels:explori.viewPacking', 'Packing') },
            ]}
            onChange={(value) => setLeftMode(value as 'cp' | 'packing')}
          />
          <ExploriDetailPane
            figure={<ResultFigure result={detail} mode={rightMode} size={DETAIL_SIZE} />}
            name="explori-right"
            value={rightMode}
            options={[
              { value: 'tree', label: t('panels:explori.viewTree', 'Tree') },
              { value: 'fold', label: t('panels:explori.viewFold', 'Folded form') },
            ]}
            onChange={(value) => setRightMode(value as 'tree' | 'fold')}
          />
        </div>

        {/* Pinned to the edges of the body, as upstream's chevrons are, so
            stepping through results is one target that does not move. */}
        <IconButton
          size="sm"
          variant="toolbar"
          className="explori-detail__step explori-detail__step--prev"
          title={t('panels:explori.previousResult', 'Previous result')}
          disabled={detailIndex === null || detailIndex <= 0}
          onClick={() => step(-1)}
        >
          <ChevronLeft size={16} />
        </IconButton>
        <IconButton
          size="sm"
          variant="toolbar"
          className="explori-detail__step explori-detail__step--next"
          title={t('panels:explori.nextResult', 'Next result')}
          disabled={detailIndex === null || detailIndex >= results.length - 1}
          onClick={() => step(1)}
        >
          <ChevronRight size={16} />
        </IconButton>
      </section>
    );
  }

  return (
    <section className="panel-shell explori-results-panel">
      {error && <p className="explori-results__error">{error}</p>}
      {results.length === 0 ? (
        <p className="explori-results__status">
          {t(
            'panels:explori.noResultsYet',
            'Draw a tree and search the archive to see matching crease patterns.'
          )}
        </p>
      ) : (
        <>
          <header className="explori-results__header">
            <span>
              {results.length === 1
                ? t('panels:explori.resultCountOne', '{{count}} result', { count: results.length })
                : t('panels:explori.resultCountOther', '{{count}} results', {
                    count: results.length,
                  })}
            </span>
            <Select
              value={thumbMode}
              onValueChange={(value) => setThumbMode(value as ExploriThumbMode)}
            >
              <SelectTrigger
                className="explori-results__mode"
                aria-label={t('panels:explori.thumbnailMode', 'Thumbnail view')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cp">{t('panels:explori.viewCp', 'Crease pattern')}</SelectItem>
                <SelectItem value="packing">{t('panels:explori.viewPacking', 'Packing')}</SelectItem>
                <SelectItem value="tree">{t('panels:explori.viewTree', 'Tree')}</SelectItem>
                <SelectItem value="fold">{t('panels:explori.viewFold', 'Folded form')}</SelectItem>
              </SelectContent>
            </Select>
          </header>
          <div className="explori-results__grid">
            {results.map((result, index) => {
              const quality = exploriMatchQuality(result.distance);
              return (
                <article key={`${exploriTilingLabel(result)}:${index}`} className="explori-result-card">
                  <button
                    type="button"
                    className="explori-result-card__open"
                    onClick={() => void selectResult(result, index)}
                    aria-label={t('panels:explori.openResult', 'Open result {{id}}', {
                      id: exploriTilingLabel(result),
                    })}
                  >
                    <ResultFigure result={result} mode={thumbMode} size={THUMB_SIZE} />
                  </button>
                  <div className="explori-result-card__meta">
                    <span className="explori-result-card__id">{exploriTilingLabel(result)}</span>
                    <span className={`explori-quality explori-quality--${quality}`}>
                      {exploriMatchQualityLabel(t, quality)}
                    </span>
                    <IconButton
                      size="sm"
                      variant="toolbar"
                      title={t('panels:explori.quickSendToEdit', 'Send this crease pattern to Edit')}
                      onClick={() => void quickSend(result)}
                    >
                      <ScanLine size={14} />
                    </IconButton>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
