/**
 * Chapter 3 — Foldability.
 *
 * The first two chapters are about drawing. This one is about the question that
 * separates a drawing from a crease pattern: will it actually fold?
 *
 * A note for whoever writes the next lesson here. The prose in this chapter was
 * rewritten after checking what the editor's CAMV pass actually reports, which
 * is narrower than the textbook statement of the theorems: it evaluates vertices
 * that exist in the document's topology, so two creases that merely *cross*
 * without being divided at the crossing are not treated as meeting. Claims about
 * what the checker will flag should be verified against the running app rather
 * than reasoned from the theory.
 */
import type { Lesson, LessonChapter } from '../types';

export const FOLDABILITY_CHAPTER: LessonChapter = {
  id: 'foldability',
  title: 'Foldability',
  blurb: 'Whether your pattern can actually be folded — and seeing it folded.',
};

export const FOLDABILITY_LESSONS: readonly Lesson[] = [
  {
    id: 'reading-diagnostics',
    chapterId: 'foldability',
    title: 'Reading the diagnostics',
    blurb: 'What the foldability checker is telling you.',
    startTargetId: 'maekawa-broken',
    steps: [
      {
        id: 'flat-foldability',
        kind: 'prose',
        title: 'Flat-foldability',
        body: [
          'A pattern is flat-foldable if the paper can be collapsed along its creases and end up flat, with no part of it forced to bend or tear. Most classic origami bases are flat-foldable, and it is the property most crease-pattern design is built around.',
          'Two theorems govern it at each vertex where creases meet. Maekawa\'s says the numbers of mountain and valley folds must differ by exactly two. Kawasaki\'s says the alternating angles around the vertex must each sum to 180 degrees. Neither is a convention — both are forced by the geometry of flat paper.',
          'Ori Studio checks these continuously as you draw, and marks the vertices that fail.',
        ],
      },
      {
        id: 'the-overlay',
        kind: 'prose',
        title: 'Where the problems are',
        body: [
          'Violations are drawn on the canvas rather than listed in a panel, because their location is the useful part — knowing which vertex is wrong matters far more than knowing that something is.',
          'On the canvas now, four creases run through the middle of the paper. Two of them are flagged where they meet the edge: a crease that runs into the paper\'s boundary partway along creates a vertex whose fold counts cannot balance. Something has to give there, and the checker is saying so.',
          'The overlay can be switched off while drawing — the toggle is in the View panel on the right, under CAMV issues. It is worth leaving on, though: catching a foldability mistake as you make it is much easier than finding it in a finished pattern.',
        ],
      },
      {
        id: 'clear-the-violations',
        kind: 'action',
        title: 'Clear the violations',
        body: [
          'Remove the two creases that run into the edges of the paper — the horizontal and the vertical — and leave the two diagonals, which run corner to corner and are fine.',
          'The check below clears as soon as the pattern is clean. Watch the overlay disappear as you delete each one.',
        ],
        expect: 'camv-clean',
        hint: 'Box-select the horizontal crease and press Delete, then the vertical one. The eraser tool works too. The diagonals should stay.',
      },
      {
        id: 'necessary-not-sufficient',
        kind: 'prose',
        title: 'Necessary, not sufficient',
        body: [
          'Passing these checks does not guarantee a pattern folds. Maekawa and Kawasaki are local conditions — they look at one vertex at a time — and a pattern can satisfy them everywhere and still be impossible, because of how the layers would have to pass through one another globally.',
          'That is why the editor also folds patterns outright, which is what the next lesson does.',
        ],
      },
    ],
  },
  {
    id: 'folding-your-pattern',
    chapterId: 'foldability',
    title: 'Folding your pattern',
    blurb: 'Turn a crease pattern into the shape it makes.',
    startTargetId: 'preliminary-base',
    steps: [
      {
        id: 'a-real-base',
        kind: 'prose',
        title: 'A real base',
        body: [
          'On the canvas is the preliminary base: both diagonals as mountains, both midlines as valleys. It is one of the foundational shapes in origami — the starting point for the crane, the lily, and a great many other traditional models.',
          'Folded, the square collapses down into a smaller square of four layers, with four free corners at one end. Almost every classic model you can name begins from this or its close relative, the waterbomb base.',
          'You will notice the foldability checker flagging the four points where the midlines meet the edge of the paper — the same warning you cleared in the last lesson. That is worth sitting with: this is a base that has been folded by hand for centuries, and the checker still objects. The rules it applies are local and strict, and a real pattern is often drawn in a way that trips them without being wrong. Treat the overlay as something to understand, not something to obey.',
        ],
      },
      {
        id: 'fold-it',
        kind: 'action',
        title: 'Fold it',
        body: [
          'Select the creases you want folded — dragging a selection box around the whole pattern is easiest — and then press G, or use the Fold button near the right-hand end of the bottom toolbar. The editor works out how the layers stack and draws the resulting folded form beside your pattern.',
          'Because of those flagged vertices you will be asked whether to continue; say yes. Then look at the result: a smaller square, four layers thick.',
          'This is the payoff of drawing accurately. The folded form is computed from your creases, so it is only ever as correct as they are — patterns placed by eye tend to fail here in ways that are hard to diagnose from the drawing alone.',
        ],
        expect: 'folded-figure-exists',
        hint: 'Drag a selection box around the whole pattern first — folding needs to know which creases to fold. Then press G, or use the Fold button near the right-hand end of the bottom toolbar.',
      },
      {
        id: 'where-next',
        kind: 'prose',
        title: 'Where to go next',
        body: [
          'You can now draw creases accurately, construct them from existing geometry, read the foldability checks, and fold what you have made. That is the whole core loop of crease-pattern design.',
          'From here the Design workspace is worth exploring. Instead of drawing creases directly, you describe the shape you want as a tree of flaps and let the optimizer produce a pattern for you — a completely different way of working, and the patterns it generates are ones you now know how to read and edit.',
        ],
      },
    ],
  },
];
