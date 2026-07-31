/**
 * Chapter 2 — Constructing creases.
 *
 * Where chapter 1 draws creases by hand, this one builds them from geometry that
 * already exists on the paper. That distinction matters in origami: a fold you
 * can only place by eye is a fold you cannot reproduce, whereas one defined by a
 * perpendicular or a bisector is exact by construction.
 *
 * One screen per tool, on purpose. Each check tests the *result*, not the
 * method — a user who reaches the same geometry another way has still done the
 * exercise, and the tutorial should not pretend otherwise.
 */
import { BASICS_COURSE_ID } from '../courses';
import type { Lesson, LessonChapter } from '../types';

export const CONSTRUCT_CHAPTER: LessonChapter = {
  id: 'construct',
  title: 'Constructing creases',
  blurb: 'Building exact creases from the geometry already on the paper.',
  courseId: BASICS_COURSE_ID,
};

export const CONSTRUCT_LESSONS: readonly Lesson[] = [
  {
    id: 'perpendiculars',
    chapterId: 'construct',
    title: 'Perpendiculars',
    blurb: 'Drop an exact right angle onto an existing crease.',
    startTargetId: 'perpendicular-start',
    steps: [
      {
        id: 'draw-perpendicular',
        kind: 'draw',
        title: 'Drop a perpendicular',
        body: [
          'Snapping gets you onto the grid, but plenty of useful creases do not land on grid intersections. Those have to be computed from the geometry you already have — which is what the construction tools do, and why their results are exact rather than close.',
          'The perpendicular tool works from a point towards a line: click the point the new crease starts from, then the crease it should meet at a right angle. Make it a valley, from the middle of the bottom edge up to the existing crease.',
        ],
        targetId: 'perpendicular-done',
        teaches: 'cp.action.perpendicular-draw',
        check: { mode: 'exact' },
        hint: 'Press S for valley, then Y for the tool. Drawing it by hand counts too, if it lands in the same place.',
      },
    ],
  },
  {
    id: 'angle-bisectors',
    chapterId: 'construct',
    title: 'Angle bisectors',
    blurb: 'The single most useful construction in origami.',
    startTargetId: 'bisector-start',
    steps: [
      {
        id: 'draw-bisector',
        kind: 'draw',
        title: 'Bisect the right angle',
        body: [
          'Bisecting is the origami construction. Fold one edge of the paper onto another and the crease you make is exactly the bisector of the angle between them — so every bisector in a pattern is a fold a person can actually make, which is why designers reach for it constantly.',
          'Two mountains meet at the centre at a right angle. Pick them both with the bisector tool, then the edge to run to: a valley from the centre out to the corner.',
        ],
        targetId: 'bisector-done',
        teaches: 'cp.action.square-bisector',
        check: { mode: 'exact' },
        hint: 'Press S for valley, then B for the tool. The bisector of 90 degrees lands at 45 — the same diagonal you drew by hand, except this one is defined by the creases it bisects.',
      },
    ],
  },
  {
    id: 'parallel-lines',
    chapterId: 'construct',
    title: 'Parallel creases',
    blurb: 'Repeat an angle exactly, somewhere else on the paper.',
    startTargetId: 'parallel-start',
    steps: [
      {
        id: 'draw-parallel',
        kind: 'draw',
        title: 'Draw a parallel crease',
        body: [
          'Pleats are runs of parallel creases, and so are the rails that carry a flap down a model. They have to be exactly parallel, because anything else accumulates into a visible twist over the run — and matching an angle by eye is precisely what eyes are bad at.',
          'The tool takes three clicks, in order: the point the new crease passes through, the crease whose angle you are copying, and the crease or edge it runs to. Draw a valley parallel to the diagonal, through the middle of the left edge, down to the bottom edge.',
        ],
        targetId: 'parallel-done',
        teaches: 'cp.action.parallel-draw',
        check: { mode: 'exact' },
        hint: 'Set the line type to V first. The View panel shows the tool’s own steps as you go.',
      },
    ],
  },
  {
    id: 'mirroring',
    chapterId: 'construct',
    title: 'Mirroring and symmetry',
    blurb: 'Building one half and reflecting it.',
    startTargetId: 'mirror-start',
    steps: [
      {
        id: 'draw-mirror',
        kind: 'draw',
        title: 'Reflect across the centre',
        body: [
          'Almost every origami animal has a mirror line down the middle, so a common way to work is to design one half and reflect it: half the work, and the two sides are guaranteed to match.',
          'Mirror the two creases on the left across the vertical centre line. Some tools act on a selection, and this is one — select the creases first, then pick the tool. That is why it is not already active.',
        ],
        targetId: 'mirror-done',
        teaches: 'cp.action.draw-crease-symmetric',
        check: { mode: 'exact' },
        hint: 'Press Q and box-select both creases, then Cmd+M, then click the two ends of the vertical line through the middle. A reflected mountain is still a mountain.',
      },
    ],
  },
];
