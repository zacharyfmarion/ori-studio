/**
 * Chapter 3 — Foldability.
 *
 * The first two chapters are about drawing. This one is about the question that
 * separates a drawing from a crease pattern: will it actually fold?
 *
 * A note for whoever writes the next lesson here. The prose in this chapter was
 * written against what the editor's CAMV pass actually reports, which is
 * narrower than the textbook statement of the theorems: it evaluates vertices
 * that exist in the document's topology, so two creases that merely *cross*
 * without being divided at the crossing are not treated as meeting. Claims about
 * what the checker will flag should be verified against the running app rather
 * than reasoned from the theory.
 */
import { BASICS_COURSE_ID } from '../courses';
import { EDIT_PATH } from '../../routing/paths';
import type { Lesson, LessonChapter } from '../types';

export const FOLDABILITY_CHAPTER: LessonChapter = {
  id: 'foldability',
  title: 'Foldability',
  blurb: 'Whether your pattern can actually be folded — and seeing it folded.',
  courseId: BASICS_COURSE_ID,
};

export const FOLDABILITY_LESSONS: readonly Lesson[] = [
  {
    id: 'reading-diagnostics',
    chapterId: 'foldability',
    title: 'Reading the diagnostics',
    blurb: 'Maekawa, Kawasaki, and big-little-big — one example each.',
    steps: [
      {
        id: 'maekawa',
        kind: 'prose',
        title: 'Maekawa: count the folds',
        loadsTargetId: 'violation-maekawa',
        body: [
          'A pattern is flat-foldable if the paper can be collapsed along its creases and end up flat. The editor checks that continuously and marks the vertices that fail. There are three rules, one example each.',
          'Maekawa: at any vertex, the number of mountains and the number of valleys must differ by exactly two.',
          'Four creases meet in the middle here and all four are mountains — a difference of four. The angles are all 90 degrees, so nothing else is wrong with it.',
        ],
      },
      {
        id: 'kawasaki',
        kind: 'prose',
        title: 'Kawasaki: check the angles',
        loadsTargetId: 'violation-kawasaki',
        body: [
          'Kawasaki is about the gaps between creases rather than their directions. Going around a vertex, take every other angle: those must add to 180 degrees, and so must the ones you skipped.',
          'This vertex passes Maekawa — three mountains and a valley — but its angles are 90, 90, 121 and 59, which alternate to 211 and 149.',
        ],
      },
      {
        id: 'big-little-big',
        kind: 'action',
        title: 'Big-little-big',
        loadsTargetId: 'violation-big-little-big',
        body: [
          'Where a small angle sits between larger ones, the two creases around it must fold in opposite directions. If they match, the narrow flap between them has nowhere to go.',
          'Seven vertices along this diagonal break that. Fix them all at once with Make alternating M/V: press X, then drag a guide line down the diagonal from the bottom-right corner to the top-left.',
          'Direction matters — the tool alternates as it travels, so dragging the other way hands out the opposite assignment and leaves every vertex as broken as it was.',
        ],
        teaches: 'cp.action.crease-make-mv',
        expect: 'camv-clean',
        hint: 'If the warnings do not clear, you dragged the wrong way. Cmd+Z and drag the other direction.',
      },
      {
        id: 'necessary-not-sufficient',
        kind: 'action',
        title: 'Necessary, not sufficient',
        loadsTargetId: 'not-flat-foldable',
        body: [
          'All three rules are local — each looks at one vertex at a time. A pattern can pass every one of them at every vertex and still not fold, because of how the layers would have to pass through each other across the sheet.',
          'Nothing is flagged on this one. It still does not fold.',
          'Select everything with Cmd+A and press G. Ori Studio folds it anyway and shows you the result, then marks the faces that make it impossible — filled red on the crease pattern. One of them would have to sit both above and below the other.',
        ],
        expect: 'folded-figure-exists',
        hint: 'Cmd+A, then G. Look at the crease pattern, not the folded form: the red faces are the answer.',
      },
      {
        id: 'watch-it-fail',
        kind: 'action',
        title: 'Watch it fail',
        body: [
          'The red faces say which ones collide. Simulating shows it happening.',
          'Select everything again — folding clears the selection — and press Shift+S. Space plays it, but the arrow keys are better here: step forward and stop around 70 percent, where you can watch the paper pass straight through itself. Real paper cannot do that, which is exactly what the red faces were telling you.',
          'So a clean overlay is not a promise. The checker can prove a vertex is broken, never that a pattern folds.',
        ],
        expect: 'inline-simulation-exists',
        hint: 'Cmd+A, then Shift+S. If nothing opens, the selection is empty — folding cleared it.',
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
          'On the canvas is the preliminary base, the pattern you repaired in the first chapter. Press Cmd+A to select everything, then G.',
          'What comes back is a square half the width of the paper, four layers thick. It is computed from your creases, so it is only ever as correct as they are — which is why accuracy earlier pays off here.',
        ],
        expect: 'folded-figure-exists',
        hint: 'Folding needs to know which creases to fold, so the selection matters. The Fold button on the bottom toolbar does the same thing.',
      },
      {
        id: 'simulate-it',
        kind: 'action',
        title: 'Watch it fold',
        body: [
          'The folded form is the destination. To watch the paper get there, keep everything selected and press Shift+S — a simulation window opens on the canvas and runs a physical model of the sheet.',
          'Space plays and pauses. The arrow keys step the fold a little at a time; hold Shift to jump straight to flat or fully folded, and R rewinds. Drag inside the window to turn the model over.',
        ],
        expect: 'inline-simulation-exists',
        hint: 'Cmd+A, then Shift+S. The keys only reach the window you last clicked.',
      },
      {
        id: 'where-next',
        kind: 'prose',
        title: 'That should be enough to get started',
        body: [
          'You have the core loop: draw accurately, construct what you cannot place by eye, read the checks, fold and simulate. Everything else in the editor is a variation on it.',
          'The Edit workspace is where you do it for real — your own document, none of this scaffolding. The Design workspace is worth a look after that: instead of drawing creases, you describe the shape you want as a tree of flaps and let the optimizer produce a pattern, which you now know how to read and edit.',
        ],
        link: { label: 'Start drawing', to: EDIT_PATH },
      },
    ],
  },
];
