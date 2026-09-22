import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ANALYTICS_EVENTS, track } from '../../analytics';
import { paperPageOf } from '../../lib/paperExportSettings';
import { exportPaperStyle } from '../../lib/paperStyleSettings';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import type { ReferencesDiagramView } from './ReferencesCpView';
import {
  referencesSheetCssPx,
  referencesStepExportName,
  referencesStepExportPage,
  saveReferencesStep,
  type ReferencesStepExportFormat,
  type ReferencesStepExportSubject,
} from './referencesStepExport';

/**
 * "Export this step" as one verb: the panel's binding for the two export
 * commands in the action catalog.
 *
 * `useSimulatorViewExport`'s shape. The panel hands it what it alone knows —
 * the diagram the big view is showing, the camera it draws through, which
 * face the reader is on and which card it is — and this resolves what the
 * settings know at the moment of export (the export style and page, the
 * PNG density, the workspace title), paints, saves, and says what was saved.
 *
 * The diagram is the step at rest: the fold animation's mid-fold pose is not
 * exported (the plan records it as a later option).
 */
export interface ReferencesStepExportInput {
  /**
   * The step as a page carries it — `ReferencesHighlights.pageDiagram`, which
   * is the big view's picture plus the creases the canvas draws underneath —
   * or null when there is no step showing.
   */
  diagram: StepDiagramModel | null;
  /** The big view's camera, or null before its first frame; the page then takes a fixed sheet size. */
  camera: ReferencesDiagramView | null;
  /** The reader is on the paper's back. */
  mirrored: boolean;
  /** The reader's crease width, which is the diagram's pen on the big view. */
  lineWidth: number;
  /** Which card is showing, for the file's name. */
  subject: ReferencesStepExportSubject;
}

export function useReferencesStepExport({
  diagram,
  camera,
  mirrored,
  lineWidth,
  subject,
}: ReferencesStepExportInput): (format: ReferencesStepExportFormat) => Promise<boolean> {
  const { t } = useTranslation();

  return useCallback(
    async (format: ReferencesStepExportFormat) => {
      if (!diagram) {
        toast.error(t('toasts:referencesExport.empty', 'There is no step to export yet'));
        return false;
      }
      // Read rather than subscribed: the style, the page and the title matter
      // at the moment of export, not on every render of the panel.
      const { paperStyle, paperExport } = useSettingsStore.getState();
      const page = paperPageOf(paperExport);
      try {
        const painted = referencesStepExportPage(diagram, {
          style: exportPaperStyle(paperStyle),
          page,
          mirrored,
          sheetCssPx: referencesSheetCssPx(diagram.sheet, camera),
          lineWidth,
        });
        const saved = await saveReferencesStep({
          page: painted,
          format,
          pngDpi: paperExport.pngDpi,
          name: referencesStepExportName(useWorkspaceStore.getState().workspaceTitle, subject),
        });
        // Null is a dismissed save dialog, which needs no announcement.
        if (saved) {
          // Hand-placed: the file service's `file exported` sees a format and
          // nothing of which surface drew it or on what page.
          track(ANALYTICS_EVENTS.paperExported, {
            surface: 'references',
            format,
            hidden_faces: page.keepHiddenFaces ? 'kept' : 'dropped',
          });
          toast.success(t('toasts:referencesExport.saved', 'Exported {{name}}', { name: saved }));
        }
        return Boolean(saved);
      } catch (cause) {
        toast.error(t('toasts:referencesExport.failed', 'Could not export this step'), {
          description: cause instanceof Error ? cause.message : undefined,
        });
        return false;
      }
    },
    [diagram, camera, mirrored, lineWidth, subject, t]
  );
}
