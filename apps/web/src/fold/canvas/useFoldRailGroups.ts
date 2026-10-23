import { activeFoldLineMode } from '../tools/foldToolState';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { foldRailGroups, type FoldRailGroup } from '../tools/foldRailGroups';
import type { FoldReadOnlyReason } from '../tools/foldToolCatalog';
import { foldTools, useFoldTools } from '../tools/foldToolState';
import { useFoldCursor, useFoldSessionState } from '../session/useFoldSession';
import { withFoldCanvasVerbs } from './foldCanvasCommands';

/**
 * Why nothing can change from the step on screen, or null while something
 * can: a newer build's sequence (D7), or a step locked behind one (D6).
 */
export function useFoldReadOnly(): FoldReadOnlyReason | null {
  const readOnly = useFoldSessionState((snapshot) => snapshot.readOnly);
  const cursor = useFoldCursor();
  if (readOnly) return 'newer';
  return cursor.status === 'locked' ? 'locked' : null;
}

/**
 * The rail's groups (`foldRailGroups`) for every surface that shows the Fold
 * tools — the rail down the panel's side, and the phone's tool sheet on the
 * canvas's bar — bound to the tools and, for a turn, to the canvas's session
 * verbs: a turn is made once the canvas is up (`withFoldCanvasVerbs`).
 */
export function useFoldRailGroups(): readonly FoldRailGroup[] {
  const { t } = useTranslation();
  const tool = useFoldTools((state) => state.tool);
  const lineMode = useFoldTools(activeFoldLineMode);
  const swivelInput = useFoldTools((state) => state.swivelInput);
  const squashHinge = useFoldTools((state) => state.squashHinge);
  const lineTaken = useFoldTools((state) => state.takenLine !== undefined);
  const readOnly = useFoldReadOnly();
  const atSheet = useFoldSessionState((snapshot) => snapshot.cursor === null);
  return useMemo(() => {
    const tools = foldTools();
    return foldRailGroups(
      t,
      { tool, lineMode, construction: { swivelInput, squashHinge, lineTaken }, readOnly, atSheet },
      {
        selectTool: (id) => tools.selectTool(id),
        selectLineMode: (id) => tools.selectLineMode(id),
        // A turn is a step: it goes through the canvas's session verbs, which
        // are there only while a canvas is.
        turn: (turn) => withFoldCanvasVerbs((verbs) => verbs.turn(turn)),
      }
    );
  }, [t, tool, lineMode, swivelInput, squashHinge, lineTaken, readOnly, atSheet]);
}
