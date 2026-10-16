import { trackDiagramExampleOpened, type DiagramExampleOutcome } from '../../analytics';
import i18n from '../../i18n';
import { NATIVE_PROJECT_MIME_TYPE } from '../../lib/nativeProjectFile';
import { createDroppedFileService } from '../../platform/fileService';
import { showActiveWorkspace } from '../../routing/workspaceUrlSync';
import { useWorkspaceStore } from '../../store/workspaceStore';

/**
 * The example the empty Diagram offers: a crane, its crease pattern and a
 * finished diagram with a title block. A static file in `public/examples/`,
 * fetched only when asked for — the service worker leaves `/examples/` alone
 * (`pwa/swRoutes.ts`), so it is never precached or warmed.
 */
export const DIAGRAM_EXAMPLE_URL = `${import.meta.env.BASE_URL}examples/Crane.osf`;

/** The name the example opens under: the project's name, and what Save suggests. */
export const DIAGRAM_EXAMPLE_FILENAME = 'Crane.osf';

/** The video walkthrough of the Diagram workspace, linked beside the example. */
export const DIAGRAM_TUTORIAL_URL = 'https://www.youtube.com/watch?v=OMLFtb368is';

let opening: Promise<DiagramExampleOutcome> | null = null;

/**
 * Open the example as a file: download it, then hand it to `openProject`
 * exactly as a dropped file is handed — so it asks before discarding unsaved
 * work, replaces the project, and counts as an open like any other. Only the
 * landing differs: the Diagram, which is what the example is for, where an
 * `.osf` holding a crease pattern would otherwise land on Edit.
 *
 * Downloaded first, so a download that fails says so and never asks about
 * unsaved work it would not replace. A second press while one is under way
 * joins it rather than raising a second prompt over the first.
 */
export function openDiagramExample(): Promise<DiagramExampleOutcome> {
  opening ??= openExample().finally(() => {
    opening = null;
  });
  return opening;
}

async function openExample(): Promise<DiagramExampleOutcome> {
  const file = await downloadExample();
  if (!file) {
    useWorkspaceStore.setState({
      error: {
        code: 'invalid_operation',
        message: i18n.t(
          'errors:diagramExample.unavailable',
          "Couldn't download the example crane. Check your connection and try again."
        ),
      },
      projectMessage: null,
    });
    trackDiagramExampleOpened('unavailable');
    return 'unavailable';
  }

  // A refused file sets the store's error; a declined prompt leaves it as it was.
  const errorBefore = useWorkspaceStore.getState().error;
  const opened = await useWorkspaceStore
    .getState()
    .openProject(createDroppedFileService(file), { landing: 'diagram', source: 'example' });
  const outcome: DiagramExampleOutcome = opened
    ? 'opened'
    : useWorkspaceStore.getState().error !== errorBefore
      ? 'failed'
      : 'cancelled';
  if (opened) showActiveWorkspace();
  trackDiagramExampleOpened(outcome);
  return outcome;
}

async function downloadExample(): Promise<File | null> {
  try {
    const response = await fetch(DIAGRAM_EXAMPLE_URL);
    if (!response.ok) return null;
    const text = await response.text();
    return new File([text], DIAGRAM_EXAMPLE_FILENAME, { type: NATIVE_PROJECT_MIME_TYPE });
  } catch {
    // Offline, with the file in no cache: the browser's own error says nothing more.
    return null;
  }
}
