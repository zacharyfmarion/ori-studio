/**
 * The lesson registry: chapters in teaching order, lessons within them.
 *
 * Content lives in per-chapter modules so a chapter can be written and reviewed
 * as one unit. Chapters name their course (`LessonChapter.courseId`), so course
 * membership is stated once and derived here rather than listed twice.
 *
 * Ordering functions are **course-scoped on purpose**: the last lesson of a
 * course must end that course, not run on into the first lesson of the next one.
 */
import type { Lesson, LessonChapter } from '../types';
import { BASICS_CHAPTER, BASICS_LESSONS } from './basics';
import { CONSTRUCT_CHAPTER, CONSTRUCT_LESSONS } from './construct';
import { FOLDABILITY_CHAPTER, FOLDABILITY_LESSONS } from './foldability';

export const LESSON_CHAPTERS: readonly LessonChapter[] = [BASICS_CHAPTER, CONSTRUCT_CHAPTER, FOLDABILITY_CHAPTER];

export const LESSONS: readonly Lesson[] = [...BASICS_LESSONS, ...CONSTRUCT_LESSONS, ...FOLDABILITY_LESSONS];

const LESSON_BY_ID = new Map(LESSONS.map((lesson) => [lesson.id, lesson]));
const CHAPTER_BY_ID = new Map(LESSON_CHAPTERS.map((chapter) => [chapter.id, chapter]));

export function lessonById(id: string): Lesson | undefined {
  return LESSON_BY_ID.get(id);
}

export function chapterById(id: string): LessonChapter | undefined {
  return CHAPTER_BY_ID.get(id);
}

export function lessonsInChapter(chapterId: string): Lesson[] {
  return LESSONS.filter((lesson) => lesson.chapterId === chapterId);
}

/** Chapters belonging to a course, in teaching order. */
export function chaptersInCourse(courseId: string): LessonChapter[] {
  return LESSON_CHAPTERS.filter((chapter) => chapter.courseId === courseId);
}

/** The course a lesson belongs to, via its chapter. */
export function courseIdForLesson(lessonId: string): string | undefined {
  const lesson = lessonById(lessonId);
  return lesson ? chapterById(lesson.chapterId)?.courseId : undefined;
}

/**
 * Lessons in a course, in teaching order.
 *
 * Built from the course's chapters rather than by filtering `LESSONS`, so the
 * order follows chapter order even if the content modules are concatenated in a
 * different sequence.
 */
export function lessonsInCourse(courseId: string): Lesson[] {
  return chaptersInCourse(courseId).flatMap((chapter) => lessonsInChapter(chapter.id));
}

/** The first lesson of a course, used when it is opened with no progress. */
export function firstLessonInCourse(courseId: string): Lesson | undefined {
  return lessonsInCourse(courseId)[0];
}

/**
 * The lesson after this one *within its own course*, or undefined at the end of
 * it. Returning undefined is what makes "Finish lesson" land on the course page
 * rather than silently starting a different course.
 */
export function nextLesson(id: string): Lesson | undefined {
  const courseId = courseIdForLesson(id);
  if (!courseId) return undefined;
  const ordered = lessonsInCourse(courseId);
  const index = ordered.findIndex((lesson) => lesson.id === id);
  return index >= 0 ? ordered[index + 1] : undefined;
}

/**
 * How far through a course the user is.
 *
 * Derived by intersecting the course's lessons with what is completed, never by
 * counting the stored list — a renamed or deleted lesson leaves a stale id
 * behind, and counting it would render nonsense like `12 / 11`.
 */
export function courseProgress(
  courseId: string,
  completedLessonIds: readonly string[]
): { completed: number; total: number } {
  const completed = new Set(completedLessonIds);
  const lessons = lessonsInCourse(courseId);
  return {
    completed: lessons.filter((lesson) => completed.has(lesson.id)).length,
    total: lessons.length,
  };
}
