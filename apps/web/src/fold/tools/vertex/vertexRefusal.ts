/**
 * A refused vertex fold — squash, petal fold, rabbit ear, swivel (plan Phase
 * 11, D14) — in a folder's words, for the one refusal notice
 * (`refusalNotice.ts`). Its preconditions are said first, since research
 * §5.3 found them, not the stacking, to be what stops these folds: every
 * squash that failed to close had its flap held off its hinge, every blocked
 * one was covered.
 *
 * Every fix the engine offers a vertex fold is a button — the other
 * direction, a fan's other fourth ray or a swivel's other ridge
 * (`use_emergent`), a swivel's plain fold along its bisector (`use_line`,
 * the shared notice's) — and so is what the tools can do for a refusal the
 * engine offers no fix for:
 *
 * - a squash's spine aimed outside its wedge goes back onto the hinge;
 * - a petal fold over a hinge crease whose kite creases are not there takes
 *   the same hinge by its two ends, so the fold creases them, or
 *   the Precrease tool on the edge-to-edge axiom that makes them; a hinge the
 *   fold cannot crease through the layers that fold takes the Precrease
 *   tool through its two ends. The engine cannot offer these: it cannot
 *   know the kite's corner before the kite is creased.
 *
 * A petal fold with no flap says what its cause names more precisely, where
 * the engine does (`FoldNoPetalDetail`): a hinge that misses the flap, or
 * lies too near its closed point.
 *
 * React-free and store-free; literal `t()` keys so the extractor sees them.
 */
import type { TFunction } from 'i18next';
import type { NoticeAction } from '../../../components/ui/Notice';
import {
  FOLD_SWIVEL_REFUSAL_CODES,
  type FoldNoFlap,
  type FoldNoPetal,
  type FoldNoPetalDetail,
} from '../../engine/foldEngineSquashWire';
import type { FoldFix, FoldModelPoint, FoldRefusalBody } from '../../engine/foldEngineWire';
import type { FoldLineBy } from '../foldToolCatalog';

/** The vertex folds' refusal codes, which {@link vertexRefusalWords} words: the swivel by its edge's among them. */
export const FOLD_VERTEX_REFUSAL_CODES = [
  'squash_no_flap',
  'squash_flap_not_free',
  'squash_flap_covered',
  'squash_target_outside',
  'petal_not_precreased',
  'petal_no_flap',
  'fan_center',
  'fan_ray_blocked',
  'fan_not_flat',
  'fan_fourth_beside_stayer',
  'fan_fourth_cannot_rise',
  'fan_stayer_detached',
  ...FOLD_SWIVEL_REFUSAL_CODES,
] as const;

export type FoldVertexRefusalCode = (typeof FOLD_VERTEX_REFUSAL_CODES)[number];

/** What a vertex fold's notice is read against. */
export interface FoldVertexRefusalContext {
  /** The tool the refusal is for: its words name what it folds. */
  tool: 'squash' | 'petal' | 'rabbit-ear' | 'swivel';
  /** A fan's fourth ray's number on screen (1-based), by its direction: what a `use_emergent` fix names. */
  emergentNumber?: (direction: FoldModelPoint) => number | null;
  /** How a petal fold's hinge was named: a crease already there, or its two ends. A crease when unknown. */
  hinge?: FoldLineBy;
  /**
   * A swivel's form: by its edge — whose creases are computed and whose
   * fourth is its ridge — by its edge with its creases meeting on a folded
   * edge (`fold`), by its valley and mountain (`valley-mountain`), or by its
   * rays (a stored step's). By its rays when unknown.
   */
  swivel?: 'edge' | 'fold' | 'valley-mountain' | 'rays';
}

/**
 * The context a vertex fold's refusal is worded in when no tool gave one —
 * a notice read away from the tool that folded it: the fold its code names,
 * a fan's as a swivel's.
 */
