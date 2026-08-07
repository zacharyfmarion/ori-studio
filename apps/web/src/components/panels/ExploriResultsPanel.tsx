import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, ScanLine } from 'lucide-react';
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
import { exploriResultUrl, exploriTilingLabel, type ExploriResult } from '../../explori/types';
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
 *
 * The tiling id (`4b.23841`) names a row in someone else's database. It stays in
 * the accessible names, the React keys and the exported filename, where it is
 * the only thing that identifies a result — and is shown nowhere, because to a
 * person choosing between crease patterns it is noise.
 */

const THUMB_SIZE = 300;
const DETAIL_SIZE = 400;

/**
 * What a card shows.
 *
 * `pair` is the default and not one of the figures: judging a match means
 * looking at the candidate *and* the tree it is supposed to match, so the card
 * shows both and the single views stay behind the dropdown.
 */
type ExploriCardMode = ExploriThumbMode | 'pair';

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

/** A card's figure, which is either one view or the tree beside the pattern. */
function CardFigure({ result, mode }: { result: ExploriResult; mode: ExploriCardMode }) {
  if (mode !== 'pair') return <ResultFigure result={result} mode={mode} size={THUMB_SIZE} />;
  return (
    <div className="explori-result-card__pair">
      <ResultFigure result={result} mode="tree" size={THUMB_SIZE} />
      <ResultFigure result={result} mode="cp" size={THUMB_SIZE} />
    </div>
  );
}

/** One detail figure, under the name of what it is. */
function ExploriDetailFigure({
  result,
  mode,
  label,
}: {
  result: ExploriResult;
  mode: ExploriThumbMode;
  label: string;
}) {
  return (
    <figure className="explori-detail__pane">
      <div className="explori-detail__figure">
        <ResultFigure result={result} mode={mode} size={DETAIL_SIZE} />
      </div>
      <figcaption className="explori-detail__caption">{label}</figcaption>
    </figure>
  );
}

export function ExploriResultsPanel() {
  const { t } = useTranslation();
  const design = useWorkspaceStore((state) => selectExploriDesignOrEmpty(state));
  const selectResult = useWorkspaceStore((state) => state.selectExploriResult);
  const sendToEdit = useWorkspaceStore((state) => state.sendExploriToEdit);
  const [cardMode, setCardMode] = useState<ExploriCardMode>('pair');

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
          <span className={`explori-quality explori-quality--${quality}`}>
            {exploriMatchQualityLabel(t, quality)}
          </span>
          {/* Stepping through results sits with the other controls rather than
              floating over the figures, which is what it used to do. */}
          <div className="explori-detail__steps">
            <IconButton
              size="sm"
              variant="toolbar"
              title={t('panels:explori.previousResult', 'Previous result')}
              disabled={detailIndex === null || detailIndex <= 0}
              onClick={() => step(-1)}
            >
              <ChevronLeft size={16} />
            </IconButton>
            <span className="explori-detail__position">
              {t('panels:explori.resultPosition', '{{index}} of {{total}}', {
                index: (detailIndex ?? 0) + 1,
                total: results.length,
              })}
            </span>
            <IconButton
              size="sm"
              variant="toolbar"
              title={t('panels:explori.nextResult', 'Next result')}
              disabled={detailIndex === null || detailIndex >= results.length - 1}
              onClick={() => step(1)}
            >
              <ChevronRight size={16} />
            </IconButton>
          </div>
          <a
            className="explori-detail__upstream"
            href={exploriResultUrl(detail)}
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLink size={14} />
            {t('panels:explori.openInExplori', 'Open in ExplOri')}
          </a>
          <Button size="sm" variant="primary" onClick={() => void sendToEdit('detail')}>
            <ScanLine size={14} />
            {t('common:toolbar.sendToEdit', 'Send to Edit')}
          </Button>
        </header>

        {/* All four at once. Two of them used to be chosen by a radio group,
            which was a control standing in for the thing it selected — and there
            are only four, so they fit. */}
        <div className="explori-detail__panes">
          <ExploriDetailFigure
            result={detail}
            mode="cp"
            label={t('panels:explori.viewCp', 'Crease pattern')}
          />
          <ExploriDetailFigure
            result={detail}
            mode="packing"
            label={t('panels:explori.viewPacking', 'Packing')}
          />
          <ExploriDetailFigure
            result={detail}
            mode="tree"
            label={t('panels:explori.viewTree', 'Tree')}
          />
          <ExploriDetailFigure
            result={detail}
            mode="fold"
            label={t('panels:explori.viewFold', 'Folded form')}
          />
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
            <Select
              value={cardMode}
              onValueChange={(value) => setCardMode(value as ExploriCardMode)}
            >
              <SelectTrigger
                className="explori-results__mode"
                aria-label={t('panels:explori.thumbnailMode', 'Thumbnail view')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pair">
                  {t('panels:explori.viewTreeAndCp', 'Tree and crease pattern')}
                </SelectItem>
                <SelectItem value="cp">{t('panels:explori.viewCp', 'Crease pattern')}</SelectItem>
                <SelectItem value="packing">{t('panels:explori.viewPacking', 'Packing')}</SelectItem>
                <SelectItem value="tree">{t('panels:explori.viewTree', 'Tree')}</SelectItem>
                <SelectItem value="fold">{t('panels:explori.viewFold', 'Folded form')}</SelectItem>
              </SelectContent>
            </Select>
          </header>
          <div className="explori-results__grid" data-mode={cardMode}>
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
                    <CardFigure result={result} mode={cardMode} />
                  </button>
                  <div className="explori-result-card__meta">
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
