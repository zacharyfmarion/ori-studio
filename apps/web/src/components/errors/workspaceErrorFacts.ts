import { describeCpDocument, describeTreeDocument } from '../../lib/errorReport';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { selectProject } from '../../store/workspaceStore/designTabs';
import { registerWorkspaceErrorFacts } from './errorContext';

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
  const project = selectProject(state);
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

/** Give error reports the workspace's view of the app. The workspace entry calls this on load. */
export function installWorkspaceErrorFacts(): void {
  registerWorkspaceErrorFacts({
    workspace: () => useLayoutStore.getState().activeWorkspace,
    editingContext: () => useWorkspaceStore.getState().activeEditingContext,
    document: readDocument,
  });
}
