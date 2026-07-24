/**
 * Chapter 1 — Basics.
 *
 * English is the source of truth here; `src/i18n/tutorialVocab.ts` generates the
 * translatable catalog from this data. Prose is deliberately explanatory: the
 * chapter teaches what a crease pattern *is* and how origami designers think
 * about one, not only which button to press.
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
          'A crease pattern is a flat drawing of every fold in a finished model. Instead of the step-by-step diagrams you might know from a folding book, it shows the end state: where every crease lands once the paper is unfolded again.',
          'That makes it a design tool rather than a set of instructions. Origami designers usually work out the crease pattern first and only then figure out how to collapse it — which is why a crease pattern often looks nothing like the model it produces.',
          'The square on the right is your sheet of paper, seen from above. Everything you draw on it is a fold.',
        ],
      },
      {
        id: 'the-grid',
        kind: 'prose',
        title: 'The grid',
        body: [
          'Behind the paper is a grid. It is not part of the design — nothing in the grid gets folded — but it is what makes accurate drawing possible, because the editor snaps your creases to its intersections.',
          'The default grid divides the paper into eighths. Many classic designs are built on divisions like this, and box-pleated designs in particular are drawn almost entirely on a grid. You can change the division later from the View panel.',
        ],
      },
      {
        id: 'move-around',
        kind: 'explore',
        title: 'Move around',
        body: [
          'Scroll to zoom, and drag with the middle mouse button — or hold space and drag — to pan. The percentage in the bottom-left corner tells you the current zoom, and the button beside it fits the paper back into view.',
          'Try it now. You cannot damage anything, and the fit button will always bring you home. When you are comfortable, move on.',
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
          'Every crease folds one of two ways. A mountain fold points the crease up toward you, like the ridge of a roof. A valley fold points it away, like a gutter. Flip the paper over and every mountain becomes a valley — the distinction is always relative to the side you are looking at.',
          'Ori Studio draws mountains in red and valleys in blue, the convention used in most published crease patterns. The black outline is the edge of the paper, which is not a fold at all.',
        ],
      },
      {
        id: 'draw-the-diagonal',
        kind: 'draw',
        title: 'Draw the diagonal',
        body: [
          'The line type buttons sit along the bottom of the canvas: M for mountain, V for valley, E for the paper edge. Make sure M is selected, then drag with the segment tool from one corner of the paper to the opposite corner.',
          'You do not have to be precise. The editor snaps to the grid and to points that already exist, so releasing near a corner is enough — the crease will land exactly on it.',
        ],
        targetId: 'first-crease',
        teaches: 'cp.action.draw-crease',
        check: { mode: 'exact', allowSymmetry: true },
        hint: 'Drag from one corner to the opposite corner. If the crease comes out blue, click M at the bottom of the canvas and draw it again — or select the crease and change its type.',
      },
      {
        id: 'why-it-matters',
        kind: 'prose',
        title: 'One crease is already a model',
        body: [
          'You have just designed the simplest possible crease pattern. Folded, it produces a triangle: a square folded in half along its diagonal.',
          'Everything more complicated is the same idea repeated — creases that meet at points, forming a pattern that can collapse flat. The rest of this chapter is about drawing them accurately and quickly.',
        ],
      },
    ],
  },
  {
    id: 'line-types',
    chapterId: 'basics',
    title: 'Mountain, valley, auxiliary',
    blurb: 'The three line types you will use constantly.',
    steps: [
      {
        id: 'why-types-matter',
        kind: 'prose',
        title: 'Why the type matters',
        body: [
          'A crease pattern is not just a set of lines — it is a set of lines with directions. Change one mountain to a valley and the model may refuse to fold flat at all.',
          'That is why the editor treats the type as part of the crease rather than as a colour you paint on afterwards. When you fold a pattern later, it is the mountain and valley assignments that decide what comes out.',
        ],
      },
      {
        id: 'draw-both-diagonals',
        kind: 'draw',
        title: 'One of each',
        body: [
          'Draw both diagonals: one as a mountain, the other as a valley. Switch the active type with the M and V buttons under the canvas before drawing each one.',
          'Watch the check below as you go. If a crease lands in the right place with the wrong type, the lesson will say so specifically rather than just telling you it is wrong.',
        ],
        targetId: 'both-diagonals',
        teaches: 'cp.action.draw-crease',
        check: { mode: 'exact', allowSymmetry: true },
        hint: 'Click M, draw one diagonal. Click V, draw the other. To fix a crease you have already drawn, select it and use Flip Mountain/Valley.',
      },
      {
        id: 'auxiliary-lines',
        kind: 'prose',
        title: 'Auxiliary lines',
        body: [
          'There is a third type that is not a fold at all. Auxiliary lines — drawn in cyan — are construction guides: reference lines you use to place real creases and then ignore.',
          'They are ignored when the pattern is folded and when it is checked for flat-foldability, so you can leave as many as you like in a working file. Most designers use them heavily while working out a shape.',
        ],
      },
    ],
  },
  {
    id: 'select-and-delete',
    chapterId: 'basics',
    title: 'Select, undo, delete',
    blurb: 'Fixing what you have already drawn.',
    startTargetId: 'four-creases',
    steps: [
      {
        id: 'starting-point',
        kind: 'prose',
        title: 'A pattern to edit',
        body: [
          'The canvas already has four creases on it: both diagonals, and the horizontal and vertical lines through the middle. This is the start of a very common base, but for now it is just something to practise on.',
          'Drawing is only half of editing. Being quick at selecting, undoing, and deleting is what makes designing feel fluid rather than fussy.',
        ],
      },
      {
        id: 'delete-the-midlines',
        kind: 'draw',
        title: 'Remove the midlines',
        body: [
          'Delete the horizontal and vertical creases, leaving only the two diagonals. Either drag a selection box around a crease and press Delete, or pick the eraser tool and click directly on it.',
          'If you remove the wrong one, undo with Cmd+Z — the tutorial watches the result, not how you got there, so there is no penalty for changing your mind.',
        ],
        targetId: 'diagonals-after-delete',
        check: { mode: 'exact' },
        hint: 'The eraser is in the Delete group on the left. Box-select also works: drag a box that touches only the crease you want, then press Delete.',
      },
      {
        id: 'undo-is-cheap',
        kind: 'prose',
        title: 'Undo is cheap',
        body: [
          'Every edit is undoable, including deletions, and the history survives switching workspaces. Designing a crease pattern is mostly an iterative process — draw something, look at it, take half of it back — so it is worth getting comfortable with undoing freely.',
        ],
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
        id: 'what-snapping-does',
        kind: 'prose',
        title: 'What snapping does',
        body: [
          'Accuracy matters more in crease patterns than in most drawings. Creases that nearly meet at a point are not the same as creases that do meet, and a model that is a fraction of a degree out will not fold flat.',
          'Snapping solves this. As you drag, the editor pulls the endpoint to the nearest grid intersection, existing vertex, or crease — so a crease that looks like it lands on a point really does land on it, exactly.',
        ],
      },
      {
        id: 'draw-inscribed-square',
        kind: 'draw',
        title: 'A square inside the square',
        body: [
          'Draw a valley-folded square joining the midpoints of the four edges of the paper. Each corner of your new square sits halfway along one edge of the old one.',
          'You should not need to aim carefully: the midpoints are grid intersections, so each drag will snap to them. This is the moment snapping earns its keep — try drawing the same shape with snapping turned off in the View panel and the difference is obvious.',
        ],
        targetId: 'inscribed-square',
        teaches: 'cp.action.draw-crease',
        check: { mode: 'exact' },
        hint: 'Four creases, corner to corner around the middle: top-middle to right-middle, right-middle to bottom-middle, and so on. Make sure V is the active line type.',
      },
      {
        id: 'end-of-chapter',
        kind: 'prose',
        title: 'That is the foundation',
        body: [
          'You can now draw creases of a chosen type, fix them, and place them accurately. That is genuinely most of what crease-pattern editing is.',
          'The next chapter covers the rest of the drawing tools — the ones that construct creases from geometry rather than from where you dragged, which is how precise designs are actually built.',
        ],
      },
    ],
  },
];
