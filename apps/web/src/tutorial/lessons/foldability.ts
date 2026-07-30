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
    blurb: 'Maekawa, Kawasaki, and big-little-big \u2014 one example each.',
    steps: [
      {
        id: 'maekawa',
        kind: 'prose',
        title: 'Maekawa: count the folds',
        loadsTargetId: 'violation-maekawa',
        body: [
          'A pattern is flat-foldable if the paper can be collapsed along its creases and end up flat. The editor checks that continuously and marks the vertices that fail; there are three rules it applies, and this lesson shows one example of each.',
          'Maekawa\u2019s theorem: at any vertex, the number of mountains and the number of valleys must differ by exactly two.',
          'Four creases meet in the middle here and all four are mountains \u2014 a difference of four. The angles are all 90 degrees, so nothing else is wrong with it. Fold this by hand and the middle simply will not lie down.',
        ],
      },
      {
        id: 'kawasaki',
        kind: 'prose',
        title: 'Kawasaki: check the angles',
        loadsTargetId: 'violation-kawasaki',
        body: [
          'Kawasaki\u2019s theorem is about the gaps between creases rather than their directions. Going around a vertex, take every other angle: those must add up to 180 degrees, and so must the ones you skipped.',
          'This vertex passes Maekawa \u2014 three mountains and a valley. But its angles are 90, 90, 121 and 59, which alternate to 211 and 149 instead of 180 and 180.',
        ],
      },
      {
        id: 'big-little-big',
        kind: 'action',
        title: 'Big-little-big',
        loadsTargetId: 'violation-big-little-big',
        body: [
          'The big-little-big theorem is the third rule. Where a small angle sits between larger ones, the two creases on either side of it have to fold in opposite directions \u2014 one mountain, one valley. If they match, the narrow flap between them has nowhere to go.',
          'Seven vertices along this diagonal break it: at each one the small angles are bounded by two creases of the same type. Fix all seven at once with Make alternating M/V, which assigns alternating mountains and valleys along a guide line you draw.',
          'Press X, then drag a guide line down the diagonal \u2014 from the bottom-right corner to the top-left one. Direction matters: the tool alternates as it travels, so dragging the other way hands out the opposite assignment and leaves every vertex exactly as broken as it was.',
        ],
        expect: 'camv-clean',
        hint: 'Press X and drag from the bottom-right corner to the top-left. If the warnings do not clear, you dragged the wrong way \u2014 undo with Cmd+Z and drag the other direction.',
      },
      {
        id: 'necessary-not-sufficient',
        kind: 'prose',
        title: 'Necessary, not sufficient',
        body: [
          'All three rules are local \u2014 they look at one vertex at a time. A pattern can satisfy every one of them everywhere and still be impossible, because of how the layers would have to pass through each other globally.',
          'So a clean overlay means no vertex is individually broken, not that the model folds. The way to find that out is to fold it, which is what the next lesson does.',
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
          'Select the creases you want folded — Cmd+A takes everything — and then press G, or use the Fold button near the right-hand end of the bottom toolbar. The editor works out how the layers stack and draws the resulting folded form beside your pattern.',
          'Because of those flagged vertices you will be asked whether to continue; say yes. Then look at the result: a smaller square, four layers thick.',
          'This is the payoff of drawing accurately. The folded form is computed from your creases, so it is only ever as correct as they are — patterns placed by eye tend to fail here in ways that are hard to diagnose from the drawing alone.',
        ],
        expect: 'folded-figure-exists',
        hint: 'Press Cmd+A to select everything — folding needs to know which creases to fold — then press G.',
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
