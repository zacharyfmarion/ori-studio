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
        kind: 'action',
        title: 'Necessary, not sufficient',
        loadsTargetId: 'not-flat-foldable',
        body: [
          'All three rules are local \u2014 each looks at one vertex at a time. A pattern can satisfy every one of them at every vertex and still be impossible to fold, because of how the layers would have to pass through each other across the sheet.',
          'This pattern is exactly that. The overlay is clean: no Maekawa violation, no Kawasaki violation, no big-little-big violation, nothing flagged anywhere. And it does not fold.',
          'Select everything with Cmd+A and press G. A folded form does appear \u2014 the solver gets that far \u2014 but look back at the crease pattern: two of its faces are now filled in red. That is the pair it could not put in order. One of them has to lie above the other and below it at the same time, and no assignment of mountains and valleys can settle it.',
        ],
        expect: 'folded-figure-exists',
        hint: 'Cmd+A, then G, then look at the crease pattern rather than the folded form. The red faces are the answer, not an error \u2014 they are the editor showing you where the pattern defeats itself.',
      },
      {
        id: 'watch-it-fail',
        kind: 'action',
        title: 'Watch it fail',
        body: [
          'The red faces name the two that disagree. Simulating the same pattern lets you watch the disagreement happen.',
          'Select everything again \u2014 folding clears the selection \u2014 and press Shift+S. Play it with Space, or walk it forward with the arrow keys, which is the better way to see this: keep your eye on the part of the sheet the red faces cover, and step until it has nowhere left to go.',
          'This is the honest limit of the checker. It can prove a vertex is broken; it cannot prove a pattern folds, only that nothing local is wrong with it. Folding and simulating are how you find out the rest.',
        ],
        expect: 'inline-simulation-exists',
        hint: 'Cmd+A, then Shift+S. If nothing opens, the selection is empty \u2014 the fold in the last step cleared it.',
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
        id: 'fold-it',
        kind: 'action',
        title: 'Fold it',
        body: [
          'On the canvas is the preliminary base, the pattern you repaired in the first chapter. Select the creases you want folded — Cmd+A takes everything — and then press G, or use the Fold button near the right-hand end of the bottom toolbar. The editor works out how the layers stack and draws the folded form beside your pattern.',
          'What comes back is a square half the width of the paper, four layers thick.',
          'This is the payoff of drawing accurately. The folded form is computed from your creases, so it is only ever as correct as they are — patterns placed by eye tend to fail here in ways that are hard to diagnose from the drawing alone.',
        ],
        expect: 'folded-figure-exists',
        hint: 'Press Cmd+A to select everything — folding needs to know which creases to fold — then press G.',
      },
      {
        id: 'simulate-it',
        kind: 'action',
        title: 'Watch it fold',
        body: [
          'The folded form is the destination. To watch the paper get there, keep everything selected and press Shift+S. A simulation window opens on the canvas and runs a physical model of the sheet, bending it along your creases.',
          'Space plays and pauses. The left and right arrow keys step the fold a little at a time, which is the useful way to see how a collapse actually happens; hold Shift with them to jump straight to flat or fully folded, and R rewinds to a flat sheet.',
          'Drag inside the window to turn the model over and look at it from underneath. The keys only reach the window you last clicked, so click one first if you open several.',
        ],
        expect: 'inline-simulation-exists',
        hint: 'Cmd+A, then Shift+S. The simulation needs a closed region to fold — if it says so, your selection did not enclose one.',
      },
      {
        id: 'where-next',
        kind: 'prose',
        title: 'Where to go next',
        body: [
          'You can now draw creases accurately, construct them from existing geometry, read the foldability checks, and both fold and simulate what you have made. That is the whole core loop of crease-pattern design.',
          'From here the Design workspace is worth exploring. Instead of drawing creases directly, you describe the shape you want as a tree of flaps and let the optimizer produce a pattern for you — a completely different way of working, and the patterns it generates are ones you now know how to read and edit.',
        ],
      },
    ],
  },
];
