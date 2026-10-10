/**
 * What an Update of enlarged steps says once it has run (Revision 3): the
 * steps it placed again, by number, or that it could not. Update folds the
 * faces older steps lack before it captures, so it can take a moment, and
 * without a word a press that changed nothing looks the same as one that
 * worked.
 *
 * Every Update says it (review fix 4): Update All, on an area's row in
 * Layers, in its step's Enlarged section and in its step's menu, and an
 * enlarged step's own Update. Each places only the steps out of date
 * (`updateTargets`), so what it says it placed is counted against those.
 */
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import i18n from '../../i18n';
import { humanizeError } from '../../lib/toastMessages';
import { reportError } from '../../monitoring';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { stepNumber, type DiagramDocument } from '../document/diagramDocument';
import { formatStepRuns } from '../stepNumberList';
import { updateTargets, type EnlargedUpdate } from './areaStatus';

export type UpdateEnlargedToast =
  | { tone: 'success'; title: string }
  | { tone: 'warning'; title: string; description: string }
  | { tone: 'error'; title: string; description?: string };

/**
 * The toast for an Update that placed `placed` of the steps it was asked to
 * place (`steps`): every one by its number — one, a run of steps one after
 * another, or the runs listed when there is a gap between them — some of
 * them, or none.
 */
export function updatedToast(
  t: TFunction,
  steps: readonly { number: number }[],
  placed: number,
  language: string = i18n.language
): UpdateEnlargedToast {
  const numbers = [...new Set(steps.map((step) => step.number))].sort((a, b) => a - b);
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  if (placed === 0 || first === undefined || last === undefined) return failedToast(t);
  if (placed < steps.length) {
    return {
      tone: 'warning',
      title: t('toasts:diagram.zoom.updatedSome', 'Updated {{placed}} of {{total}} enlarged steps', {
        placed,
        total: steps.length,
      }),
      description: t('toasts:diagram.zoom.updatedSomeDetail', 'The others couldn’t take a frame from this area.'),
    };
  }
  if (first === last) {
    return { tone: 'success', title: t('toasts:diagram.zoom.updatedOne', 'Updated enlarged step {{number}}', { number: first }) };
  }
  if (last - first === numbers.length - 1) {
    return {
      tone: 'success',
      title: t('toasts:diagram.zoom.updatedRange', 'Updated enlarged steps {{first}}–{{last}}', { first, last }),
    };
  }
  // Only the steps out of date were placed, so a range over a gap would name steps it did not touch.
  return {
    tone: 'success',
    title: t('toasts:diagram.zoom.updatedList', 'Updated enlarged steps {{numbers}}', {
      numbers: formatStepRuns(numbers, language),
    }),
  };
}

/** The toast for an Update that placed nothing, or stopped on `error`. */
export function failedToast(t: TFunction, error?: unknown): UpdateEnlargedToast {
  const title = t('toasts:diagram.zoom.updateFailed', 'The enlarged steps couldn’t be updated');
  return error === undefined ? { tone: 'error', title } : { tone: 'error', title, description: humanizeError(error, t) };
}

/** Show a toast made by {@link updatedToast} or {@link failedToast}. */
export function showUpdateEnlargedToast(said: UpdateEnlargedToast): void {
  const options = 'description' in said && said.description ? { description: said.description } : undefined;
  if (said.tone === 'success') toast.success(said.title);
  else if (said.tone === 'warning') toast.warning(said.title, options);
  else toast.error(said.title, options);
}

/** The steps an Update would place, by number, read from the diagram before it runs. */
export function updateTargetSteps(document: DiagramDocument, request: EnlargedUpdate): { number: number }[] {
  return updateTargets(document, request).stepIds.flatMap((stepId) => {
    const number = stepNumber(document, stepId);
    return number === null ? [] : [{ number }];
  });
}

/**
 * Run an Update from the store, and say what it did: Update All over
 * `areaIds`, or one enlarged step's own Update (`stepId`). The steps it was
 * asked to place are read before it runs. A diagram replaced while it ran
 * took the press with it, and one refused while an Update of its area runs
 * is that one's to say, so nothing is said for either; an error is reported,
 * and said. How many steps it placed, none on an error or a refusal.
 */
export function runEnlargedUpdate(request: EnlargedUpdate, t: TFunction): Promise<number> {
  const store = useWorkspaceStore.getState;
  const { diagram, diagramLoadId } = store();
  const steps = diagram ? updateTargetSteps(diagram, request) : [];
  const running =
    'stepId' in request ? store().updateEnlargedDiagramStep(request.stepId) : store().updateEnlargedDiagramSteps(request.areaIds);
  return running.then(
    (placed) => {
      if (placed === null) return 0;
      const now = store();
      if (now.diagram && now.diagramLoadId === diagramLoadId) showUpdateEnlargedToast(updatedToast(t, steps, placed));
      return placed;
    },
    (error: unknown) => {
      reportError(error, { surface: 'diagram:update-enlarged-steps' });
      showUpdateEnlargedToast(failedToast(t, error));
      return 0;
    }
  );
}
