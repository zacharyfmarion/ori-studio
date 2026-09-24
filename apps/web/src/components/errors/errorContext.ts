import { unavailableContext, UNAVAILABLE, type ErrorReportContext } from '../../lib/errorReport';
import { getRuntimeSurface } from '../../platform/runtime';
import { useLocaleStore } from '../../store/localeStore';

/**
 * Collects the app state that goes into an error report.
 *
 * This is the boundary's store binding, kept out of `lib/errorReport.ts` so the
 * report builder itself stays pure and store-free.
 *
 * **Every read is individually guarded.** By the time this runs something has
 * already gone wrong, and a selector that throws here would escalate the
 * failure to the parent boundary — turning a contained panel crash into a dead
 * app, at precisely the moment we are trying to explain the first one. Each
 * field independently degrades to `UNAVAILABLE`, so one broken store still
 * leaves a usable report.
 */

function safely(read: () => string): string {
  try {
    const value = read();
    return value === '' ? UNAVAILABLE : value;
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * What only the workspace can say about itself. Registered by `workspaceErrorFacts.ts`
 * when the workspace code loads, so the error boundaries — which the landing page mounts
 * too — never import the workspace store themselves.
 */
export interface WorkspaceErrorFacts {
  workspace(): string;
  editingContext(): string;
  document(): string;
}

let workspaceFacts: WorkspaceErrorFacts | null = null;

export function registerWorkspaceErrorFacts(facts: WorkspaceErrorFacts | null): void {
  workspaceFacts = facts;
}

/**
 * Never throws. Callers are error handlers; making them each wrap this in a
 * try/catch would be the same guard written six times, and forgetting it once
 * would turn a contained crash into a dead app.
 */
export function collectErrorContext(surface: string): ErrorReportContext {
  try {
    return {
      surface,
      runtime: safely(() => getRuntimeSurface()),
      userAgent: safely(() => (typeof navigator === 'undefined' ? '' : navigator.userAgent)),
      locale: safely(() => useLocaleStore.getState().locale),
      // Before the workspace has loaded there is none, and no document either.
      workspace: safely(() => workspaceFacts?.workspace() ?? ''),
      editingContext: safely(() => workspaceFacts?.editingContext() ?? ''),
      document: safely(() => workspaceFacts?.document() ?? 'none open'),
    };
  } catch {
    return unavailableContext(surface);
  }
}
