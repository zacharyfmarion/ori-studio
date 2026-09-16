import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { ReferencesSettings } from '../../store/workspaceStore/types';

/**
 * What the References View pane shows and writes, read from the stores in one
 * place (AGENTS.md > Panel components: store bindings for one concern live in a
 * `use*` hook beside its modules).
 */
export interface ReferencesSettingsState {
  settings: ReferencesSettings;
  setSettings: (settings: Partial<ReferencesSettings>) => void;
  /** Whole-pattern mode: auxiliary folds hoisted to a phase 0. View state, not a setting. */
  landmarksFirst: boolean;
  toggleLandmarksFirst: () => void;
  /** A crease pattern is open, so the settings have something to act on. */
  hasDocument: boolean;
  /**
   * Play a step's fold on arriving at its card. A preference rather than a
   * references setting: it says nothing about the plan, so it outlives one.
   */
  autoPlayFolds: boolean;
  setAutoPlayFolds: (value: boolean) => void;
}

export function useReferencesSettings(): ReferencesSettingsState {
  const settings = useWorkspaceStore((state) => state.referencesSettings);
  const setSettings = useWorkspaceStore((state) => state.setReferencesSettings);
  const landmarksFirst = useWorkspaceStore((state) => state.referencesView.landmarksFirst);
  const toggleLandmarksFirst = useWorkspaceStore((state) => state.toggleReferencesLandmarksFirst);
  const document = useWorkspaceStore((state) => state.oristudioCpDocument);
  const autoPlayFolds = useSettingsStore((state) => state.referencesAutoPlayFolds);
  const setAutoPlayFolds = useSettingsStore((state) => state.setReferencesAutoPlayFolds);

  return {
    settings,
    setSettings,
    landmarksFirst,
    toggleLandmarksFirst,
    hasDocument: document !== null,
    autoPlayFolds,
    setAutoPlayFolds,
  };
}
