import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import type { PaperExportFormat } from '../../lib/paperExportSettings';
import { exportPaperStyle } from '../../lib/paperStyleSettings';
import type { PaperExportScope } from '../../paperExport/paperExportTarget';
import { focusedElement, usePaperExportUiStore } from '../../store/paperExportUiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import type { ReferencesDiagramView } from './ReferencesCpView';
import {
  referencesExportSteps,
  type ReferencesExportStep,
  type ReferencesStepsSource,
} from './referencesExportSteps';
import { referencesExportTarget } from './referencesExportTarget';
import {
  referencesSheetCssPx,
  referencesStepEntryName,
  referencesStepExportName,
  referencesStepsArchiveName,
  type ReferencesStepExportSubject,
} from './referencesStepExport';

/**
 * "Export this step" and "Export all steps": the panel's binding for the
 * export commands in the action catalog.
 *
 * The panel hands it what it alone knows — the diagram the big view is
 * showing, the camera it draws through, which face the reader is on and which
 * card it is, and what the strip holds. A verb captures that as the export
 * dialog's target — the step on show and every other step the strip has — and
 * opens the dialog on the step or on all of them, where the style, the page
 * and the format are chosen with the page in view (`PaperExportModal`).
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
  /** What the strip is showing, read for its every step only when a verb runs. */
  source: ReferencesStepsSource;
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

/** A card's name in the dialog's pager, as the strip numbers it. */
export function referencesStepPageLabel(t: TFunction, subject: ReferencesStepExportSubject): string {
  switch (subject.kind) {
    case 'turn-over':
      return t('dialogs:paperExport.pageTurnOver', 'Turn over');
    case 'step':
    case 'reference':
      return t('dialogs:paperExport.pageStep', 'Step {{number}}', { number: subject.step + 1 });
  }
}

/** The export verbs, as the action catalog's commands name them. */
export interface ReferencesStepExportVerbs {
  /** Open the dialog on the step, on the format last saved in. */
  exportStep: () => void;
  exportStepSvg: () => void;
  exportStepPng: () => void;
  /** Open the dialog on every step, as one ZIP. */
  exportAllSteps: () => void;
}

/** The same card: the subject's kind and every number it carries. */
function sameSubject(a: ReferencesStepExportSubject, b: ReferencesStepExportSubject): boolean {
  const left = Object.entries(a);
  return (
    left.length === Object.keys(b).length &&
    left.every(([field, value]) => (b as Record<string, unknown>)[field] === value)
  );
}

/**
 * The pages the dialog opens on: every step the strip has, with the step on
 * show drawn exactly as the big view draws it. Should the strip have no page
 * for the card on show, "this step" is that card alone.
 */
function capturedSteps(
  input: Pick<ReferencesStepExportInput, 'diagram' | 'mirrored' | 'subject' | 'source'>,
  scope: PaperExportScope
): { steps: ReferencesExportStep[]; current: number } {
  const { steps, current } = referencesExportSteps(input.source);
  const { diagram } = input;
  if (!diagram) return { steps, current };
  const shown = { diagram, mirrored: input.mirrored, subject: input.subject };
  const onShow = steps[current];
  if (onShow && sameSubject(onShow.subject, input.subject)) {
    return { steps: steps.map((step, index) => (index === current ? { ...step, ...shown } : step)), current };
  }
  return scope === 'this' ? { steps: [{ ...shown, card: 0 }], current: 0 } : { steps, current };
}

/** Open the export dialog on the step, or on every step: on the remembered format, or on the verb's own. */
export function useReferencesStepExport({
  diagram,
  camera,
  mirrored,
  lineWidth,
  subject,
  source,
}: ReferencesStepExportInput): ReferencesStepExportVerbs {
  const { t } = useTranslation();

  const open = useCallback(
    (format: PaperExportFormat | null, scope: PaperExportScope) => {
      if (scope === 'this' && !diagram) {
        toast.error(t('toasts:referencesExport.empty', 'There is no step to export yet'));
        return;
      }
      const { steps, current } = capturedSteps({ diagram, mirrored, subject, source }, scope);
      const onShow = steps[current];
      if (!onShow) {
        toast.error(t('toasts:referencesExport.noSteps', 'There are no steps to export yet'));
        return;
      }
      // Read rather than subscribed: the style and the title matter at the
      // moment of export, not on every render of the panel.
      const { paperStyle, referencesShowAuxCreases } = useSettingsStore.getState();
      const { workspaceTitle } = useWorkspaceStore.getState();
      const target = referencesExportTarget({
        steps: steps.map((step, index) => ({
          diagram: step.diagram,
          mirrored: step.mirrored,
          label: referencesStepPageLabel(t, step.subject),
          entryStem: referencesStepEntryName(step.subject, index, steps.length),
        })),
        current,
        title: referencesStepExportTitle(t, onShow.subject),
        fileStem: referencesStepExportName(workspaceTitle, onShow.subject),
        allTitle: t('dialogs:paperExport.titleAllSteps', 'Export all steps'),
        zipStem: referencesStepsArchiveName(workspaceTitle, onShow.subject),
        exportStyle: exportPaperStyle(paperStyle),
        // Every step is the same sheet, drawn at the big view's scale.
        sheetCssPx: referencesSheetCssPx(onShow.diagram.sheet, camera),
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
      usePaperExportUiStore.getState().open({ target, format, scope, returnFocus: focusedElement() });
    },
    [diagram, camera, mirrored, lineWidth, subject, source, t]
  );

  return useMemo(
    () => ({
      exportStep: () => open(null, 'this'),
      exportStepSvg: () => open('svg', 'this'),
      exportStepPng: () => open('png', 'this'),
      exportAllSteps: () => open(null, 'all'),
    }),
    [open]
  );
}
