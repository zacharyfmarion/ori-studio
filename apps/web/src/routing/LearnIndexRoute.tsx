import { useEffect } from 'react';
import { useTutorialStore } from '../store/tutorialStore';
import { WorkspaceRoute } from './WorkspaceRoute';

/**
 * `/learn` — the lesson index. Closing the active lesson is what makes the
 * tutorial pane show the index rather than whatever was last open, so going
 * "up" from a lesson lands somewhere predictable.
 */
export function LearnIndexRoute() {
  const closeLesson = useTutorialStore((state) => state.closeLesson);
  useEffect(() => closeLesson(), [closeLesson]);
  return <WorkspaceRoute workspace="learn" slot="learn" />;
}
