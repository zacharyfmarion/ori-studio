import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useTutorialStore } from '../store/tutorialStore';
import { courseById } from '../tutorial/courses';
import { courseIdForLesson, lessonById } from '../tutorial/lessons';
import { LEARN_PATH, lessonPath } from './paths';
import { WorkspaceRoute } from './WorkspaceRoute';

/**
 * `/learn/:courseOrLessonId` — a course's lesson list, or a redirect for an old
 * link.
 *
 * The course overview lives in the lesson pane, beside the editor, so choosing a
 * lesson does not change the layout around it. Only the catalog at `/learn` is a
 * page of its own. `LessonPanel` renders the overview when the store has a
 * course but no lesson, which is what `openCourse` establishes.
 *
 * The second segment used to be a lesson id, and links in the wild still say so.
 * Resolving against courses first and lessons second keeps one route rather than
 * two overlapping ones, and a lesson match redirects to its canonical
 * three-segment path — `replace`, so Back does not bounce off it.
 */
export function CourseRoute() {
  const { courseId } = useParams<{ courseId: string }>();
  const openCourse = useTutorialStore((state) => state.openCourse);

  const course = courseId ? courseById(courseId) : undefined;
  const legacyLesson = !course && courseId ? lessonById(courseId) : undefined;
  const legacyCourseId = legacyLesson ? courseIdForLesson(legacyLesson.id) : undefined;

  useEffect(() => {
    if (course) openCourse(course.id);
  }, [course, openCourse]);

  if (legacyLesson && legacyCourseId) {
    return <Navigate to={lessonPath(legacyCourseId, legacyLesson.id)} replace />;
  }
  if (!course) return <Navigate to={LEARN_PATH} replace />;

  return <WorkspaceRoute workspace="learn" slot="learn" />;
}
