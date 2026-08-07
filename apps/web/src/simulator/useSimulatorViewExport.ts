import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { SvgRenderResult } from '@treemaker/origami-simulator';
import { useWorkspaceStore } from '../store/workspaceStore';
import { saveSimulatorView, type SimulatorViewExportFormat } from './simulatorViewExport';
import type { SimulatorExportBackground } from '../lib/simulatorSettings';

/**
 * "Export this view" as one verb, for every surface that shows a simulation.
 *
 * Both the Simulate workspace panel and an inline simulation window need the
 * same four steps — ask the worker for the page, refuse politely when there is
 * nothing to draw, save it, say what was saved — and two copies of that would
 * drift on the first change to any of them.
 *
 * What it deliberately does *not* do is gather geometry, a camera or a palette.
 * The worker builds the document because that is where the whole render state
 * already lives; this hook only moves the result to disk.
 */
export function useSimulatorViewExport(
  exportSvg: (background?: SimulatorExportBackground) => Promise<SvgRenderResult | null>
): (format: SimulatorViewExportFormat) => Promise<boolean> {
  const { t } = useTranslation();
  const background = useWorkspaceStore((state) => state.simulatorSettings.exportBackground);

  return useCallback(
    async (format: SimulatorViewExportFormat) => {
      // A worker round-trip can reject (a lost GL context, a session released
      // mid-click), and that is the same outcome for the user as an empty view.
      const page = await exportSvg(background).catch(() => null);
      if (!page) {
        toast.error(
          t('toasts:simulatorExport.empty', 'This simulation has nothing to export yet')
        );
        return false;
      }
      try {
        // Read rather than subscribed: the title matters at the moment of export,
        // and a subscription here would re-render a surface that repaints per
        // solver frame.
        //
        // `workspaceTitle`, not the tree's title: the export defaults are named
        // after the project (see `types.ts`), and what gets simulated is most
        // often a crease pattern with no tree behind it — where the tree's title
        // is the empty design's `'Untitled'`. Same slip as `useWindowTitle`.
        const saved = await saveSimulatorView({
          page,
          format,
          name: useWorkspaceStore.getState().workspaceTitle,
        });
        // Null is a dismissed save dialog, which needs no announcement.
        if (saved) {
          toast.success(t('toasts:simulatorExport.saved', 'Exported {{name}}', { name: saved }));
        }
        return Boolean(saved);
      } catch (cause) {
        toast.error(t('toasts:simulatorExport.failed', 'Could not export this view'), {
          description: cause instanceof Error ? cause.message : undefined,
        });
        return false;
      }
    },
    [exportSvg, background, t]
  );
}