export function vertexContextOf(code: string): FoldVertexRefusalContext {
  if (code.startsWith('petal')) return { tool: 'petal' };
  // A swivel on a folded edge's own codes name the folded edge.
  if (code === 'swivel_not_a_fold' || code === 'swivel_misses_fold' || code === 'swivel_fold_wide') {
    return { tool: 'swivel', swivel: 'fold' };
  }
  // A swivel by its valley and mountain's own name its two lines.
  if (code === 'swivel_line_meeting' || code === 'swivel_no_flap') return { tool: 'swivel', swivel: 'valley-mountain' };
  if (code.startsWith('swivel')) return { tool: 'swivel', swivel: 'edge' };
  return code.startsWith('fan') ? { tool: 'swivel' } : { tool: 'squash' };
}

/** The calls a vertex fold's fixes make; the canvas binds them. */
export interface FoldVertexFixVerbs {
  /** The same fold, the other direction. */
  vertexOtherWay?: () => void;
  /** Fold the fan with this fourth ray — a swivel with this ridge —, a direction in the parent's model frame. */
  takeEmergent?: (direction: FoldModelPoint) => void;
  /** Put a squash's spine back onto its hinge line. */
  resetSquashTarget?: () => void;
  /** Precrease a petal fold's hinge first: the Precrease tool through its two ends. */
  precreaseLine?: () => void;
  /** Precrease a petal fold's kite first: the Precrease tool on the edge-to-edge axiom. */
  precreaseKite?: () => void;
  /** The same petal fold with its hinge named by its two ends, so the fold creases the kite creases it lacks. */
  petalByEnds?: () => void;
}

function noFlap(t: TFunction, cause: FoldNoFlap): string {
  switch (cause) {
    case 'single_layer':
      return t(
        'tools:fold.vertex.refusal.noFlap.singleLayer',
        'Only one layer lies here. Click a flap of two layers joined along a folded edge.'
      );
    case 'no_spine':
      return t(
        'tools:fold.vertex.refusal.noFlap.noSpine',
        'These layers are not joined by a single folded edge, so there is no spine to open. A closed flap, joined through folded-in sides, cannot be squashed yet.'
      );
    case 'no_hinge':
      return t(
        'tools:fold.vertex.refusal.noFlap.noHinge',
        'The flap folds over no hinge at either end of its spine, so there is nothing to press it flat against.'
      );
    case 'upper_not_hinged':
      return t(
        'tools:fold.vertex.refusal.noFlap.upperNotHinged',
        'The flap’s top layer is held by its spine alone: pressed flat, its hinge side would lie loose.'
      );
    case 'hinge_off_spine':
      return t(
        'tools:fold.vertex.refusal.noFlap.hingeOffSpine',
        'The hinge line must cross the flap’s folded edge, with the end you click on one side of it.'
      );
  }
}

/**
 * Why a petal fold has no flap, in its words: the cause, and what the engine
 * names of it more precisely where it does (`FoldNoPetalDetail`).
 */
function noPetal(t: TFunction, cause: FoldNoPetal, detail: FoldNoPetalDetail | undefined): { title: string; text: string } {
  if (cause === 'no_ends' && detail?.kind === 'misses_flap') {
    return {
      title: t('tools:fold.vertex.refusal.noPetal.missesFlapTitle', 'The hinge misses the flap'),
      text: t(
        'tools:fold.vertex.refusal.noPetal.missesFlap',
        'The flap you clicked lies wholly on one side of the hinge. Click the flap the hinge runs across, or pick a hinge from one of its folded edges to the other.'
      ),
    };
  }
  if (cause === 'no_corner' && detail?.kind === 'past_corner') {
    return {
      title: t('tools:fold.vertex.refusal.noPetal.pastCornerTitle', 'The hinge is too near the closed point'),
      text: t(
        'tools:fold.vertex.refusal.noPetal.pastCorner',
        'The kite creases from the hinge’s ends meet below it, but the flap reaches past where they meet, and that paper would fold no way. Move the hinge farther from the flap’s closed point: its ends where the kite creases meet the flap’s edges.'
      ),
    };
  }
  switch (cause) {
    case 'no_ends':
      return {
        title: t('tools:fold.vertex.refusal.noPetal.noEndsTitle', 'The hinge does not cross the flap'),
        text: t(
          'tools:fold.vertex.refusal.noPetal.noEndsHinge',
          'A petal fold’s hinge runs across the flap from one folded edge to the other, and this one crosses one of them, or neither. Pick a hinge whose ends lie on the flap’s two folded edges.'
        ),
      };
    case 'no_corner':
      return {
        title: t('tools:fold.vertex.refusal.noPetal.noCornerTitle', 'No point to lift'),
        text: t(
          'tools:fold.vertex.refusal.noPetal.noCornerHinge',
          'The kite creases from the hinge’s ends do not meet below it, so there is no point to lift. Pick a hinge whose ends lie where the kite creases meet the flap’s edges.'
        ),
      };
  }
}

