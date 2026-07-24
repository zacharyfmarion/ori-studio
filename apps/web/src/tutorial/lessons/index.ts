/**
 * The lesson registry: chapters in teaching order, lessons within them.
 *
 * Content lives in per-chapter modules so a chapter can be written, reviewed,
 * and translated as one unit — the i18n gate requires all 8 locales for every
 * English string, so landing a chapter at a time is what keeps CI green.
 */
import type { Lesson, LessonChapter } from '../types';
import { BASICS_CHAPTER, BASICS_LESSONS } from './basics';
import { CONSTRUCT_CHAPTER, CONSTRUCT_LESSONS } from './construct';

export const LESSON_CHAPTERS: readonly LessonChapter[] = [BASICS_CHAPTER, CONSTRUCT_CHAPTER];

export const LESSONS: readonly Lesson[] = [...BASICS_LESSONS, ...CONSTRUCT_LESSONS];

const LESSON_BY_ID = new Map(LESSONS.map((lesson) => [lesson.id, lesson]));

export function lessonById(id: string): Lesson | undefined {
  return LESSON_BY_ID.get(id);
}

export function lessonsInChapter(chapterId: string): Lesson[] {
  return LESSONS.filter((lesson) => lesson.chapterId === chapterId);
}

/** The first lesson, used when the tutorial is opened with no progress. */
export function firstLesson(): Lesson | undefined {
  return LESSONS[0];
}

/** The lesson after this one in teaching order, or undefined at the end. */
export function nextLesson(id: string): Lesson | undefined {
  const index = LESSONS.findIndex((lesson) => lesson.id === id);
  return index >= 0 ? LESSONS[index + 1] : undefined;
}
