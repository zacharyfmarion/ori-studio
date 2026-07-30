import { beforeEach, describe, expect, it } from 'vitest';
import { LESSONS, nextLesson } from './index';
import { useTutorialStore } from '../../store/tutorialStore';
import { stepIsSelfAdvancing } from '../types';

/**
 * Walking the lessons the way a user does.
 *
 * The content tests check that lesson *data* is coherent; these check that a
 * lesson can actually be got through — every step reachable, every self-advancing
 * step gated, skip always a way forward, and the last step completing the lesson.
 *
 * Written after driving all eleven lessons in a browser found two things no data
 * test could: a step whose predicate could never be satisfied, and a target no
 * tool could produce.
 */
describe('walking a lesson', () => {
  beforeEach(() => {
    useTutorialStore.getState().resetProgress();
    useTutorialStore.getState().closeLesson();
  });

  it('opens every lesson at its first step', () => {
    for (const lesson of LESSONS) {
      useTutorialStore.getState().openLesson(lesson.id);
      const state = useTutorialStore.getState();
      expect(state.activeLessonId, lesson.id).toBe(lesson.id);
      expect(state.stepIndex, lesson.id).toBe(0);
    }
  });

  it('gates self-advancing steps and never gates prose', () => {
    for (const lesson of LESSONS) {
      useTutorialStore.getState().openLesson(lesson.id);
      for (let index = 0; index < lesson.steps.length; index += 1) {
        const step = lesson.steps[index];
        useTutorialStore.getState().goToStep(index);
        const { stepStatus } = useTutorialStore.getState();
        const where = `${lesson.id}/${step.id}`;
        if (stepIsSelfAdvancing(step)) {
          expect(stepStatus, `${where} should start gated`).toBe('pending');
        } else {
          expect(stepStatus, `${where} should never gate`).toBe('not-applicable');
        }
      }
    }
  });

  it('lets skip move forward from every step, and finish the lesson from the last', () => {
    for (const lesson of LESSONS) {
      useTutorialStore.getState().openLesson(lesson.id);
      for (let index = 0; index < lesson.steps.length - 1; index += 1) {
        useTutorialStore.getState().goToStep(index);
        useTutorialStore.getState().skipStep();
        expect(useTutorialStore.getState().stepIndex, `${lesson.id} skip from ${index}`).toBe(
          index + 1
        );
      }
      useTutorialStore.getState().goToStep(lesson.steps.length - 1);
      useTutorialStore.getState().skipStep();
      expect(
        useTutorialStore.getState().completedLessonIds,
        `${lesson.id} should complete from its last step`
      ).toContain(lesson.id);
    }
  });

  it('clamps step navigation instead of running off either end', () => {
    const lesson = LESSONS[0];
    useTutorialStore.getState().openLesson(lesson.id);
    useTutorialStore.getState().previousStep();
    expect(useTutorialStore.getState().stepIndex).toBe(0);
    useTutorialStore.getState().goToStep(999);
    expect(useTutorialStore.getState().stepIndex).toBe(lesson.steps.length - 1);
    useTutorialStore.getState().goToStep(-5);
    expect(useTutorialStore.getState().stepIndex).toBe(0);
  });

  it('ignores an unknown lesson id rather than half-opening one', () => {
    useTutorialStore.getState().openLesson(LESSONS[0].id);
    useTutorialStore.getState().openLesson('does-not-exist');
    expect(useTutorialStore.getState().activeLessonId).toBe(LESSONS[0].id);
  });

  it('records completion once, and remembers where the user was', () => {
    const lesson = LESSONS[0];
    useTutorialStore.getState().openLesson(lesson.id);
    useTutorialStore.getState().markLessonComplete(lesson.id);
    useTutorialStore.getState().markLessonComplete(lesson.id);
    const state = useTutorialStore.getState();
    expect(state.completedLessonIds.filter((id) => id === lesson.id)).toHaveLength(1);
    expect(state.lastLessonId).toBe(lesson.id);
  });

  it('walks the lessons in order and stops at the end', () => {
    expect(nextLesson(LESSONS[0].id)?.id).toBe(LESSONS[1].id);
    expect(nextLesson(LESSONS[LESSONS.length - 1].id)).toBeUndefined();
  });

  it('reseeds the practice canvas only when the lesson changes', () => {
    const [first, second] = LESSONS;
    useTutorialStore.getState().openLesson(first.id);
    useTutorialStore.getState().markPracticeDocumentFor(first.id);
    expect(useTutorialStore.getState().practiceLessonId).toBe(first.id);
    // Re-opening the same lesson must not look like a different document, or
    // returning to a lesson would wipe work in progress.
    useTutorialStore.getState().openLesson(first.id);
    expect(useTutorialStore.getState().practiceLessonId).toBe(first.id);
    useTutorialStore.getState().markPracticeDocumentFor(second.id);
    expect(useTutorialStore.getState().practiceLessonId).toBe(second.id);
  });
});