/**
 * A swivel's own refusals (`FOLD_SWIVEL_REFUSAL_CODES`), in its words: by its
 * edge at a pivot, or with its creases meeting on a folded edge (`onFold`),
 * or by its valley and mountain.
 */
function swivelWords(
  t: TFunction,
  code: (typeof FOLD_SWIVEL_REFUSAL_CODES)[number],
  onFold: boolean
): { title: string; text: string } {
  switch (code) {
    case 'swivel_line_meeting':
      return {
        title: t('tools:fold.vertex.refusal.lineMeeting.titleValleyMountain', 'The lines do not meet on a folded edge'),
        text: t(
          'tools:fold.vertex.refusal.lineMeeting.textValleyMountain',
          'The valley and the mountain meet at a point of a folded edge you can see, away from its ends. Pick two lines that cross there.'
        ),
      };
    case 'swivel_no_flap':
      return {
        title: t('tools:fold.vertex.refusal.swivelNoFlap.title', 'No flap between the lines'),
        text: t(
          'tools:fold.vertex.refusal.swivelNoFlap.text',
          'The valley and the mountain leave the folded edge into the paper, in two directions, with the flap between them. One of these runs along the folded edge, or both lie on one line: pick another.'
        ),
      };
    case 'swivel_not_a_fold':
      return {
        title: t('tools:fold.vertex.refusal.swivelNotAFold.title', 'That is no folded edge'),
        text: t(
          'tools:fold.vertex.refusal.swivelNotAFold.text',
          'The creases can meet on a folded edge only where the paper is folded, and the point picked lies on no fold. Press Esc and click the folded edge again.'
        ),
      };
    case 'swivel_misses_fold':
      return {
        title: t('tools:fold.vertex.refusal.swivelMissesFold.title', 'The creases cannot meet on that edge'),
        text: t(
          'tools:fold.vertex.refusal.swivelMissesFold.text',
          'The swivel folds along the line halfway between the edge and the line it lands on, and that line does not cross this folded edge between its ends. Press Esc and pick the folded edge it crosses, or another line.'
        ),
      };
    case 'swivel_inside_free':
      return {
        title: t('tools:fold.vertex.refusal.swivelInsideFree.title', 'An inside swivel needs a folded edge'),
        text: t(
          'tools:fold.vertex.refusal.swivelInsideFree.text',
          'An inside swivel tucks its strip between the two layers a folded edge joins, and these creases meet away from any folded edge. Press Esc and click a folded edge for the creases to meet on.'
        ),
      };
    case 'swivel_fold_wide':
      return {
        title: t('tools:fold.vertex.refusal.swivelFoldWide.title', 'The swivel crease meets the edge too steeply'),
        text: t(
          'tools:fold.vertex.refusal.swivelFoldWide.text',
          'On the moving edge’s side the swivel crease meets the folded edge at a right angle or more, which leaves the other layer no room to fold. Pick a line for the edge to land on that turns it further, or another folded edge.'
        ),
      };
    case 'swivel_not_an_edge':
      return {
        title: t('tools:fold.vertex.refusal.swivelNotAnEdge.title', 'That is no edge'),
        text: t(
          'tools:fold.vertex.refusal.swivelNotAnEdge.text',
          'A swivel moves a raw edge of the paper or a folded edge, and the line picked is neither. Press Esc and pick the edge again.'
        ),
      };
    case 'swivel_target_parallel':
      return {
        title: t('tools:fold.vertex.refusal.swivelTargetParallel.title', 'The line runs parallel to the edge'),
        text: t(
          'tools:fold.vertex.refusal.swivelTargetParallel.text',
          'No turn about a point lays an edge on a line parallel to it, or on its own line. Pick a line that meets the edge’s line.'
        ),
      };
    case 'swivel_pivot_on_edge':
      return {
        title: t('tools:fold.vertex.refusal.swivelPivotOnEdge.title', 'The creases would meet on the edge'),
        text: t(
          'tools:fold.vertex.refusal.swivelPivotOnEdge.text',
          'The creases meet where the pivot sits, moved onto the line halfway between the edge and the line it lands on, and here that is on the edge itself. Press Esc and pick a pivot farther from where the edge meets the line.'
        ),
      };
    case 'swivel_edge_short':
      return {
        title: t('tools:fold.vertex.refusal.swivelEdgeShort.title', 'The edge ends before it would turn'),
        text: t(
          'tools:fold.vertex.refusal.swivelEdgeShort.text',
          'No part of the edge lies past the point square below the pivot, so none of it would swivel. A plain fold along the line halfway between the edge and its target lays it there instead.'
        ),
      };
    case 'swivel_edge_stays':
      return {
        title: t('tools:fold.vertex.refusal.swivelEdgeStays.title', 'The edge would stay put'),
        text: onFold
          ? t(
              'tools:fold.vertex.refusal.swivelEdgeStays.onFold',
              'Neither layer the folded edge joins holds the edge that moves, so it would stay put. Pick a folded edge of the edge’s own layer, or another edge.'
            )
          : t(
              'tools:fold.vertex.refusal.swivelEdgeStays.text',
              'The paper along the edge would stay put, or fold across the hinge, rather than turn onto the line. Pick a pivot nearer the edge, or another edge.'
            ),
      };
  }
}

