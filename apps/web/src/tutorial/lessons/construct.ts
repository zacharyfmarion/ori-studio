/**
 * Chapter 2 — Constructing creases.
 *
 * Where chapter 1 draws creases by hand, this one builds them from geometry that
 * already exists on the paper. That distinction matters in origami: a fold you
 * can only place by eye is a fold you cannot reproduce, whereas one defined by a
 * perpendicular or a bisector is exact by construction — and exactness is what
 * makes a pattern fold flat.
 *
 * Each check tests the *result*, not the method. A lesson names the tool it is
 * teaching and arms it, but a user who reaches the same geometry another way has
 * still done the exercise, and the tutorial should not pretend otherwise.
 */
import type { Lesson, LessonChapter } from '../types';

export const CONSTRUCT_CHAPTER: LessonChapter = {
  id: 'construct',
  title: 'Constructing creases',
  blurb: 'Building exact creases from the geometry already on the paper.',
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
        id: 'why-construct',
        kind: 'prose',
        title: 'Why construct rather than draw',
        body: [
          'Snapping gets you onto the grid, but plenty of useful creases do not land on grid intersections. A perpendicular dropped onto a crease that runs at an odd angle has to be computed, not guessed.',
          'That is what the construction tools are for. Each one takes creases or points you already have and produces a new crease that is exactly related to them — perpendicular, bisecting, parallel, reflected.',
          'The canvas has one mountain crease running across it. You are going to add a crease at an exact right angle to it.',
        ],
      },
      {
        id: 'draw-perpendicular',
        kind: 'draw',
        title: 'Drop a perpendicular',
        body: [
          'The perpendicular tool works from a point towards a line: first click the point the new crease should start from, then click the crease it should meet at a right angle. Make it a valley, starting at the middle of the paper\u2019s bottom edge and running up to meet the existing crease.',
          'The result is exact: not "close to 90 degrees" but exactly 90, which is what a folding sequence will need.',
        ],
        targetId: 'perpendicular-done',
        teaches: 'cp.action.perpendicular-draw',
        check: { mode: 'exact' },
        hint: 'Set the line type to V first. Click the middle of the bottom edge, then click the horizontal crease — the new crease is drawn between them at a right angle. Drawing it by hand also counts if it lands in the same place.',
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
        id: 'why-bisectors',
        kind: 'prose',
        title: 'Why bisectors matter so much',
        body: [
          'Bisecting an angle is the origami construction. When you fold one edge of the paper onto another, the crease you create is exactly the bisector of the angle between them — so any bisector in a crease pattern corresponds to a fold a person can actually make.',
          'That is why patterns are full of them, and why designers reach for the bisector tool constantly. Angles that cannot be reached by bisecting are angles that are awkward to fold.',
          'Two mountain creases meet at the centre of the paper at a right angle. Bisect them.',
        ],
      },
      {
        id: 'draw-bisector',
        kind: 'draw',
        title: 'Bisect the right angle',
        body: [
          'Use the angle bisector tool: pick the two creases, and the new crease appears exactly between them. Make it a valley, running from the centre out to the corner of the paper.',
          'Because the angle here is 90 degrees, the bisector lands at 45 — the same diagonal you drew by hand in the first chapter. The difference is that this one is defined by the creases it bisects, so it stays correct even if they were at some awkward angle instead.',
        ],
        targetId: 'bisector-done',
        teaches: 'cp.action.square-bisector',
        check: { mode: 'exact' },
        hint: 'Select the two creases meeting at the centre, then the crease or edge you want the bisector to run to. Set the line type to V first.',
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
        id: 'why-parallel',
        kind: 'prose',
        title: 'Repeating an angle',
        body: [
          'Pleats — the accordion folds that make up a great deal of modern origami — are runs of parallel creases. So are the rails that carry a flap down the length of a model. In both cases the creases must be exactly parallel, because anything else accumulates into a visible twist over the run.',
          'Matching an angle by eye is precisely the thing eyes are bad at. The parallel tool copies it exactly instead.',
          'The canvas has a single mountain crease along the diagonal.',
        ],
      },
      {
        id: 'draw-parallel',
        kind: 'draw',
        title: 'Draw a parallel crease',
        body: [
          'The tool takes three clicks, in this order: the point the new crease should pass through, the crease whose angle you are copying, and the crease or edge it should run to.',
          'Draw a valley crease parallel to the diagonal, passing through the middle of the left edge and running down to the bottom edge.',
        ],
        targetId: 'parallel-done',
        teaches: 'cp.action.parallel-draw',
        check: { mode: 'exact' },
        hint: 'Set the line type to V first. Click the middle of the left edge, then the diagonal, then the bottom edge. The View panel on the right shows the tool’s own steps as you go.',
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
        id: 'why-symmetry',
        kind: 'prose',
        title: 'Most models are symmetric',
        body: [
          'Look at almost any origami animal and you will find a mirror line down the middle: two wings, two front legs, two antennae. The crease pattern is symmetric because the subject is.',
          'So a very common way to work is to design one half carefully and reflect it, which halves the work and guarantees the two sides actually match — something that is surprisingly hard to achieve by drawing both by hand.',
          'The canvas has a pair of creases on the left half of the paper.',
        ],
      },
      {
        id: 'draw-mirror',
        kind: 'draw',
        title: 'Reflect across the centre',
        body: [
          'Mirror the two existing creases across the vertical centre line of the paper, so the pattern becomes symmetric. Select what you want to reflect, then use the reflect tool with the centre line as the axis.',
          'Keep the reflected creases as mountains, matching their originals. A reflection flips the geometry but not the fold direction — a mountain reflected is still a mountain.',
        ],
        targetId: 'mirror-done',
        teaches: 'cp.action.draw-crease-symmetric',
        check: { mode: 'exact' },
        hint: 'Box-select the two creases first, then reflect them over the vertical line through the middle of the paper.',
      },
    ],
  },
];
