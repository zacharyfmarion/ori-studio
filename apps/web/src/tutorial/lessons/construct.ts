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
          'With the perpendicular tool, pick the existing crease and then the point you want the new crease to pass through. Make it a valley, running from the middle of the existing crease up to the top edge of the paper.',
          'The result is exact: not "close to 90 degrees" but exactly 90, which is what a folding sequence will need.',
        ],
        targetId: 'perpendicular-done',
        teaches: 'cp.action.perpendicular-draw',
        check: { mode: 'exact' },
        hint: 'Select the horizontal crease, then the point where you want the perpendicular. Set the line type to V first. Drawing it by hand also counts if it lands in the same place.',
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
    id: 'dividing-lengths',
    chapterId: 'construct',
    title: 'Dividing a length',
    blurb: 'Splitting the paper into equal parts, exactly.',
    steps: [
      {
        id: 'why-divide',
        kind: 'prose',
        title: 'Equal parts are not obvious',
        body: [
          'Halves are easy — fold edge to edge. Thirds, fifths, and sevenths are not, and origami has a long tradition of clever folding sequences that produce them.',
          'In a crease pattern you can simply ask for them. The equal-division tool takes two references and produces evenly spaced creases between them, exactly.',
        ],
      },
      {
        id: 'draw-quarters',
        kind: 'draw',
        title: 'Quarter the paper',
        body: [
          'Divide the paper into four equal vertical columns: three valley creases, evenly spaced between the left and right edges.',
          'Quarters happen to fall on the grid, so you could place these by hand. Try the tool anyway — the same gesture gives you fifths or sevenths, where hand-placing is not an option.',
        ],
        targetId: 'quarters',
        teaches: 'cp.action.line-segment-division',
        check: { mode: 'exact' },
        hint: 'Pick the left and right edges of the paper as the two references, then ask for four divisions. Set the line type to V first.',
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
