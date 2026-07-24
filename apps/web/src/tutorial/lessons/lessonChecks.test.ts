import { describe, expect, it } from 'vitest';
import { LESSONS } from './index';
import { lessonTarget } from '../targets';
import { compareCreasePatterns } from '../check/compare';
import type { OristudioCpLineSegment, OristudioCpModel } from '../../engine/oristudioCpTypes';

/**
 * The content guard that matters most: a lesson's own target must satisfy the
 * lesson's own check. A step whose target cannot pass its check is unfinishable,
 * and no amount of UI testing would surface it — the user would simply be stuck.
 *
 * The `.cp` text is parsed here rather than through the engine so these stay fast
 * and dependency-free. That is safe because this is a *test-only* reader used to
 * cross-check content, never a second production parser: the app still loads
 * every target through the kernel.
 */

/** Kernel colour by `.cp` line type. Mirrors `io/cp.rs`. */
const COLOR_BY_TYPE: Record<number, string> = {
  1: 'Black0', // paper edge
  2: 'Blue2', // valley
  3: 'Red1', // mountain
  4: 'Cyan3', // auxiliary
};

function parseCpForTest(text: string): OristudioCpModel {
  const lineSegments: OristudioCpLineSegment[] = [];
  const auxSegments: OristudioCpLineSegment[] = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const [type, ax, ay, bx, by] = line.split(/\s+/).map(Number);
    const segment: OristudioCpLineSegment = {
      a: { x: ax, y: ay },
      b: { x: bx, y: by },
      active: 'Unselected',
      color: COLOR_BY_TYPE[type] ?? 'None',
      selected: 0,
      customized: 0,
      customized_color: { red: 0, green: 0, blue: 0 },
    };
    // The kernel keeps auxiliary lines in their own collection.
    if (type === 4) auxSegments.push(segment);
    else lineSegments.push(segment);
  }

  return {
    line_segments: lineSegments,
    circles: [],
    points: [],
    aux_line_segments: auxSegments,
    texts: [],
    grid: {} as OristudioCpModel['grid'],
  };
}

function modelForTarget(targetId: string): OristudioCpModel {
  const target = lessonTarget(targetId);
  if (!target) throw new Error(`Unknown target: ${targetId}`);
  return parseCpForTest(target.cp);
}

const drawSteps = LESSONS.flatMap((lesson) =>
  lesson.steps
    .filter((step) => step.kind === 'draw')
    .map((step) => ({ lesson, step: step as Extract<typeof step, { kind: 'draw' }> }))
);

describe('lesson checks are satisfiable', () => {
  it.each(drawSteps.map(({ lesson, step }) => [`${lesson.id}/${step.id}`, lesson, step] as const))(
    '%s — the target satisfies its own check',
    (_name, _lesson, step) => {
      const target = modelForTarget(step.targetId);
      const result = compareCreasePatterns(target, target, step.check);
      expect(result.satisfied).toBe(true);
      expect(result.expected).toBeGreaterThan(0);
    }
  );

  it.each(
    drawSteps
      .filter(({ lesson }) => lesson.startTargetId)
      .map(({ lesson, step }) => [`${lesson.id}/${step.id}`, lesson, step] as const)
  )('%s — the starting pattern does not already satisfy it', (_name, lesson, step) => {
    const start = modelForTarget(lesson.startTargetId as string);
    const result = compareCreasePatterns(start, modelForTarget(step.targetId), step.check);
    // Otherwise the step is a no-op that completes before the user does anything.
    expect(result.satisfied).toBe(false);
  });

  it('expects a plausible number of creases per step', () => {
    for (const { lesson, step } of drawSteps) {
      const target = modelForTarget(step.targetId);
      const result = compareCreasePatterns(target, target, step.check);
      // A step asking for dozens of creases at once is a content smell, not a
      // hard error — but a chapter-1 step asking for 20 is a mistake.
      expect(result.expected, `${lesson.id}/${step.id}`).toBeLessThanOrEqual(12);
    }
  });
});