/** A vertex fold's refusal in a folder's words; null for any other code. */
export function vertexRefusalWords(
  t: TFunction,
  refusal: FoldRefusalBody,
  context: FoldVertexRefusalContext
): { title: string; text: string } | null {
  switch (refusal.code) {
    case 'squash_no_flap':
      return { title: t('tools:fold.vertex.refusal.noFlap.title', 'No flap to squash here'), text: noFlap(t, refusal.cause) };
    case 'squash_flap_not_free':
      return {
        title: t('tools:fold.vertex.refusal.notFree.title', 'The flap is held elsewhere'),
        text: t(
          'tools:fold.vertex.refusal.notFree.text',
          'The flap is joined to other paper away from its hinge. Only a flap held along its hinge alone opens flat: unfold what holds it first.'
        ),
      };
    case 'squash_flap_covered':
      return context.tool === 'petal'
        ? {
            title: t('tools:fold.vertex.refusal.petalCovered.title', 'The flap is covered'),
            text: t(
              'tools:fold.vertex.refusal.petalCovered.text',
              'Other layers lie over the flap on the side it lifts toward. Fold them out of the way first, or lift it the other way.'
            ),
          }
        : {
            title: t('tools:fold.vertex.refusal.covered.title', 'The flap is covered'),
            text: t(
              'tools:fold.vertex.refusal.covered.text',
              'Other layers lie over the flap, or inside it, on the side it opens toward. Fold them out of the way first, or squash it the other way.'
            ),
          };
    case 'squash_target_outside':
      return {
        title: t('tools:fold.vertex.refusal.targetOutside.title', 'The spine cannot land there'),
        text: t(
          'tools:fold.vertex.refusal.targetOutside.text',
          'The spine lands between where it lies and the hinge. Click a point inside the flap, or put it back onto the hinge.'
        ),
      };
    case 'petal_not_precreased':
      if (refusal.missing === 'kite') {
        return {
          title: t('tools:fold.vertex.refusal.kite.titleMissing', 'The kite creases are not there'),
          // What each button does: the fold creases them, or the Precrease tool makes them first.
          text: t(
            'tools:fold.vertex.refusal.kite.creaseOrPrecrease',
            'Over a hinge crease, a petal fold refolds creases already there, and a kite crease is not. Name the hinge by its two ends instead, and the fold creases the kites itself; or precrease them first, with the Precrease tool on Axiom 3: a lower edge of the top flap onto its centre line, the flaps behind left out.'
          ),
        };
      }
      return {
        title: t('tools:fold.vertex.refusal.line.titleHinge', 'Precrease the hinge first'),
        text:
          context.hinge === 'points'
            ? t(
                'tools:fold.vertex.refusal.line.ends',
                'The hinge crosses paper of the second layer that folds in beside the kite, and the fold cannot crease that as the flap lifts. Precrease the hinge through every layer, then petal fold.'
              )
            : t(
                'tools:fold.vertex.refusal.line.crease',
                'The hinge crease does not run through every layer below it that folds. Precrease the hinge through every layer, then petal fold.'
              ),
      };
    case 'petal_no_flap':
      return noPetal(t, refusal.cause, refusal.detail);
    case 'swivel_not_an_edge':
    case 'swivel_target_parallel':
    case 'swivel_pivot_on_edge':
    case 'swivel_edge_short':
    case 'swivel_edge_stays':
    case 'swivel_line_meeting':
    case 'swivel_no_flap':
    case 'swivel_not_a_fold':
    case 'swivel_misses_fold':
    case 'swivel_fold_wide':
    case 'swivel_inside_free':
      return swivelWords(t, refusal.code, context.swivel === 'fold');
    case 'fan_center':
      return {
        title: t('tools:fold.vertex.refusal.center.title', 'The creases cannot meet there'),
        text:
          context.tool === 'rabbit-ear'
            ? t(
                'tools:fold.vertex.refusal.center.textEar',
                'The triangle’s creases meet at its incenter, which lies on a crease or off the layers. Pick corners that put it inside the layers, away from their creases.'
              )
            : context.swivel === 'edge'
              ? t(
                  'tools:fold.vertex.refusal.center.textSwivelEdge',
                  'The creases meet where the pivot sits, moved onto the line halfway between the edge and the line it lands on, and that is on a crease or off the paper. Press Esc and pick another pivot.'
                )
              : t(
                  'tools:fold.vertex.refusal.center.textSwivelStep',
                  'The point the creases meet at is on a crease or off the paper. Press Esc and place it again as step 1 says: inside the paper, away from every crease.'
                ),
      };
    case 'fan_ray_blocked':
      return {
        title: t('tools:fold.vertex.refusal.blocked.title', 'Paper is in the way'),
        // The steppers that change it, by the names the window gives them.
        text:
          context.swivel === 'valley-mountain'
            ? t(
                'tools:fold.vertex.refusal.blocked.swivelValleyMountain',
                'A crease would run into a fold before it reaches the paper’s edge, or paper would hold two parts of the swivel together. Pick another valley or another mountain.'
              )
            : context.swivel === 'fold'
            ? t(
                'tools:fold.vertex.refusal.blocked.swivelOnFold',
                'A crease would run into a fold before it reaches the paper’s edge, or paper would hold two parts of the swivel together. Pick another folded edge, or another line for the edge to land on.'
              )
            : context.swivel === 'edge'
            ? t(
                'tools:fold.vertex.refusal.blocked.swivelEdge',
                'A crease would run into paper that does not fold with it, or paper would hold two parts of the fold together. Pick another pivot, or another line for the edge to land on.'
              )
            : t(
                'tools:fold.vertex.refusal.blocked.steppers',
                'A crease would run into paper that does not fold with it, or paper would hold two parts of the fold together. Step Layers to fold more layers, or Fourth crease to another one.'
              ),
      };
    case 'fan_not_flat':
      return {
        title: t('tools:fold.vertex.refusal.notFlat.title', 'It cannot fold flat'),
        text:
          context.swivel === 'edge'
            ? t(
                'tools:fold.vertex.refusal.notFlat.swivelEdge',
                'No crease lets the edge turn onto that line and lie flat from this pivot. Press Esc and pick another pivot, or another line.'
              )
            : t(
                'tools:fold.vertex.refusal.notFlat.spread',
                'No fourth crease lets these creases lie flat: two of them point the same way, or two neighbours are half a turn or more apart. Press Esc and pick points spread more evenly round the meeting point.'
              ),
      };
    case 'fan_fourth_beside_stayer':
      return context.swivel === 'edge'
        ? {
            title: t('tools:fold.vertex.refusal.ridgeBesideStayer.title', 'The ridge is beside the paper that stays'),
            text: t(
              'tools:fold.vertex.refusal.ridgeBesideStayer.pivot',
              'The flap rises along the ridge, so it lies across from the paper that stays put, and here it does not. Pick another pivot.'
            ),
          }
        : {
            title: t('tools:fold.vertex.refusal.fourthBesideStayer.title', 'The fourth crease is beside the paper that stays'),
            text: t(
              'tools:fold.vertex.refusal.fourthBesideStayer.text',
              'The flap rises along the fourth crease, so it lies across from the paper that stays put. Pick another fourth crease, or other paper to stay put.'
            ),
          };
    case 'fan_fourth_cannot_rise':
      return context.swivel === 'edge'
        ? {
            title: t('tools:fold.vertex.refusal.ridgeCannotRise.title', 'The ridge cannot rise here'),
            text: t(
              'tools:fold.vertex.refusal.ridgeCannotRise.pivot',
              'The ridge folds the other way from the other three creases, and the angles between them do not let it. Pick another pivot.'
            ),
          }
        : {
            title: t('tools:fold.vertex.refusal.fourthCannotRise.title', 'The fourth crease cannot rise here'),
            text: t(
              'tools:fold.vertex.refusal.fourthCannotRise.text',
              'The fourth crease folds the other way from the other three, and the angles between these creases do not let it. Pick another fourth crease, or other points.'
            ),
          };
    case 'fan_stayer_detached':
      return {
        title: t('tools:fold.vertex.refusal.stayer.title', 'Which paper stays?'),
        text:
          context.swivel === 'edge'
            ? t(
                'tools:fold.vertex.refusal.stayer.swivelEdge',
                'The paper beside the line, which stays put, is joined to no part of the fold. Pick another pivot, nearer where the edge meets the line.'
              )
            : t(
                'tools:fold.vertex.refusal.stayer.text',
                'The paper picked to stay put is joined to no part of the fold. Pick paper the creases cut, or paper joined to it.'
              ),
      };
    default:
      return null;
  }
}

