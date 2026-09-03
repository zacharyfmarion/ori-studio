import i18n from '../../i18n';
import { reportError } from '../../monitoring';
import { toast } from 'sonner';

/**
 * Running a context-menu item safely.
 *
 * Menu rows call store actions, and a store action can reject: a kernel command
 * that traps, a worker round trip that never lands, an export whose file handle
 * has gone stale. Every existing call site in the app spells this `() => void
 * handleMenuAction(id)` — which discards the promise, so a rejection becomes an
 * unhandled rejection with no user-visible trace and nothing in Sentry tagged to
 * the surface that caused it.
 *
 * That is survivable on a toolbar button, where the user can see the thing they
 * pressed did nothing. It is not here: a context menu closes the instant an item
 * is chosen, so a failure leaves no trace at all — the menu is gone and the
 * document is unchanged, which is indistinguishable from a misclick.
 *
 * Deliberately not a `try`/`catch` at each call site. One wrapper is what makes
 * "every row in every context menu reports" true by construction, rather than
 * true of the rows whose author remembered.
 */
export function runContextMenuAction(surface: string, id: string, run: () => unknown): void {
  const fail = (error: unknown) => {
    reportError(error, { surface: 'context-menu', tags: { context_menu_surface: surface, item: id } });
    toast.error(i18n.t('toasts:contextMenu.failed', 'That action could not be completed'), {
      // Keyed by the item, so a row pressed twice replaces its own toast rather
      // than stacking two identical ones.
      id: `context-menu-failed-${id}`,
      description: i18n.t(
        'toasts:contextMenu.failedDetail',
        'Nothing was changed. If it keeps happening, try reloading.'
      ),
      duration: 8000,
    });
  };

  try {
    const result = run();
    // `Promise.resolve` would work, but `then` on the value itself keeps a
    // synchronous action synchronous — which is what lets a test assert the
    // effect without awaiting a microtask.
    if (result instanceof Promise) void result.catch(fail);
  } catch (error) {
    fail(error);
  }
}
