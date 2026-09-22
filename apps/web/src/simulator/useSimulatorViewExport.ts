import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ANALYTICS_EVENTS, track, type PaperExportSurface } from '../analytics';
import { effectivePaperStyle, type PaperStyleOverrides } from '../lib/paper/paperStyle';
import type { PaperSvgResult } from '../lib/paper/paperSvg';
import { paperPageOf } from '../lib/paperExportSettings';
import { useSettingsStore } from '../store/settingsStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { saveSimulatorView, type SimulatorViewExportFormat } from './simulatorViewExport';
import type { SimulatorExportRequest } from './useSimulatorRuntime';

/**
 * "Export this view" as one verb, for every surface that shows a simulation.
 *
 * Both the Simulate workspace panel and an inline simulation window need the
 * same steps — resolve the style and page the export draws with, ask the
 * worker for the page, refuse politely when there is nothing to draw, save it,
 * say what was saved — and two copies of that would drift on the first change
 * to any of them.
 *
 * What it deliberately does *not* do is gather geometry or a camera. The worker
 * builds the document because that is where the whole render state already
 * lives; this hook resolves what the settings know — the export style with the
 * object's overrides on top, and the export page — and moves the result to disk.
 */
export interface SimulatorViewExportOptions {
  /** Which surface is exporting, for the `paper exported` event. */
  surface: PaperExportSurface;
  /** The object's pinned style fields, for a window that has them. */
  overrides?: PaperStyleOverrides;
}

export function useSimulatorViewExport(
  exportSvg: (request: SimulatorExportRequest) => Promise<PaperSvgResult | null>,
  { surface, overrides }: SimulatorViewExportOptions
): (format: SimulatorViewExportFormat) => Promise<boolean> {
  const { t } = useTranslation();

  return useCallback(
    async (format: SimulatorViewExportFormat) => {
      // Read rather than subscribed: the style, the page and the title matter at
      // the moment of export, and a subscription here would re-render a surface
      // that repaints per solver frame.
      const { paperStyle, paperExport } = useSettingsStore.getState();
      const style = effectivePaperStyle(paperStyle.export ?? paperStyle.display, overrides);
      const page = paperPageOf(paperExport);
      // A worker round-trip can reject (a lost GL context, a session released
      // mid-click), and that is the same outcome for the user as an empty view.
      const painted = await exportSvg({ style, page }).catch(() => null);
      if (!painted) {
        toast.error(
          t('toasts:simulatorExport.empty', 'This simulation has nothing to export yet')
        );
        return false;
      }
      try {
        // `workspaceTitle`, not the tree's title: the export defaults are named
        // after the project (see `types.ts`), and what gets simulated is most
        // often a crease pattern with no tree behind it — where the tree's title
        // is the empty design's `'Untitled'`. Same slip as `useWindowTitle`.
        const saved = await saveSimulatorView({
          page: painted,
          format,
          pngDpi: paperExport.pngDpi,
          name: useWorkspaceStore.getState().workspaceTitle,
        });
        // Null is a dismissed save dialog, which needs no announcement.
        if (saved) {
          // Hand-placed: the file service's `file exported` sees a format and
          // nothing of which surface drew it or on what page.
          track(ANALYTICS_EVENTS.paperExported, {
            surface,
            format,
            hidden_faces: page.keepHiddenFaces ? 'kept' : 'dropped',
          });
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
    [exportSvg, overrides, surface, t]
  );
}
