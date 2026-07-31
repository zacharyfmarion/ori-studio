import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useTutorialStore } from '../store/tutorialStore';
import { courseById } from '../tutorial/courses';
import { courseIdForLesson, lessonById } from '../tutorial/lessons';
import { CoursePanel } from '../components/panels/CoursePanel';
import { LEARN_PATH, lessonPath } from './paths';

/**
 * `/learn/:courseOrLessonId` — a course page, or a redirect for an old link.
 *
 * The second segment used to be a lesson id, and links in the wild (bookmarks,
 * anything written before courses existed) still say so. Resolving against
 * courses first and lessons second keeps one route rather than two overlapping
 * ones, and a lesson match redirects to its canonical three-segment path.
 *
 * The redirect replaces rather than pushes, so Back does not bounce off it.
 */
export function CourseRoute() {
  const { courseId } = useParams<{ courseId: string }>();
  const closeLesson = useTutorialStore((state) => state.closeLesson);

  const course = courseId ? courseById(courseId) : undefined;
  const legacyLesson = !course && courseId ? lessonById(courseId) : undefined;
  const legacyCourseId = legacyLesson ? courseIdForLesson(legacyLesson.id) : undefined;

  // Leaving the lesson is what makes a later visit to this course page show the
  // course rather than resuming whatever pane state the last lesson left behind.
  useEffect(() => {
    if (course) closeLesson();
  }, [course, closeLesson]);

  if (legacyLesson && legacyCourseId) {
    return <Navigate to={lessonPath(legacyCourseId, legacyLesson.id)} replace />;
  }
  if (!course) return <Navigate to={LEARN_PATH} replace />;

  return <CoursePanel course={course} />;
}
