/**
 * What Update Enlarged Steps says once it has run (Revision 3): the steps it
 * placed again, by number, or that it could not. Update folds the faces older
 * steps lack before it captures, so it can take a moment, and without a word
 * a press that changed nothing looks the same as one that worked.
 */
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { humanizeError } from '../../lib/toastMessages';

export type UpdateEnlargedToast =
  | { tone: 'success'; title: string }
  | { tone: 'warning'; title: string; description: string }
  | { tone: 'error'; title: string; description?: string };

/**
 * The toast for an Update that placed `placed` of the area's enlarged steps
 * (`steps`, in order, as the area's row lists them): every one by its number,
 * some of them, or none.
 */
export function updatedToast(
  t: TFunction,
  steps: readonly { number: number }[],
  placed: number
): UpdateEnlargedToast {
  const first = steps[0];
  const last = steps[steps.length - 1];
  if (placed === 0 || !first || !last) return failedToast(t);
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
  return {
    tone: 'success',
    title:
      first.number === last.number
        ? t('toasts:diagram.zoom.updatedOne', 'Updated enlarged step {{number}}', { number: first.number })
        : t('toasts:diagram.zoom.updatedRange', 'Updated enlarged steps {{first}}–{{last}}', {
            first: first.number,
            last: last.number,
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