/**
 * A vertex fold no order of its layers lands, in its tool's words: the
 * engine checked its preconditions and found no way to stack what it folds.
 * Pointed the other way only when the engine says that way lands (its
 * `opposite_direction` fix).
 */
export function vertexNoOrderWords(
  t: TFunction,
  context: FoldVertexRefusalContext,
  otherWay: boolean
): { title: string; text: string } {
  return {
    title: noOrderTitle(t, context.tool),
    text: otherWay
      ? t(
          'tools:fold.vertex.refusal.noOrder.otherWay',
          'No way of stacking the layers lets it fold flat this way here. Folded the other way, it fits.'
        )
      : t(
          'tools:fold.vertex.refusal.noOrder.none',
          'No way of stacking the layers lets it fold flat here. Pick other points, or fold the layers in its way first.'
        ),
  };
}

function noOrderTitle(t: TFunction, tool: FoldVertexRefusalContext['tool']): string {
  switch (tool) {
    case 'squash':
      return t('tools:fold.vertex.refusal.noOrder.squash', 'It cannot be squashed flat here');
    case 'petal':
      return t('tools:fold.vertex.refusal.noOrder.petal', 'It cannot be petal-folded here');
    case 'rabbit-ear':
      return t('tools:fold.vertex.refusal.noOrder.rabbitEar', 'The ear cannot fold flat here');
    case 'swivel':
      return t('tools:fold.vertex.refusal.noOrder.swivel', 'It cannot swivel flat here');
  }
}

