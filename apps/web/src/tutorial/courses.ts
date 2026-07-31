/**
 * The course registry: the top level of the tutorial, in catalog order.
 *
 * A course is the unit a user chooses between — not a later chapter of one long
 * story. Everything written so far is one arc, "The Basics"; box pleating and
 * designing from a tree are separate things someone picks up when they want
 * them, and will be separate courses.
 *
 * Content still lives in `lessons/<chapter>.ts`. When a second course lands,
 * move to `courses/<course-id>/<chapter>.ts` — doing it now would be a large
 * diff proving nothing.
 */
import type { LessonCourse } from './types';

export const BASICS_COURSE_ID = 'basics';

export const LESSON_COURSES: readonly LessonCourse[] = [
  {
    id: BASICS_COURSE_ID,
    title: 'The Basics',
    blurb:
      'Draw creases accurately, construct the ones you cannot place by eye, read the foldability checks, and fold what you have made.',
  },
];

const COURSE_BY_ID = new Map(LESSON_COURSES.map((course) => [course.id, course]));

export function courseById(id: string): LessonCourse | undefined {
  return COURSE_BY_ID.get(id);
}
