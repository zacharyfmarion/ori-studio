import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import type { PaperExportFormat } from '../../lib/paperExportSettings';
import { exportPaperStyle } from '../../lib/paperStyleSettings';
import { focusedElement, usePaperExportUiStore } from '../../store/paperExportUiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import type { ReferencesDiagramView } from './ReferencesCpView';
import { referencesExportTarget } from './referencesExportTarget';
import {
  referencesSheetCssPx,
  referencesStepExportName,
  type ReferencesStepExportSubject,
} from './referencesStepExport';

/**
 * "Export this step" as one verb: the panel's binding for the export commands
 * in the action catalog.
 *
 * The panel hands it what it alone knows — the diagram the big view is
 * showing, the camera it draws through, which face the reader is on and which
 * card it is. The verb captures that as the export dialog's target and opens
 * the dialog, where the style, the page and the format are chosen with the
 * page in view (`PaperExportModal`).
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
  /** Which card is showing, for the dialog's title and the file's name. */
  subject: ReferencesStepExportSubject;
}

/** The dialog's title for the card being exported. */
export function referencesStepExportTitle(t: TFunction, subject: ReferencesStepExportSubject): string {
  switch (subject.kind) {
    case 'step':
      return t('dialogs:paperExport.titleStep', 'Export step {{number}}', { number: subject.step + 1 });
    case 'turn-over':
      return t('dialogs:paperExport.titleTurnOver', 'Export turn-over');
    case 'reference':
      return t('dialogs:paperExport.titleReference', 'Export reference {{candidate}}, step {{number}}', {
        candidate: subject.candidate + 1,
        number: subject.step + 1,
      });
  }
}

/** The export verbs, as the action catalog's commands name them. */
export interface ReferencesStepExportVerbs {
  /** Open the dialog on the format last saved in. */
  exportStep: () => void;
  exportStepSvg: () => void;
  exportStepPng: () => void;
}

/** Open the export dialog on the step: on the remembered format, or on the verb's own. */
export function useReferencesStepExport({
  diagram,
  camera,
  mirrored,
  lineWidth,
  subject,
}: ReferencesStepExportInput): ReferencesStepExportVerbs {
  const { t } = useTranslation();

  const open = useCallback(
    (format: PaperExportFormat | null) => {
      if (!diagram) {
        toast.error(t('toasts:referencesExport.empty', 'There is no step to export yet'));
        return;
      }
      // Read rather than subscribed: the style and the title matter at the
      // moment of export, not on every render of the panel.
      const { paperStyle, referencesShowAuxCreases } = useSettingsStore.getState();
      const target = referencesExportTarget({
        diagram,
        title: referencesStepExportTitle(t, subject),
        fileStem: referencesStepExportName(useWorkspaceStore.getState().workspaceTitle, subject),
        exportStyle: exportPaperStyle(paperStyle),
        mirrored,
        sheetCssPx: referencesSheetCssPx(diagram.sheet, camera),
        lineWidth,
        // The option when the reader has set it; otherwise the export style's
        // own switch, as every other surface's export follows it.
        showAux: referencesShowAuxCreases,
      });
      // Focus goes back to whatever held it: the toolbar button a keyboard
      // pressed. A pointer press in WebKit focuses nothing, and a menu item is
      // gone by the time the dialog closes; focus then stays where the
      // browser leaves it, and the References keys, which do not depend on
      // focus, still work.
      usePaperExportUiStore.getState().open({ target, format, returnFocus: focusedElement() });
    },
    [diagram, camera, mirrored, lineWidth, subject, t]
  );

  return useMemo(
    () => ({
      exportStep: () => open(null),
      exportStepSvg: () => open('svg'),
      exportStepPng: () => open('png'),
    }),
    [open]
  );
}
