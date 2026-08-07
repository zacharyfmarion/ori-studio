import { useState } from 'react';
import { Search, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { effectiveExploriDbConfigs } from '../../explori/document';
import { exploriQueryBlocker } from '../../explori/exploriService';
import {
  EXPLORI_SIZES,
  EXPLORI_SYMMETRIES,
  type ExploriDbConfig,
  type ExploriSymmetry,
} from '../../explori/types';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { selectExploriDesignOrEmpty } from '../../store/workspaceStore/designTabs';

/**
 * What to search, and the button that searches it.
 *
 * Three toggles, not twelve checkboxes — the shape upstream settled on. A
 * symmetry is either in the search or not; *which sizes* of it is a refinement
 * almost nobody needs, so it lives behind the gear as a table with one set of
 * column headers rather than inline with "Diagonal Book None" repeated per row.
 *
 * Searching is always explicit. A query leaves the machine and lands on someone
 * else's server, so it happens when the user says so and never as a side effect
 * of drawing.
 */

function symmetryLabel(symmetry: ExploriSymmetry, t: ReturnType<typeof useTranslation>['t']): string {
  if (symmetry === 'book') return t('panels:explori.symmetryBook', 'Book');
  if (symmetry === 'diag') return t('panels:explori.symmetryDiagonal', 'Diagonal');
  return t('panels:explori.symmetryNone', 'None');
}

export function ExploriQueryBar() {
  const { t } = useTranslation();
  const design = useWorkspaceStore((state) => selectExploriDesignOrEmpty(state));
  const setDbConfigs = useWorkspaceStore((state) => state.setExploriDbConfigs);
  const setResultLimit = useWorkspaceStore((state) => state.setExploriResultLimit);
  const runQuery = useWorkspaceStore((state) => state.runExploriQuery);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const document = design.document;
  const blocker = exploriQueryBlocker(document);

  // What a search would actually use — which, until the user chooses for
  // themselves, follows the drawing rather than the stored value.
  const configs = effectiveExploriDbConfigs(document);
  const has = (N: number, symmetry: ExploriSymmetry) =>
    configs.some((config) => config.N === N && config.symmetry === symmetry);
  /** A symmetry is "on" when any size of it is being searched. */
  const symmetryOn = (symmetry: ExploriSymmetry) =>
    configs.some((config) => config.symmetry === symmetry);

  const commit = (next: ExploriDbConfig[]) => void setDbConfigs(next);

  /** Turning a symmetry on searches every size of it; off removes them all. */
  const toggleSymmetry = (symmetry: ExploriSymmetry) => {
    const without = configs.filter((config) => config.symmetry !== symmetry);
    commit(
      symmetryOn(symmetry)
        ? without
        : [...without, ...EXPLORI_SIZES.map((N) => ({ N, symmetry }))]
    );
  };

  const toggleSize = (N: number, symmetry: ExploriSymmetry) =>
    commit(
      has(N, symmetry)
        ? configs.filter((config) => !(config.N === N && config.symmetry === symmetry))
        : [...configs, { N, symmetry }]
    );

  const reason =
    blocker === 'too-simple'
      ? t('panels:explori.needMoreBranches', 'Draw at least four branches to search.')
      : blocker === 'no-database'
        ? t('panels:explori.needDatabase', 'Choose at least one symmetry to search.')
        : undefined;

  return (
    <div className="explori-query-bar">
      <div className="explori-query-bar__row">
        {/* Each control captioned rather than labelled inline: the bar is the
            surface's primary action and reads better as a short command strip
            than as a sentence of small grey words. */}
        <div className="explori-field">
          <span className="explori-field__label">
            {t('panels:explori.symmetryModes', 'Symmetry')}
          </span>
          <div className="explori-field__control">
            <div
              className="explori-symmetry-group"
              role="group"
              aria-label={t('panels:explori.symmetryModes', 'Symmetry')}
            >
              {EXPLORI_SYMMETRIES.map((symmetry) => (
                <button
                  key={symmetry}
                  type="button"
                  className="explori-symmetry-toggle"
                  aria-pressed={symmetryOn(symmetry)}
                  onClick={() => toggleSymmetry(symmetry)}
                >
                  {symmetryLabel(symmetry, t)}
                </button>
              ))}
            </div>
            <div className="explori-advanced">
              <IconButton
                size="sm"
                variant="toolbar"
                isActive={advancedOpen}
                title={t('panels:explori.advancedDatabases', 'Choose topology sizes')}
                onClick={() => setAdvancedOpen((open) => !open)}
              >
                <Settings2 size={15} />
              </IconButton>
              {/* Floated over the canvas rather than inserted into the bar: as a
                  row it pushed every control — and the drawing above them — up and
                  down each time it opened. */}
              {advancedOpen && (
                <div className="explori-advanced__popover" role="dialog">
                  <table className="explori-db-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('panels:explori.topologySize', 'Size')}</th>
                        {EXPLORI_SYMMETRIES.map((symmetry) => (
                          <th key={symmetry} scope="col">
                            {symmetryLabel(symmetry, t)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {EXPLORI_SIZES.map((size) => (
                        <tr key={size}>
                          <th scope="row">{size}</th>
                          {EXPLORI_SYMMETRIES.map((symmetry) => (
                            <td key={symmetry}>
                              <input
                                type="checkbox"
                                checked={has(size, symmetry)}
                                aria-label={t(
                                  'panels:explori.databaseCell',
                                  '{{symmetry}}, size {{size}}',
                                  { symmetry: symmetryLabel(symmetry, t), size }
                                )}
                                onChange={() => toggleSize(size, symmetry)}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="explori-field">
          <span className="explori-field__label">
            {t('panels:explori.searchSize', 'Results')}
          </span>
          <input
            className="explori-query-bar__count"
            type="number"
            min={1}
            max={50}
            value={document.resultLimit}
            aria-label={t('panels:explori.searchSize', 'Results')}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(value)) void setResultLimit(Math.min(50, Math.max(1, value)));
            }}
          />
        </div>

        <span className="explori-query-bar__spacer" />
        <Button
          className="explori-query-bar__search"
          variant="primary"
          disabled={blocker !== null || design.searching}
          title={reason}
          onClick={() => void runQuery()}
        >
          <Search size={16} />
          {design.searching
            ? t('panels:explori.searching', 'Searching…')
            : t('panels:explori.search', 'Search')}
        </Button>
      </div>

      {/* Said out loud rather than only as a disabled button, because "why can I
          not search" is the question the empty state actually raises. */}
      {reason && <p className="explori-query-bar__hint">{reason}</p>}

    </div>
  );
}
