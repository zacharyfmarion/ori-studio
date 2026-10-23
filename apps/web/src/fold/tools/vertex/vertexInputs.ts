/**
 * The clicks each vertex fold takes from the canvas (plan Phase 11, D13), in
 * the registry's vocabulary (`foldToolRegistry`): one `createStepSequenceTool`
 * step per click, each snapped by its {@link FoldStepSnap}.
 *
 * - **Squash**: the flap, a point anywhere on it (`free`: a landmark would sit
 *   on a crease, where no one layer is the flap's). Where its spine lands is
 *   drawn afterwards, by a click on the folded pane (`useFoldCanvasVerbs`).
 *   About a drawn hinge ({@link FoldSquashHinge}), the line is located first
 *   with the line modes and taken, as a swivel's valley is; the click then
 *   names the flap's end on one side of it.
 * - **Petal fold**: its hinge, as {@link FoldVertexLines.petalHinge} names it
 *   — the precrease across the flap, or its two ends (`point` landmarks, or
 *   with Alt any point), which the fold creases itself — then the flap below
 *   it (`free`): a region the canvas lights as the pointer crosses it, the
 *   part that lifts (`useFoldPetalMarks`).
 * - **Rabbit ear**: the triangle's three corners (`point` landmarks, or with
 *   Alt any point), then the region containing the hinge crease (`free`).
 * - **Swivel**, by its edge (`FoldSwivelEdgeOp`): where its creases meet — a
 *   point on a folded edge, near one and away from any landmark, for the
 *   classic swivel whose creases meet on that edge (`resolveFoldEdgePoint`,
 *   `FoldSwivelOnFoldOp`), or a pivot (`point`, Alt for any point) — the
 *   edge to swing — a raw or folded edge, never a flat crease, which the
 *   engine refuses; only one that can swing from there is offered
 *   (`swivelReach`) — and the line it lands on, as
 *   {@link FoldVertexLines.swivelTarget} names it: a crease or an edge it
 *   lands on, or two points. By its valley and mountain, it takes no clicks
 *   of its own: each line is located with the line modes, as a valley fold's
 *   is (`foldToolRegistry`). A swivel stored by its rays still replays; the
 *   tool no longer makes one.
 *
 * Which layer a flap click names is not decided by the click: it depends on
 * the direction (`vertexStep`), which the folder may change afterwards, so the
 * pick keeps where it was clicked.
 *
 * React-free and store-free; literal `t()` keys so the extractor sees them.
 */
import type { TFunction } from 'i18next';
import type { FoldLineBy, FoldVertexToolId } from '../foldToolCatalog';
import type { FoldInputModel, FoldLocateStep } from '../foldToolRegistry';

const FREE: FoldLocateStep = { snap: 'free', slot: null, edges: false };
const POINT: FoldLocateStep = { snap: 'point', slot: null, edges: true };
/** A petal fold's hinge as a crease already there: a precrease, the only kind the fold refolds as its hinge. */
const HINGE: FoldLocateStep = { snap: 'crease-required', slot: null, edges: false, kinds: ['crease'] };
/** A swivel's edge: the paper's raw edge or a folded edge. A flat crease is no edge. */
const EDGE: FoldLocateStep = { snap: 'crease-required', slot: null, edges: true, kinds: ['raw_edge', 'bend'] };
/** The line a swivel lays its edge on: any crease or edge. */
const LINE: FoldLocateStep = { snap: 'crease-required', slot: null, edges: true };

/**
 * How a swivel is constructed, as the window's Construct by control switches
 * it: by the edge that swings onto a line (the clicks below), or by its
 * valley and mountain on the layer that faces the viewer, each located with
 * the line modes, the valley first (`FoldSwivelValleyMountainOp`).
 */
export type FoldSwivelInput = 'edge' | 'valley-mountain';

/**
 * A squash's hinge, as the window's Hinge control switches it: the folded
 * edge the flap's lower layer turns over, which the engine infers, or a line
 * located with the line modes and taken first, only the flap's end beyond it
 * squashing (`FoldSquashOp`'s `hinge`).
 */
export type FoldSquashHinge = 'folded' | 'line';

export interface FoldVertexLines {
  swivelInput?: FoldSwivelInput;
  petalHinge: FoldLineBy;
  swivelTarget: FoldLineBy;
  squashHinge?: FoldSquashHinge;
  /** The line a construction takes first is taken (`FoldToolState.takenLine`). */
  lineTaken?: boolean;
}

