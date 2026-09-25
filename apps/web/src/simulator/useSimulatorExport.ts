import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { PaperStyleOverrides } from '../lib/paper/paperStyle';
import { exportPaperStyle } from '../lib/paperStyleSettings';
import { focusedElement, usePaperExportUiStore } from '../store/paperExportUiStore';
import { useSettingsStore } from '../store/settingsStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { simulatorExportTarget, type SimulatorExportCapture } from './simulatorExportTarget';
import type { SimulatorRuntime } from './useSimulatorRuntime';

/**
 * "Export this view" as one verb, for every surface that shows a simulation:
 * freeze the frame on screen and open the export dialog on it.
 *
 * The Simulate workspace panel and an inline simulation window take the same
 * steps, and two copies of them would drift on the first change. What it
 * deliberately does not do is gather geometry or a camera: the worker freezes
 * the frame, since that is where the whole render state lives, and the dialog
 * builds and paints its scenes (`simulatorExportTarget`).
 */
export interface SimulatorExportOptions {
  /** Which surface is exporting, for the dialog's policy and the analytics. */
  surface: SimulatorExportCapture['surface'];
  /** The object's pinned style fields, for a window that has them. */
  overrides?: PaperStyleOverrides;
}

export function useSimulatorExport(
  beginExport: SimulatorRuntime['beginExport'],
  { surface, overrides }: SimulatorExportOptions
): () => Promise<void> {
  const { t } = useTranslation();

  return useCallback(async () => {
    // Before the await: the control the verb was run from, while it has focus.
    const returnFocus = focusedElement();
    // A worker round trip can reject (a lost GL context, a session released
    // mid-click), and that is the same outcome for the user as an empty view.
    const snapshot = await beginExport().catch(() => null);
    if (!snapshot) {
      toast.error(t('toasts:simulatorExport.empty', 'This simulation has nothing to export yet'));
      return;
    }
    // Read rather than subscribed: the style and the title matter at the
    // moment of export, and a subscription would re-render a surface that
    // repaints per solver frame.
    const target = simulatorExportTarget({
      snapshot,
      surface,
      title: t('dialogs:paperExport.titleSimulation', 'Export view'),
      // `workspaceTitle`, not the tree's title: the export defaults are named
      // after the project, and what gets simulated is most often a crease
      // pattern with no tree behind it.
      fileStem: useWorkspaceStore.getState().workspaceTitle,
      exportStyle: exportPaperStyle(useSettingsStore.getState().paperStyle, overrides),
      pins: overrides ?? null,
    });
    usePaperExportUiStore.getState().open({ target, format: null, scope: 'this', returnFocus });
  }, [beginExport, overrides, surface, t]);
}