/**
 * A vertex fold's own fix as a button: the other direction, a fan's other
 * fourth ray. Null for any other fix, which the shared notice words; an
 * empty list when there is no verb to bind it to.
 */
export function vertexFixActions(
  t: TFunction,
  fix: FoldFix,
  position: number,
  disabled: boolean,
  context: FoldVertexRefusalContext,
  verbs: FoldVertexFixVerbs
): NoticeAction[] | null {
  switch (fix.fix) {
    case 'opposite_direction': {
      const { vertexOtherWay } = verbs;
      return vertexOtherWay
        ? [
            {
              id: `vertex-other-way-${position}`,
              label: t('tools:fold.vertex.fix.otherWay', 'Fold it the other way'),
              run: vertexOtherWay,
              disabled,
            },
          ]
        : [];
    }
    case 'use_emergent': {
      const { takeEmergent } = verbs;
      if (!takeEmergent) return [];
      const number = context.emergentNumber?.(fix.direction) ?? null;
      // A swivel by its edge has two ridges: the fix names the other.
      const label =
        context.swivel === 'edge'
          ? t('tools:fold.vertex.fix.otherRidge', 'Use the other ridge')
          : number === null
            ? t('tools:fold.vertex.fix.emergent', 'Use the fourth crease that fits')
            : t('tools:fold.vertex.fix.emergentNumber', 'Use fourth crease {{number}}', { number });
      return [{ id: `vertex-emergent-${position}`, label, run: () => takeEmergent(fix.direction), disabled }];
    }
    default:
      return null;
  }
}