/** Whether a construction locates a line with the line modes now: a swivel by its valley and mountain, or a squash's drawn hinge before it is taken. */
export function locatesWithLineModes(tool: FoldVertexToolId, lines: Partial<FoldVertexLines>): boolean {
  return (
    (tool === 'swivel' && lines.swivelInput === 'valley-mountain') ||
    (tool === 'squash' && lines.squashHinge === 'line' && lines.lineTaken !== true)
  );
}

export const FOLD_VERTEX_LINES_DEFAULT: FoldVertexLines = { petalHinge: 'crease', swivelTarget: 'crease' };

/** One model per tool and way of naming its line, made once: a model's identity is what a click counter is kept for. */
const SQUASH: FoldInputModel = { steps: [FREE] };
const PETAL: Readonly<Record<FoldLineBy, FoldInputModel>> = {
  crease: { steps: [HINGE, FREE] },
  points: { steps: [POINT, POINT, FREE] },
};
const RABBIT_EAR: FoldInputModel = { steps: [POINT, POINT, POINT, FREE] };
const SWIVEL: Readonly<Record<FoldLineBy, FoldInputModel>> = {
  crease: { steps: [POINT, EDGE, LINE] },
  points: { steps: [POINT, EDGE, POINT, POINT] },
};

/** The clicks a vertex fold collects. */
export function vertexToolInput(tool: FoldVertexToolId, lines: FoldVertexLines = FOLD_VERTEX_LINES_DEFAULT): FoldInputModel {
  switch (tool) {
    case 'squash':
      return SQUASH;
    case 'petal':
      return PETAL[lines.petalHinge];
    case 'rabbit-ear':
      return RABBIT_EAR;
    case 'swivel':
      return SWIVEL[lines.swivelTarget];
  }
}

/** How many clicks name a line by `lineBy`: one crease, or two points. */
export function lineByClicks(lineBy: FoldLineBy): number {
  return lineBy === 'crease' ? 1 : 2;
}

/** The clicks before a swivel's target: its pivot and its edge. */
export const SWIVEL_TARGET_FROM = 2;

/** What a vertex fold's clicks are asked on: a finger has no key to hold for a free point. */
export interface FoldVertexStepsHost {
  coarse: boolean;
  /** The platform's name for Alt. */
  alt: string;
}

/** A petal fold's hinge clicks, then the flap below it: the part that lifts, lit as the pointer crosses it. */
function petalSteps(t: TFunction, hinge: FoldLineBy, coarse: boolean): string[] {
  const ends =
    hinge === 'crease'
      ? [
          coarse
            ? t('tools:fold.vertex.steps.petalHingeTouch', 'Tap the hinge: a precrease across the flap.')
            : t('tools:fold.vertex.steps.petalHinge', 'Click the hinge: a precrease across the flap.'),
        ]
      : coarse
        ? [
            t('tools:fold.vertex.steps.petalHingeFirstEndTouch', 'Tap one end of the hinge, where a kite crease meets the flap’s edge.'),
            t('tools:fold.vertex.steps.petalHingeSecondEndTouch', 'Tap its other end, where the other kite crease meets the edge.'),
          ]
        : [
            t('tools:fold.vertex.steps.petalHingeFirstEnd', 'Click one end of the hinge, where a kite crease meets the flap’s edge.'),
            t('tools:fold.vertex.steps.petalHingeSecondEnd', 'Click its other end, where the other kite crease meets the edge.'),
          ];
  return [
    ...ends,
    coarse
      ? t('tools:fold.vertex.steps.petalFlapTouch', 'Tap the flap that lifts, below the hinge.')
      : t('tools:fold.vertex.steps.petalFlap', 'Click the flap that lifts, below the hinge.'),
  ];
}

/**
 * A swivel's clicks, each naming what the folder sees by its part in the
 * fold (owner feedback, 2026-10-12: "the edge that moves" named nothing — a
 * bunch of edges move): where the creases meet, the edge to swing, the line
 * it lands on. The canvas lights what each click can take. From a point
 * nothing can swing from, the second click says so and takes another point
 * (`nothingSwings`).
 */
