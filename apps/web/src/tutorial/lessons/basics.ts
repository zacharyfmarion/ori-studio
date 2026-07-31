/**
 * Chapter 1 — Basics.
 *
 * English is the source of truth here; `src/i18n/tutorialVocab.ts` generates the
 * translatable catalog from this data.
 *
 * These lessons are a quick start, not a manual. A screen earns its place by
 * getting the reader to do something, or by explaining a thing they are about to
 * see on the canvas. Background that does neither belongs in docs instead.
 */
import type { Lesson, LessonChapter } from '../types';

export const BASICS_CHAPTER: LessonChapter = {
  id: 'basics',
  title: 'Basics',
  blurb: 'The paper, the grid, and your first creases.',
};

export const BASICS_LESSONS: readonly Lesson[] = [
  {
    id: 'the-canvas',
    chapterId: 'basics',
    title: 'The paper and the canvas',
    blurb: 'What you are looking at, and how to move around it.',
    steps: [
      {
        id: 'what-is-a-cp',
        kind: 'prose',
        title: 'What a crease pattern is',
        body: [
          'A crease pattern shows every fold in a finished model at once, on the unfolded sheet. Designers work it out first and figure out how to collapse it afterwards, which is why one often looks nothing like the model it makes.',
          'The square on the right is your paper, and everything you draw on it is a fold. Behind it is a grid — not part of the design, but what your creases snap to, so you can draw accurately without measuring. It divides the paper into eighths. You can change or hide the grid in the View panel on the right.',
        ],
      },
      {
        id: 'move-around',
        kind: 'explore',
        title: 'Move around',
        body: [
          'The Edit workspace is an infinite canvas with your paper sitting in the middle of it. You move the view around rather than the paper, so nothing you do here changes the design.',
          'Scroll to zoom. Hold Cmd (Ctrl on Windows and Linux) and drag to pan, or press 1 for the hand tool.',
          'Cmd + and Cmd − zoom, Cmd 0 fits the paper back in view, Cmd 1 returns to actual size. Try it — Cmd 0 will always bring you home.',
        ],
      },
    ],
  },
  {
    id: 'first-crease',
    chapterId: 'basics',
    title: 'Your first crease',
    blurb: 'Draw a single mountain fold across the diagonal.',
    steps: [
      {
        id: 'mountains-and-valleys',
        kind: 'prose',
        title: 'Mountains and valleys',
        body: [
          'Every crease folds one of two ways. A mountain points up toward you like the ridge of a roof; a valley points away like a gutter. Turn the paper over and each becomes the other — the distinction is always relative to the side you are looking at.',
          'Ori Studio draws mountains red and valleys blue, the usual convention. The outline is the edge of the paper, not a fold.',
        ],
      },
      {
        id: 'draw-the-diagonal',
        kind: 'draw',
        title: 'Draw the diagonal',
        body: [
          'The tool rail down the left holds every drawing tool. The one you want is the segment tool, which draws a straight crease between two points, and the buttons above it under Type set what kind of crease that will be.',
          'Press A for mountain and Z for the segment tool, then drag from one corner to the opposite one.',
          'You do not have to be precise. Releasing near a corner is enough — snapping puts the crease exactly on it.',
        ],
        targetId: 'first-crease',
        teaches: 'cp.action.draw-crease',
        check: { mode: 'exact', allowSymmetry: true },
        hint: 'If the crease comes out blue, press C and click it to flip its type.',
      },
    ],
  },
  {
    id: 'line-types',
    chapterId: 'basics',
    title: 'Mountain, valley, auxiliary',
    blurb: 'The three line types, and what they decide about folding.',
    steps: [
      {
        id: 'why-types-matter',
        kind: 'prose',
        title: 'Why the type matters',
        body: [
          'A crease pattern is lines with directions. Change one mountain to a valley and the model may refuse to fold flat at all, which is why the type is part of the crease rather than a colour painted on afterwards.',
          'There is a third type that is not a fold: auxiliary lines, in cyan, are construction guides. They are ignored when the pattern is folded and when it is checked, so leave as many in a working file as you like.',
          'All four have a key, sitting together under your left hand: A mountain, S valley, D paper edge, F auxiliary.',
        ],
      },
      {
        id: 'draw-both-diagonals',
        kind: 'draw',
        title: 'One of each',
        body: [
          'The active type applies to the next crease you draw, so you switch between strokes rather than fixing things afterwards.',
          'Draw both diagonals — one mountain, one valley. Press A and draw one, then S and draw the other.',
        ],
        targetId: 'both-diagonals',
        teaches: 'cp.action.draw-crease',
        check: { mode: 'exact', allowSymmetry: true },
        hint: 'Press Z for the segment tool. To fix a crease you already drew, press C and click it.',
      },
      {
        id: 'fix-the-vertex',
        kind: 'action',
        title: 'Now it complains',
        body: [
          'Your creases cross in the middle and the editor has flagged it. Four creases meet there — drawing the second diagonal split each one in two — and they are two mountains and two valleys.',
          'Maekawa’s theorem says those counts must differ by exactly two at any vertex. A difference of zero cannot lie flat. This is not the editor being fussy: fold both diagonals this way on real paper and the middle will fight you.',
          'Press C and click one half of the valley diagonal to make it a mountain. Three to one, and the warning clears.',
        ],
        teaches: 'cp.action.crease-toggle-mv',
        expect: 'camv-clean',
        hint: 'One side of the centre only. If you flip the wrong half, press C and click it again.',
      },
      {
        id: 'fold-the-result',
        kind: 'action',
        title: 'Now fold it',
        body: [
          'It is legal now, so it will fold. Press Cmd+A, then G.',
          'The diagonals cut the square into four triangles, and what comes back is one of them — the four collapsed onto each other into a flat stack. That is what flat-foldable means, literally.',
        ],
        expect: 'folded-figure-exists',
        hint: 'The Fold button near the right-hand end of the bottom toolbar does the same thing.',
      },
    ],
  },
  {
    id: 'select-and-delete',
    chapterId: 'basics',
    title: 'Select, undo, delete',
    blurb: 'Fixing what you have already drawn.',
    startTargetId: 'preliminary-base-extra-crease',
    steps: [
      {
        id: 'delete-the-extra-crease',
        kind: 'draw',
        title: 'Remove the extra crease',
        body: [
          'On the canvas is the preliminary base — the starting point for the crane and much else — with one crease too many. Delete the diagonal running from the top-left corner to the bottom-right one.',
          'It is red on one half and blue on the other: the centre splits it into two creases, so both have to go.',
        ],
        bullets: [
          'Right-click and drag a box over a crease — anything it touches is erased. Take the halves one at a time and stay clear of the centre, or you will take the whole pattern with them.',
          'Or press Q, drag a selection box, and press Delete.',
          'Cmd+Z undoes anything you did not mean.',
        ],
        targetId: 'preliminary-base',
        check: { mode: 'exact' },
        hint: 'One small box over the top-left half, another over the bottom-right half.',
      },
    ],
  },
  {
    id: 'snapping-and-grid',
    chapterId: 'basics',
    title: 'Snapping and the grid',
    blurb: 'Drawing accurately without measuring anything.',
    steps: [
      {
        id: 'draw-inscribed-square',
        kind: 'draw',
        title: 'A square inside the square',
        body: [
          'Creases that nearly meet at a point are not the same as creases that do, and a model a fraction of a degree out will not fold flat. Snapping is what saves you: as you drag, the endpoint is pulled to the nearest grid intersection, vertex, or crease.',
          'Draw a valley square joining the midpoints of the four edges. You should not need to aim — the midpoints are grid intersections.',
        ],
        targetId: 'inscribed-square',
        teaches: 'cp.action.draw-crease',
        check: { mode: 'exact' },
        hint: 'Press S for valley and Z for the segment tool. Four creases: top-middle to right-middle, right-middle to bottom-middle, and so on.',
      },
    ],
  },
];