/**
 * What the tools can do for a vertex fold's refusal beyond the engine's
 * fixes (see the module docs): a button each, or none.
 */
export function vertexExtraActions(
  t: TFunction,
  refusal: FoldRefusalBody,
  disabled: boolean,
  context: FoldVertexRefusalContext,
  verbs: FoldVertexFixVerbs
): NoticeAction[] {
  const action = (id: string, label: string, run: (() => void) | undefined): NoticeAction[] =>
    run ? [{ id, label, run, disabled }] : [];
  switch (refusal.code) {
    case 'squash_target_outside':
      return action(
        'vertex-reset-target',
        t('tools:fold.vertex.fix.resetTarget', 'Put the spine onto the hinge'),
        verbs.resetSquashTarget
      );
    case 'petal_not_precreased':
      if (refusal.missing === 'kite') {
        return [
          // Over a hinge crease: the same hinge by its ends, which creases the kite as it folds.
          ...(context.hinge === 'points'
            ? []
            : action('vertex-petal-ends', t('tools:fold.vertex.fix.creaseKites', 'Crease the kites as it folds'), verbs.petalByEnds)),
          ...action('vertex-precrease-kite', t('tools:fold.vertex.fix.precreaseKite', 'Precrease the kite'), verbs.precreaseKite),
        ];
      }
      return action(
        'vertex-precrease-line',
        t('tools:fold.vertex.fix.precreaseHinge', 'Precrease the hinge first'),
        verbs.precreaseLine
      );
    default:
      return [];
  }
}
