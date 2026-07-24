/**
 * Chapter 1 — Basics.
 *
 * English is the source of truth here; `src/i18n/tutorialVocab.ts` generates the
 * translatable catalog from this data. Prose is deliberately explanatory: the
 * chapter teaches what a crease pattern *is*, not only which button to press.
 */
import type { Lesson, LessonChapter } from '../types';

export const BASICS_CHAPTER: LessonChapter = {
  id: 'basics',
  title: 'Basics',
  blurb: 'The paper, the grid, and your first creases.',
};

export const BASICS_LESSONS: readonly Lesson[] = [
  {
    id: 'first-crease',
    chapterId: 'basics',
    title: 'Your first crease',
    blurb: 'Draw a single mountain fold across the diagonal.',
    steps: [
      {
        id: 'what-is-a-cp',
        kind: 'prose',
        title: 'What a crease pattern is',
        body: [
          'A crease pattern is a flat drawing of every fold in a finished model. Instead of the step-by-step diagrams you might know from a folding book, it shows the end state: where every crease lands once the paper is flat again.',
          'That makes it a design tool rather than a set of instructions. Origami designers work out the crease pattern first and only then figure out how to collapse it — which is why a crease pattern can look nothing like the model it produces.',
          'The square on the right is your sheet of paper, seen from above. Everything you draw on it is a fold.',
        ],
      },
      {
        id: 'mountains-and-valleys',
        kind: 'prose',
        title: 'Mountains and valleys',
        body: [
          'Every crease folds one of two ways. A mountain fold points the crease up toward you, like the ridge of a roof. A valley fold points it away, like a gutter. Flip the paper over and every mountain becomes a valley — the distinction is always relative to the side you are looking at.',
          'Ori Studio draws mountains in red and valleys in blue, the convention used in most published crease patterns. The black outline is the edge of the paper, which is not a fold at all.',
        ],
      },
      {
        id: 'draw-the-diagonal',
        kind: 'draw',
        title: 'Draw the diagonal',
        body: [
          'Pick the mountain line type, then use the segment tool to draw a single crease from one corner of the paper to the opposite corner.',
          'You do not have to be precise. The editor snaps to the grid and to points that already exist, so clicking near a corner is enough — the crease will land exactly on it.',
        ],
        targetId: 'first-crease',
        teaches: 'cp.action.draw-crease',
        check: { mode: 'exact', allowSymmetry: true },
        hint: 'Click one corner, then the opposite corner. If a crease ends up the wrong colour, use the mountain line type before drawing, or select the crease and change its type.',
      },
      {
        id: 'why-it-matters',
        kind: 'prose',
        title: 'One crease is already a model',
        body: [
          'You have just designed the simplest possible crease pattern. Folded, it produces a triangle — a square folded in half along its diagonal.',
          'Everything more complicated is the same idea repeated: creases that meet at points, forming a pattern that can collapse flat. The rest of this chapter is about drawing them accurately and quickly.',
        ],
      },
    ],
  },
];
