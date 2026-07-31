import { describe, expect, it } from 'vitest';
import { LEARN_PATH, coursePath, lessonPath, parseWorkspacePath } from './paths';
import { LESSON_COURSES, courseById } from '../tutorial/courses';
import { LESSONS, courseIdForLesson, lessonById } from '../tutorial/lessons';

/**
 * The `/learn` URL shape: a catalog, a course, and a lesson, all of them the
 * tutorial workspace.
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

  /**
   * All three `/learn` shapes are the tutorial workspace. They differ in what
   * the lesson pane shows, not in which workspace is active — and the rail
   * highlights the active one, so a course page reporting "no workspace" would
   * leave the Learn tab unlit while you are standing on it.
   */
  it('reports the learn workspace for the catalog, a course and a lesson', () => {
    expect(parseWorkspacePath('/learn')).toEqual({ workspace: 'learn' });
    expect(parseWorkspacePath('/learn/basics')).toEqual({ workspace: 'learn' });
    expect(parseWorkspacePath('/learn/basics/first-crease')).toEqual({ workspace: 'learn' });
    expect(parseWorkspacePath('/edit')).toEqual({ workspace: 'edit' });
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

  /**
   * `startWorkspaceUrlSync` skips when the current path already resolves to the
   * workspace being activated. That guard is what keeps a deep-linked lesson or
   * course from being replaced by `/learn`.
   */
  it('resolves deep tutorial links to the workspace, so the url sync leaves them alone', () => {
    expect(parseWorkspacePath('/learn/basics/mirroring')?.workspace).toBe('learn');
    expect(parseWorkspacePath('/learn/basics')?.workspace).toBe('learn');
  });

  it('can build a canonical path for every lesson', () => {
    for (const lesson of LESSONS) {
      const courseId = courseIdForLesson(lesson.id);
      expect(courseId, lesson.id).toBeDefined();
      expect(parseWorkspacePath(lessonPath(courseId ?? '', lesson.id))?.workspace, lesson.id).toBe(
        'learn'
      );
    }
  });
});
