import {
  describeCpDocument,
  describeTreeDocument,
  unavailableContext,
  UNAVAILABLE,
  type ErrorReportContext,
} from '../../lib/errorReport';
import { getRuntimeSurface } from '../../platform/runtime';
import { useLayoutStore } from '../../store/layoutStore';
import { useLocaleStore } from '../../store/localeStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

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
 * Counts and kind only — see the privacy note in `lib/errorReport.ts`. The CP
 * document's `source.filename`/`source.path` and the project title are
 * deliberately not read.
 */
function readDocument(): string {
  const state = useWorkspaceStore.getState();
  const cp = state.oristudioCpDocument;
  if (cp) {
    const summary = cp.summary;
    const description = describeCpDocument({
      lineSegments: summary.line_segments,
      auxLineSegments: summary.aux_line_segments,
      circles: summary.circles,
      points: summary.points,
      texts: summary.texts,
    });
    return state.dirty ? `${description} · unsaved changes` : description;
  }

  // `project` is never null — the store seeds an empty tree — so emptiness, not
  // nullness, is what distinguishes "no document" from "an empty tree the user
  // is working on". Reporting the latter as a tree would be a small lie in the
  // one artifact whose whole job is to be accurate.
  const project = state.project;
  if (project && (project.nodes.length > 0 || project.edges.length > 0)) {
    const description = describeTreeDocument({
      nodes: project.nodes.length,
      edges: project.edges.length,
      paths: project.paths.length,
      conditions: project.conditions.length,
    });
    return state.dirty ? `${description} · unsaved changes` : description;
  }

  return 'none open';
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
      workspace: safely(() => useLayoutStore.getState().activeWorkspace),
      editingContext: safely(() => useWorkspaceStore.getState().activeEditingContext),
      document: safely(readDocument),
    };
  } catch {
    return unavailableContext(surface);
  }
}
