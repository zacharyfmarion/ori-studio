import { useEffect } from 'react';
import { useTutorialStore } from '../store/tutorialStore';
import { CourseCatalogPanel } from '../components/panels/CourseCatalogPanel';

/**
 * `/learn` — the course catalog.
 *
 * Full width, outside the workspace shell: there is no practice document here,
 * so mounting the editing layout would put a live crease-pattern canvas beside a
 * page nobody is about to draw on.
 *
 * Closing the active lesson is what makes going "up" from a lesson land
 * somewhere predictable rather than resuming the last pane state.
 */
export function LearnIndexRoute() {
  const closeLesson = useTutorialStore((state) => state.closeLesson);
  useEffect(() => closeLesson(), [closeLesson]);
  return <CourseCatalogPanel />;
}
