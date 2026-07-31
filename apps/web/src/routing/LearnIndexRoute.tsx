import { useEffect } from 'react';
import { useTutorialStore } from '../store/tutorialStore';
import { CourseCatalogPanel } from '../components/panels/CourseCatalogPanel';
import { WorkspaceRoute } from './WorkspaceRoute';

/**
 * `/learn` — the course catalog. Covers the workspace canvas rather than
 * replacing the shell, so the toolbar and rail stay put.
 *
 * It still asserts the learn workspace: the rail highlights whichever workspace
 * is active, so without this the Learn tab would sit unlit on the very page it
 * navigates to.
 *
 * Closing the active lesson is what makes going "up" from one land somewhere
 * predictable rather than resuming the last pane state.
 */
export function LearnIndexRoute() {
  const closeLesson = useTutorialStore((state) => state.closeLesson);
  useEffect(() => closeLesson(), [closeLesson]);
  return (
    <>
      <WorkspaceRoute workspace="learn" slot="learn" />
      <CourseCatalogPanel />
    </>
  );
}
