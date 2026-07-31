import { describe, expect, it } from 'vitest';
import { LEARN_PATH, coursePath, isLessonPath, lessonPath, parseWorkspacePath } from './paths';
import { LESSON_COURSES, courseById } from '../tutorial/courses';
import { LESSONS, courseIdForLesson, lessonById } from '../tutorial/lessons';

/**
 * The `/learn` URL shape, and the one piece of it that is easy to get wrong:
 * only a *lesson* builds the editing workspace. The catalog and a course page
 * render full width with no canvas, so treating them as workspace routes would
 * provision a practice document nobody is about to draw on.
 *
 * Also guards the legacy two-segment form. `/learn/:lessonId` is what every link
 * written before courses existed says, and `CourseRoute` resolves it by trying
 * courses first and lessons second — which only works while those two id spaces
 * stay disjoint.
 */
describe('learn paths', () => {
  it('builds catalog, course and lesson paths', () => {
    expect(LEARN_PATH).toBe('/learn');
    expect(coursePath('basics')).toBe('/learn/basics');
    expect(lessonPath('basics', 'first-crease')).toBe('/learn/basics/first-crease');
  });

  it('treats only the three-segment form as a lesson', () => {
    expect(isLessonPath('/learn')).toBe(false);
    expect(isLessonPath('/learn/basics')).toBe(false);
    expect(isLessonPath('/learn/basics/')).toBe(false);
    expect(isLessonPath('/learn/basics/first-crease')).toBe(true);
    expect(isLessonPath('/edit')).toBe(false);
  });

  it('builds the learn workspace for a lesson but not for the catalog or a course', () => {
    expect(parseWorkspacePath('/learn')).toEqual({ workspace: 'learn' });
    expect(parseWorkspacePath('/learn/basics')).toBeNull();
    expect(parseWorkspacePath('/learn/basics/first-crease')).toEqual({ workspace: 'learn' });
  });

  /**
   * `CourseRoute` reads its second segment as a course, then falls back to
   * reading it as a lesson. An id that is both would resolve as the course and
   * silently strand the lesson.
   */
  it('keeps course ids and lesson ids disjoint', () => {
    for (const course of LESSON_COURSES) {
      expect(lessonById(course.id), `"${course.id}" is both a course and a lesson`).toBeUndefined();
    }
    for (const lesson of LESSONS) {
      expect(courseById(lesson.id), `"${lesson.id}" is both a lesson and a course`).toBeUndefined();
    }
  });

  it('can build a canonical path for every lesson', () => {
    for (const lesson of LESSONS) {
      const courseId = courseIdForLesson(lesson.id);
      expect(courseId, lesson.id).toBeDefined();
      expect(isLessonPath(lessonPath(courseId ?? '', lesson.id)), lesson.id).toBe(true);
    }
  });
});
