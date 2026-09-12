import { useSyncExternalStore } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { ReferencesSettings } from '../../store/workspaceStore/types';
import { planIsForSheet } from './referencesBreakdown';
import { referencesResultsSnapshot, subscribeReferencesResults } from './referencesResults';
import { referencesRevisionKey } from './useReferencesView';

/**
 * What the References View pane shows and writes, read from the stores in one
 * place (AGENTS.md > Panel components: store bindings for one concern live in a
 * `use*` hook beside its modules).
 *
 * The pane is its own dock panel, so unlike the settings popover it replaced it
 * cannot be handed the panel's breakdown controller. What it needs of it is one
 * bit — *is there a plan* — and that is the same question `useReferencesBreakdown`
 * answers for the panel: a plan in the side table, for this revision and this
 * sheet. Asked here against the stored sheet rather than the resolved one; the
 * two differ only when the stored id names a sheet that no longer exists, and
 * "Start from this sequence" being offered for one render is not worth a second
 * frames analysis.
 */
export interface ReferencesSettingsState {
  settings: ReferencesSettings;
  setSettings: (settings: Partial<ReferencesSettings>) => void;
  /** Whole-pattern mode: auxiliary folds hoisted to a phase 0. View state, not a setting. */
  landmarksFirst: boolean;
  toggleLandmarksFirst: () => void;
  /** A crease pattern is open, so the settings have something to act on. */
  hasDocument: boolean;
  /** A breakdown exists, so the sequence-relative options mean something. */
  hasPlan: boolean;
}

export function useReferencesSettings(): ReferencesSettingsState {
  const settings = useWorkspaceStore((state) => state.referencesSettings);
  const setSettings = useWorkspaceStore((state) => state.setReferencesSettings);
  const landmarksFirst = useWorkspaceStore((state) => state.referencesView.landmarksFirst);
  const toggleLandmarksFirst = useWorkspaceStore((state) => state.toggleReferencesLandmarksFirst);
  const document = useWorkspaceStore((state) => state.oristudioCpDocument);
  const selectedSheet = useWorkspaceStore((state) => state.referencesSelectedSheet);
  const side = useSyncExternalStore(subscribeReferencesResults, referencesResultsSnapshot);

  const plan = side.plan;
  const hasPlan =
    plan !== null &&
    plan.revision === referencesRevisionKey(document) &&
    planIsForSheet(plan, selectedSheet);

  return {
    settings,
    setSettings,
    landmarksFirst,
    toggleLandmarksFirst,
    hasDocument: document !== null,
    hasPlan,
  };
}
