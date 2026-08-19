import { useEffect } from 'react';
import { applyWindowTitle, formatWindowTitle } from '../platform/windowTitle';
import { useWorkspaceStore } from '../store/workspaceStore';

/**
 * Keep the window (and Tauri) title showing the open project's name.
 *
 * **Reads `workspaceTitle`, deliberately.** This used to read
 * `selectProject(state).title` — the *tree's* name — from back when a workspace
 * was one tree and the two were the same string. Phase 2b split them (see the
 * `workspaceTitle` note in `store/workspaceStore/types.ts`) and moved every
 * project-level read onto the new field, but this one was left behind. Nothing
 * caught it, because a `.tmd5` open writes the same title to both.
 *
 * What it cost: any project with no tree in it. `selectProject` falls back to the
 * frozen `EMPTY_PROJECT`, whose title is the literal `'Untitled'` — so opening an
 * Oriedita `.ori` carrying `"title": "folded model metadata"`, or any box-pleat
 * design, showed "Untitled - Ori Studio" while the store held the real name all
 * along.
 *
 * A hook rather than an effect in `App.tsx` so the field it reads is asserted by
 * a test instead of by inspection, which is the part that failed the first time.
 *
 * **Prefers the open file's name over `workspaceTitle`**, which is what a
 * document window is conventionally titled by. The same care applies to the
 * field choice here: the gate is `currentFilePath`, not `currentFileName` — see
 * `formatWindowTitle` for why the latter cannot answer "is there a file".
 */
export function useWindowTitle() {
  const workspaceTitle = useWorkspaceStore((state) => state.workspaceTitle);
  const dirty = useWorkspaceStore((state) => state.dirty);
  const fileName = useWorkspaceStore((state) => state.currentFileName);
  const filePath = useWorkspaceStore((state) => state.currentFilePath);

  useEffect(() => {
    void applyWindowTitle(
      formatWindowTitle({ projectTitle: workspaceTitle, dirty, fileName, filePath }),
    );
  }, [dirty, fileName, filePath, workspaceTitle]);
}
