import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { exploriQueryBlocker } from '../../explori/exploriService';
import { EXPLORI_SIZES, EXPLORI_SYMMETRIES, type ExploriSymmetry } from '../../explori/types';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { selectExploriDesignOrEmpty } from '../../store/workspaceStore/designTabs';

/**
 * Which databases to search, how many results to ask for, and the Search button.
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
  const runQuery = useWorkspaceStore((state) => state.runExploriQuery);
  const document = design.document;
  const blocker = exploriQueryBlocker(document);

  const isSelected = (N: number, symmetry: ExploriSymmetry) =>
    document.dbConfigs.some((config) => config.N === N && config.symmetry === symmetry);

  const toggle = (N: number, symmetry: ExploriSymmetry) => {
    const next = isSelected(N, symmetry)
      ? document.dbConfigs.filter((config) => !(config.N === N && config.symmetry === symmetry))
      : [...document.dbConfigs, { N, symmetry }];
    void setDbConfigs(next);
  };

  const reason =
    blocker === 'too-simple'
      ? t('panels:explori.needMoreBranches', 'Draw at least four branches to search.')
      : blocker === 'no-database'
        ? t('panels:explori.needDatabase', 'Choose at least one database to search.')
        : undefined;

  return (
    <div className="explori-query-bar">
      <div
        className="explori-db-grid"
        role="group"
        aria-label={t('panels:explori.databases', 'Databases to search')}
      >
        {EXPLORI_SIZES.map((size) => (
          <div key={size} className="explori-db-row">
            <span className="explori-db-row__label">{size}</span>
            {EXPLORI_SYMMETRIES.map((symmetry) => (
              <label key={symmetry} className="explori-db-option">
                <input
                  type="checkbox"
                  checked={isSelected(size, symmetry)}
                  onChange={() => toggle(size, symmetry)}
                />
                <span>{symmetryLabel(symmetry, t)}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      <Button
        size="sm"
        variant="primary"
        disabled={blocker !== null || design.searching}
        title={reason}
        onClick={() => void runQuery()}
      >
        <Search size={14} />
        {design.searching
          ? t('panels:explori.searching', 'Searching…')
          : t('panels:explori.search', 'Search')}
      </Button>
    </div>
  );
}
