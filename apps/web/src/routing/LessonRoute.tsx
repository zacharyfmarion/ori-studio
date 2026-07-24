import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useTutorialStore } from '../store/tutorialStore';
import { lessonById } from '../tutorial/lessons';
import { LEARN_PATH } from './paths';
import { WorkspaceRoute } from './WorkspaceRoute';

/**
 * `/learn/:lessonId`. Establishes *which* lesson is open — intent only. The
 * lesson's practice document is provisioned by the panel that shows it, the same
 * rule every other surface follows (routes express intent, surfaces provision).
 *
 * An unknown lesson id redirects to the index rather than rendering an empty
 * shell, so a stale bookmark or a renamed lesson lands somewhere useful.
 */
export function LessonRoute() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const openLesson = useTutorialStore((state) => state.openLesson);
  const known = lessonId ? lessonById(lessonId) : undefined;

  useEffect(() => {
    if (known) openLesson(known.id);
  }, [known, openLesson]);

  if (!known) return <Navigate to={LEARN_PATH} replace />;

  return <WorkspaceRoute workspace="learn" slot="learn" />;
}