function swivelSteps(t: TFunction, target: FoldLineBy, host: FoldVertexStepsHost, nothingSwings: boolean): string[] {
  const { coarse } = host;
  const onto =
    target === 'crease'
      ? [
          coarse
            ? t('tools:fold.vertex.steps.swivelLandsTouch', 'Tap the line it lands on.')
            : t('tools:fold.vertex.steps.swivelLands', 'Click the line it lands on.'),
        ]
      : coarse
        ? [
            t('tools:fold.vertex.steps.swivelLandsFirstTouch', 'Tap a point on the line it lands on.'),
            t('tools:fold.vertex.steps.swivelOntoSecondTouch', 'Tap a second point on that line.'),
          ]
        : [
            t('tools:fold.vertex.steps.swivelLandsFirst', 'Click a point on the line it lands on.'),
            t('tools:fold.vertex.steps.swivelOntoSecond', 'Click a second point on that line.'),
          ];
  const swing = nothingSwings
    ? coarse
      ? t('tools:fold.vertex.steps.swivelNothingSwingsTouch', 'Nothing can swing from there: tap another point.')
      : t('tools:fold.vertex.steps.swivelNothingSwings', 'Nothing can swing from there: click another point.')
    : coarse
      ? t('tools:fold.vertex.steps.swivelSwingTouch', 'Tap the edge to swing onto a line.')
      : t('tools:fold.vertex.steps.swivelSwing', 'Click the edge to swing onto a line.');
  return [
    coarse
      ? t(
          'tools:fold.vertex.steps.swivelMeetTouch',
          'Tap the folded edge the creases meet on, anywhere along it. On flat paper, tap where they meet, or turn on Free point for any point.'
        )
      : t(
          'tools:fold.vertex.steps.swivelMeet',
          'Click the folded edge the creases meet on, anywhere along it. On flat paper, click where they meet, or hold {{modifier}} for any point.',
          { modifier: host.alt }
        ),
    swing,
    ...onto,
  ];
}

/**
 * The clicks a vertex fold takes, one instruction each in click order: the
 * window's numbered steps. `nothingSwings`: a swivel's meeting point from
 * which no edge can swing, whose next click picks another point.
 */
export function vertexToolSteps(
  t: TFunction,
  tool: FoldVertexToolId,
  lines: FoldVertexLines = FOLD_VERTEX_LINES_DEFAULT,
  host: FoldVertexStepsHost = { coarse: false, alt: 'Alt' },
  nothingSwings = false
): string[] {
  switch (tool) {
    case 'squash':
      // About a drawn hinge, the flap's end on one side of it: the canvas lights the end under the pointer.
      if (lines.squashHinge === 'line') {
        return [
          host.coarse
            ? t('tools:fold.vertex.steps.squashEndTouch', 'Tap the end of the flap to squash, on one side of the line.')
            : t('tools:fold.vertex.steps.squashEnd', 'Click the end of the flap to squash, on one side of the line.'),
        ];
      }
      return [
        host.coarse
          ? t('tools:fold.vertex.steps.squashFlapTouch', 'Tap the flap to squash.')
          : t('tools:fold.vertex.steps.squashFlap', 'Click the flap to squash.'),
      ];
    case 'petal':
      return petalSteps(t, lines.petalHinge, host.coarse);
    case 'rabbit-ear':
      // A finger taps: the same steps in its words, as the choose step's are.
      return host.coarse
        ? [
            t('tools:fold.vertex.steps.earFirstCornerTouch', 'Tap the triangle’s first corner.'),
            t('tools:fold.vertex.steps.earSecondCornerTouch', 'Tap its second corner.'),
            t('tools:fold.vertex.steps.earThirdCornerTouch', 'Tap its third corner.'),
            t('tools:fold.vertex.steps.earHingeRegionTouch', 'Tap the region where the hinge crease goes.'),
          ]
        : [
            t('tools:fold.vertex.steps.earFirstCorner', 'Click the triangle’s first corner.'),
            t('tools:fold.vertex.steps.earSecondCorner', 'Click its second corner.'),
            t('tools:fold.vertex.steps.earThirdCorner', 'Click its third corner.'),
            t('tools:fold.vertex.steps.earHingeRegion', 'Click the region where the hinge crease goes.'),
          ];
    case 'swivel':
      return swivelSteps(t, lines.swivelTarget, host, nothingSwings);
  }
}
