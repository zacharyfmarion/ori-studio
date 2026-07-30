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
          'The default grid divides the paper into eighths. Many classic designs are built on divisions like this, and box-pleated designs in particular are drawn almost entirely on a grid. You can change the division from the View panel on the right.',
        ],
      },
      {
        id: 'move-around',
        kind: 'explore',
        title: 'Move around',
        body: [
          'Scroll to zoom. To pan, hold Cmd (Ctrl on Windows and Linux) and drag the canvas — or press 1 for the hand tool and drag normally.',
          'The same things are on the keyboard: Cmd + and Cmd − zoom in and out, Cmd 0 fits the whole paper back into view, and Cmd 1 returns to actual size. The percentage in the bottom-left corner tells you where you are, and the button beside it fits the view too.',
          'Try it now. You cannot damage anything, and Cmd 0 will always bring you home. When you are comfortable, move on.',
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
          'The line type buttons are at the top of the tool rail, under Type: M for mountain, V for valley, E for the paper edge. Make sure M is selected — the A key selects it — then drag with the segment tool from one corner of the paper to the opposite corner. Z is its key.',
          'You do not have to be precise. The editor snaps to the grid and to points that already exist, so releasing near a corner is enough — the crease will land exactly on it.',
        ],
        targetId: 'first-crease',
        teaches: 'cp.action.draw-crease',
        check: { mode: 'exact', allowSymmetry: true },
        hint: 'Press Z for the segment tool and A for mountain, then drag from one corner to the opposite corner. If the crease comes out blue, press C and click it to flip its type.',
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
    blurb: 'The three line types, and what they decide about folding.',
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
        id: 'auxiliary-lines',
        kind: 'prose',
        title: 'Auxiliary lines',
        body: [
          'There is a third type that is not a fold at all. Auxiliary lines — drawn in cyan — are construction guides: reference lines you use to place real creases and then ignore.',
          'They are ignored when the pattern is folded and when it is checked for flat-foldability, so you can leave as many as you like in a working file. Most designers use them heavily while working out a shape.',
          'All four types have a key: A for mountain, S for valley, D for the paper edge, F for auxiliary. They sit next to each other under your left hand, which is the point — you switch type far more often than you switch tool.',
        ],
      },
      {
        id: 'draw-both-diagonals',
        kind: 'draw',
        title: 'One of each',
        body: [
          'Draw both diagonals: one as a mountain, the other as a valley. Press A for mountain and S for valley to switch the active type before drawing each one, or use the M and V buttons at the top of the tool rail.',
          'Watch the check below as you go. If a crease lands in the right place with the wrong type, the lesson will say so specifically rather than just telling you it is wrong.',
        ],
        targetId: 'both-diagonals',
        teaches: 'cp.action.draw-crease',
        check: { mode: 'exact', allowSymmetry: true },
        hint: 'Press Z for the segment tool. Press A, draw one diagonal. Press S, draw the other. To fix a crease you have already drawn, press C and click it to flip its type.',
      },
      {
        id: 'notice-the-error',
        kind: 'prose',
        title: 'Look — it is already complaining',
        body: [
          'Your two creases cross in the middle of the paper, and the editor has flagged that crossing. Zoom in and you will find a marker sitting exactly on it.',
          'The reason is a piece of origami mathematics called Maekawa\'s theorem. At any point where creases meet inside a flat-foldable pattern, the number of mountains and the number of valleys must differ by exactly two. Four creases meet at your centre — the two halves of each diagonal — and they are two mountains and two valleys. A difference of zero, so the paper cannot lie flat there.',
          'This is not the editor being fussy. Take a real sheet, fold both diagonals the way you have drawn them, and the middle will fight you: something has to pop the wrong way.',
        ],
      },
      {
        id: 'fix-the-vertex',
        kind: 'action',
        title: 'Fix it with one flip',
        body: [
          'Change one of the two valley halves into a mountain. That gives you three mountains and one valley — a difference of two — and the vertex becomes foldable.',
          'Press C for the flip tool, then click one half of the valley diagonal. Only that half, not the whole line: the crossing split each diagonal into two creases when you drew the second one, which is exactly why the centre counts as four creases and not two.',
          'The warning clears the moment the count works out.',
        ],
        expect: 'camv-clean',
        hint: 'Press C, then click the valley diagonal on one side of the centre only. If you flip the wrong half, press C and click again to put it back.',
      },
      {
        id: 'fold-the-result',
        kind: 'action',
        title: 'Now fold it',
        body: [
          'The pattern is legal now, so it will fold. Select everything with Cmd+A, then press G.',
          'The two diagonals cut the square into four triangles, and what comes back is one of them: the four have collapsed onto each other into a single flat stack. That is what "flat-foldable" means in the most literal way — the finished thing has no thickness beyond its layers.',
        ],
        expect: 'folded-figure-exists',
        hint: 'Cmd+A selects everything, then G runs the fold estimate. The Fold button near the right-hand end of the bottom toolbar does the same thing.',
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
        id: 'starting-point',
        kind: 'prose',
        title: 'A pattern to edit',
        body: [
          'On the canvas is the preliminary base — one of the foundational shapes in origami, the starting point for the crane and a great many other traditional models — with one crease too many. Someone has added a second diagonal that does not belong.',
          'Drawing is only half of editing. Being quick at selecting, undoing, and deleting is what makes designing feel fluid rather than fussy.',
        ],
      },
      {
        id: 'delete-the-extra-crease',
        kind: 'draw',
        title: 'Remove the extra crease',
        body: [
          'Delete the diagonal running from the top-left corner to the bottom-right one.',
          'It is red on one half and blue on the other. The centre splits it into two separate creases, so both have to go.',
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
          'You should not need to aim carefully: the midpoints are grid intersections, so each drag will snap to them. This is the moment snapping earns its keep — switch it off in the View panel and try the same shape freehand, and the difference is obvious.',
        ],
        targetId: 'inscribed-square',
        teaches: 'cp.action.draw-crease',
        check: { mode: 'exact' },
        hint: 'Press S for valley and Z for the segment tool. Four creases around the middle: top-middle to right-middle, right-middle to bottom-middle, and so on.',
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
