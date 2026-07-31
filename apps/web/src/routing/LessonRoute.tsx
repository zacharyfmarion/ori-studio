import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useTutorialStore } from '../store/tutorialStore';
import { courseIdForLesson, lessonById } from '../tutorial/lessons';
import { courseById } from '../tutorial/courses';
import { LEARN_PATH, coursePath, lessonPath } from './paths';
import { WorkspaceRoute } from './WorkspaceRoute';

/**
 * `/learn/:courseId/:lessonId`. Establishes *which* lesson is open — intent
 * only. The practice document is provisioned by the panel that shows it, the
 * same rule every other surface follows (routes express intent, surfaces
 * provision).
 *
 * A lesson reached under the wrong course redirects to its real one rather than
 * rendering, so there is a single canonical URL per lesson and progress cannot
 * be recorded against a course the lesson does not belong to. Unknown ids fall
 * back to the catalog, so a stale bookmark lands somewhere useful.
 */
export function LessonRoute() {
  const { courseId, lessonId } = useParams<{ courseId: string; lessonId: string }>();
  const openLesson = useTutorialStore((state) => state.openLesson);

  const lesson = lessonId ? lessonById(lessonId) : undefined;
  const owningCourseId = lesson ? courseIdForLesson(lesson.id) : undefined;
  const courseExists = courseId ? Boolean(courseById(courseId)) : false;
  const canOpen = Boolean(lesson && owningCourseId && owningCourseId === courseId);

  useEffect(() => {
    if (canOpen && lesson && courseId) openLesson(lesson.id, courseId);
  }, [canOpen, lesson, courseId, openLesson]);

  if (lesson && owningCourseId && owningCourseId !== courseId) {
    return <Navigate to={lessonPath(owningCourseId, lesson.id)} replace />;
  }
  if (!lesson) return <Navigate to={courseExists && courseId ? coursePath(courseId) : LEARN_PATH} replace />;

  return <WorkspaceRoute workspace="learn" slot="learn" />;
}
