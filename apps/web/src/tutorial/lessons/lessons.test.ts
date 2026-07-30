import { describe, expect, it } from 'vitest';
import { LESSON_CHAPTERS, LESSONS, lessonById, nextLesson } from './index';
import { LESSON_TARGETS, lessonTarget } from '../targets';
import { stepIsSelfAdvancing } from '../types';
import { cpActionById } from '../../lib/oristudioCpActions';

/**
 * Content integrity. These are the checks that stop a broken lesson from
 * reaching a user: a target that doesn't exist, a step that can never be
 * satisfied, a duplicate id that makes progress ambiguous.
 *
 * They run against the data, not the UI, so they stay fast and keep failing for
 * the right reason.
 */
describe('lesson content', () => {
  it('has at least one chapter and one lesson', () => {
    expect(LESSON_CHAPTERS.length).toBeGreaterThan(0);
    expect(LESSONS.length).toBeGreaterThan(0);
  });

  it('gives every lesson a unique id', () => {
    const ids = LESSONS.map((lesson) => lesson.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every step a unique id within its lesson', () => {
    for (const lesson of LESSONS) {
      const ids = lesson.steps.map((step) => step.id);
      expect(new Set(ids).size, `duplicate step id in ${lesson.id}`).toBe(ids.length);
    }
  });

  it('puts every lesson in a chapter that exists', () => {
    const chapterIds = new Set(LESSON_CHAPTERS.map((chapter) => chapter.id));
    for (const lesson of LESSONS) {
      expect(chapterIds.has(lesson.chapterId), `${lesson.id} → ${lesson.chapterId}`).toBe(true);
    }
  });

  it('gives every lesson at least one step', () => {
    for (const lesson of LESSONS) {
      expect(lesson.steps.length, lesson.id).toBeGreaterThan(0);
    }
  });

  it('writes body text for every step', () => {
    for (const lesson of LESSONS) {
      for (const step of lesson.steps) {
        expect(step.body.length, `${lesson.id}/${step.id}`).toBeGreaterThan(0);
        for (const paragraph of step.body) {
          expect(paragraph.trim().length, `${lesson.id}/${step.id}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('references only targets that exist', () => {
    for (const lesson of LESSONS) {
      if (lesson.startTargetId) {
        expect(lessonTarget(lesson.startTargetId), `${lesson.id} start`).toBeDefined();
      }
      for (const step of lesson.steps) {
        if (step.kind !== 'draw') continue;
        expect(lessonTarget(step.targetId), `${lesson.id}/${step.id}`).toBeDefined();
      }
    }
  });

  /**
   * `OristudioCpActionId` is a template-literal type (`cp.action.${string}`), so
   * *any* string typechecks. A mistyped tool id would compile happily and then
   * silently fail to arm anything — every id in the first draft of chapter 2 was
   * wrong in exactly that way. This is the only thing that catches it.
   */
  it('names tools that actually exist', () => {
    for (const lesson of LESSONS) {
      for (const step of lesson.steps) {
        if (step.kind !== 'draw' || !step.teaches) continue;
        expect(cpActionById(step.teaches), `${lesson.id}/${step.id}: ${step.teaches}`).toBeDefined();
      }
    }
  });

  it('gives every self-advancing step a way to be satisfied', () => {
    for (const lesson of LESSONS) {
      for (const step of lesson.steps) {
        if (!stepIsSelfAdvancing(step)) continue;
        if (step.kind === 'draw') {
          expect(step.check.mode, `${lesson.id}/${step.id}`).toBeTruthy();
        } else if (step.kind === 'action') {
          expect(step.expect, `${lesson.id}/${step.id}`).toBeTruthy();
        }
      }
    }
  });

  it('resolves lessons by id and walks them in order', () => {
    const first = LESSONS[0];
    expect(lessonById(first.id)).toBe(first);
    expect(lessonById('does-not-exist')).toBeUndefined();
    expect(nextLesson(LESSONS[LESSONS.length - 1].id)).toBeUndefined();
  });
});

describe('lesson targets', () => {
  it('gives every target a unique id', () => {
    const ids = LESSON_TARGETS.map((target) => target.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * A target no lesson reaches is dead content: it still has to be reviewed and
   * kept correct, and nothing tells you it stopped mattering. Two of these
   * accumulated when lessons were rewritten, so the rule is now enforced.
   */
  it('is reached by a lesson', () => {
    const referenced = new Set<string>();
    for (const lesson of LESSONS) {
      if (lesson.startTargetId) referenced.add(lesson.startTargetId);
      for (const step of lesson.steps) {
        if (step.kind === 'draw') referenced.add(step.targetId);
      }
    }
    // The blank sheet is the fallback for lessons with no starting pattern, so
    // it is referenced from the panel rather than from lesson data.
    referenced.add('blank-sheet');
    const orphans = LESSON_TARGETS.map((t) => t.id).filter((id) => !referenced.has(id));
    expect(orphans).toEqual([]);
  });

  it('parses as .cp text with at least one segment', () => {
    for (const target of LESSON_TARGETS) {
      const lines = target.cp
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      expect(lines.length, target.id).toBeGreaterThan(0);
      for (const line of lines) {
        const parts = line.split(/\s+/);
        expect(parts, `${target.id}: "${line}"`).toHaveLength(5);
        // Type 1 edge, 2 valley, 3 mountain, 4 auxiliary.
        expect([1, 2, 3, 4], `${target.id}: "${line}"`).toContain(Number(parts[0]));
        for (const coordinate of parts.slice(1)) {
          expect(Number.isFinite(Number(coordinate)), `${target.id}: "${line}"`).toBe(true);
        }
      }
    }
  });
});
