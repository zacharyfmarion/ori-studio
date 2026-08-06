import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronLeft, ChevronRight, ScanLine } from 'lucide-react';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
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

  /** Choose a result and send it straight to Edit, with no detour. */
  const quickSend = async (result: ExploriResult, index: number) => {
    await selectResult(result, index);
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
          <span className="explori-detail__title">{exploriTilingLabel(detail)}</span>
          <span className={`explori-quality explori-quality--${quality}`}>
            {exploriMatchQualityLabel(t, quality)}
          </span>
          <span className="explori-detail__spacer" />
          <IconButton
            size="sm"
            variant="toolbar"
            title={t('panels:explori.previousResult', 'Previous result')}
            disabled={detailIndex === null || detailIndex <= 0}
            onClick={() =>
              detailIndex !== null &&
              void selectResult(results[detailIndex - 1] ?? null, detailIndex - 1)
            }
          >
            <ChevronLeft size={14} />
          </IconButton>
          <IconButton
            size="sm"
            variant="toolbar"
            title={t('panels:explori.nextResult', 'Next result')}
            disabled={detailIndex === null || detailIndex >= results.length - 1}
            onClick={() =>
              detailIndex !== null &&
              void selectResult(results[detailIndex + 1] ?? null, detailIndex + 1)
            }
          >
            <ChevronRight size={14} />
          </IconButton>
          <Button size="sm" variant="primary" onClick={() => void sendToEdit()}>
            <ScanLine size={14} />
            {t('common:toolbar.sendToEdit', 'Send to Edit')}
          </Button>
        </header>
        <div className="explori-detail__panes">
          <div className="explori-detail__pane">
            <ResultFigure result={detail} mode={leftMode} size={DETAIL_SIZE} />
            <div className="explori-detail__modes" role="group">
              <label>
                <input
                  type="radio"
                  name="explori-left"
                  checked={leftMode === 'cp'}
                  onChange={() => setLeftMode('cp')}
                />
                <span>{t('panels:explori.viewCp', 'Crease pattern')}</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="explori-left"
                  checked={leftMode === 'packing'}
                  onChange={() => setLeftMode('packing')}
                />
                <span>{t('panels:explori.viewPacking', 'Packing')}</span>
              </label>
            </div>
          </div>
          <div className="explori-detail__pane">
            <ResultFigure result={detail} mode={rightMode} size={DETAIL_SIZE} />
            <div className="explori-detail__modes" role="group">
              <label>
                <input
                  type="radio"
                  name="explori-right"
                  checked={rightMode === 'tree'}
                  onChange={() => setRightMode('tree')}
                />
                <span>{t('panels:explori.viewTree', 'Tree')}</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="explori-right"
                  checked={rightMode === 'fold'}
                  onChange={() => setRightMode('fold')}
                />
                <span>{t('panels:explori.viewFold', 'Folded form')}</span>
              </label>
            </div>
          </div>
        </div>
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
            <select
              className="explori-results__mode"
              value={thumbMode}
              aria-label={t('panels:explori.thumbnailMode', 'Thumbnail view')}
              onChange={(event) => setThumbMode(event.target.value as ExploriThumbMode)}
            >
              <option value="cp">{t('panels:explori.viewCp', 'Crease pattern')}</option>
              <option value="packing">{t('panels:explori.viewPacking', 'Packing')}</option>
              <option value="tree">{t('panels:explori.viewTree', 'Tree')}</option>
              <option value="fold">{t('panels:explori.viewFold', 'Folded form')}</option>
            </select>
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
                      onClick={() => void quickSend(result, index)}
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
