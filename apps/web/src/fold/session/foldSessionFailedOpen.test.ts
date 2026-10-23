/**
 * The Fold session across an open that fails while a Fold surface holds it.
 *
 * The open discards the project's sequences (a new load id) before it
 * installs the file, and the session starts replaying the empty project at
 * once. When the install then fails, the open puts the old sequences back —
 * with their old load id, lower than the discard's. The session replays them
 * again, and must land them: the document on screen is the old one, intact.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNativeProjectFile, serializeNativeProjectFile } from '../../lib/nativeProjectFile';
import { foldSessionDocumentSource } from '../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { valleyAt } from '../document/foldSequence.fixtures';
import { createFoldSession, type FoldSession } from './foldSession';
import { fakeFoldEngine, inProcessFoldRuntime, settle } from './foldSession.fixtures';
import { selectFoldCursorNode } from './foldSessionState';

/** A project file that parses but holds nothing, which the open refuses after discarding the old documents. */
const EMPTY_PROJECT = serializeNativeProjectFile(
  createNativeProjectFile({
    workspaceTitle: 'Empty',
    filename: 'empty.osf',
    path: null,
    designs: [],
    creasePattern: null,
    appVersion: 'test',
  })
);

let session: FoldSession;

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
  session = createFoldSession({
    document: foldSessionDocumentSource(useWorkspaceStore),
    runtime: inProcessFoldRuntime(() => fakeFoldEngine()),
  });
});

afterEach(() => {
  session.dispose();
});

describe('the Fold session when an open fails over the shown sequence', () => {
  it('replays the sequence the open puts back, and keeps folding from it', async () => {
    session.retain();
    await settle();
    expect((await session.commitStep(valleyAt(0.5))).status).toBe('committed');
    await settle();
    const before = useWorkspaceStore.getState().foldLoadId;

    const fileService = { openTextFile: async () => ({ text: EMPTY_PROJECT, name: 'empty.osf', path: null }) };
    const opened = await useWorkspaceStore
      .getState()
      .openProject(fileService as never, { confirmDiscard: false });
    await settle();

    // The open failed, and put back the sequence as it stood, load id and all.
    expect(opened).toBe(false);
    expect(useWorkspaceStore.getState().error?.code).toBe('project_file_damaged');
    expect(useWorkspaceStore.getState().foldLoadId).toBe(before);
    expect(useWorkspaceStore.getState().foldSequences[0]?.document.steps).toHaveLength(1);

    const snapshot = session.store.getState();
    expect(snapshot.sheet.status).toBe('ok');
    expect(selectFoldCursorNode(snapshot).status).toBe('ok');
    expect(snapshot.error).toBeNull();
    await expect(session.commitStep(valleyAt(0.25))).resolves.toMatchObject({ status: 'committed' });
    await settle();
    expect(selectFoldCursorNode(session.store.getState()).status).toBe('ok');
  });
});
