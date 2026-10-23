/**
 * A refused fold, as the tool window says it (plan D14, Refusals and fixes):
 * what went wrong in a sentence a folder reads, and the engine's fixes as
 * buttons — include flap N, fold the other way, pick a flap, use the landmark
 * line, land a point exactly on an edge, the other reverse fold or sink — and
 * the tools' own where it offers none (a vertex fold's, a partial precrease's
 * whole line). The engine decides which of its fixes exist;
 * this only names them and binds each to its verb.
 *
 * React-free and store-free.
 */
import { foldCapOf, foldCapWords } from '../foldCaps';
import { foldReturnFailure } from '../return/foldReturnWords';
import type { TFunction } from 'i18next';
import type { NoticeAction } from '../../components/ui/Notice';
import type { FoldNoOpening, FoldReverseKind } from '../engine/foldEngineReverseWire';
import type { FoldSinkKind, FoldSinkRefusalCode } from '../engine/foldEngineSinkWire';
import type { FoldCrossSection, FoldEngineRefused, FoldFix, FoldFlap, FoldRefusalCode } from '../engine/foldEngineWire';
import { flapNumbers, sameFlap } from './crossSection';
import type { FoldKind, FoldSinkToolId } from './foldToolCatalog';
import {
  extentExtraActions,
  extentRefusalWords,
  type FoldExtentFixVerbs,
  type FoldExtentRefusalContext,
} from './precrease/precreaseRefusal';
import {
  vertexContextOf,
  vertexExtraActions,
  vertexFixActions,
  vertexNoOrderWords,
  vertexRefusalWords,
  type FoldVertexFixVerbs,
  type FoldVertexRefusalContext,
} from './vertex/vertexRefusal';

/** What a notice reads of a refusal: the bridge's, with or without its envelope. */
export type FoldRefused = Pick<FoldEngineRefused, 'refusal' | 'fixes'>;

/** A fold along another line: a near miss's landmark line, or a sliver remedy with its storable step. */
export type FoldUseLineFix = Extract<FoldFix, { fix: 'use_line' }>;

/**
 * The calls a fix makes; the store binds them. A vertex fold's are its own
 * (`vertex/vertexRefusal`), and a partial precrease's (`precrease/precreaseRefusal`).
 */
export interface FoldFixVerbs extends FoldVertexFixVerbs, FoldExtentFixVerbs {
  /** Add these flaps (engine indices) to the seed. */
  includeFlaps: (flaps: readonly number[]) => void;
  /** The same fold, the other way. */
  foldOtherWay: () => void;
  /** Fold this flap alone. */
  pickFlap: (flap: FoldFlap) => void;
  /**
   * Fold along this line instead, moving the same side: preview it as a model
   * line, and commit its `step` when it has one.
   */
  useLine: (fix: FoldUseLineFix) => void;
  /** The same reverse fold, or crimp, of the other kind. */
  otherKind?: (kind: FoldReverseKind) => void;
  /** The same tuck against this layer, by its face: one the engine listed as taking it. */
  tuckTarget?: (face: number) => void;
  /** The same point sunk the other way: closed for open, open for closed. */
  otherSink?: (kind: FoldSinkKind) => void;
  /** The point that stays put swapped for the one at its spot on paper that folds (`moverStays`). */
  useMovingPoint?: () => void;
  /** A reverse fold with only the flaps its drawn line crosses (`reverse/reverseSeedFix`). */
  useNarrowerSeed?: () => void;
}

export interface FoldRefusalNoticeModel {
  /** The refusal's code, for the surface's analytics (D18 `fold refused`). */
  code: FoldRefusalCode;
  title: string;
  text: string;
  actions: readonly NoticeAction[];
}

/** What the notice is read against: the fold asked for, and how its flaps are numbered on screen. */
export interface FoldRefusalContext {
  /**
   * A plain fold's kind, or the compound fold's family its fixes are worded
   * for; a vertex fold's is `vertex`, its tool in `vertex`; a sink's is
   * `sink` (the open and closed sink and the unsink).
   */
  kind: FoldKind | 'pleat' | 'reverse' | 'crimp' | 'tuck' | 'vertex' | 'sink';
  /** A flap's number on screen, by its index into the section's flaps (`flapNumbers`). */
  flapNumber: (flap: number) => number;
  /**
   * Where a flap a fix names is among the section's flaps, by its faces; null
   * when it is not there. Null itself while no section is shown: no chips
   * number the flaps then, so a fix's flaps are numbered as it lists them.
   */
  flapOf: ((flap: FoldFlap) => number | null) | null;
  /** Nothing can change: the fixes are shown, but none can be taken. */
  readOnly: boolean;
  /**
   * A tuck's: whether it goes under its target, and a listed layer's number
   * as its stepper counts it, by its face (null for one not listed).
   */
  tuck?: { under: boolean; targetNumber: (face: number) => number | null };
  /** A vertex fold's: its tool, and what its own fixes name (`vertex/vertexRefusal`). */
  vertex?: FoldVertexRefusalContext;
  /** A sink's: its tool, a sink or the unsink, which its words name. */
  sink?: { tool: FoldSinkToolId };
  /** A precrease's: how much of its line it creases, and whether through every layer (`precrease/precreaseRefusal`). */
  extent?: FoldExtentRefusalContext;
  /**
   * Refused as its point staying put, and a point at the same spot on paper
   * that folds lands it (`moverStays`): the notice offers that point.
   */
  movingPoint?: boolean;
  /**
   * A reverse fold refused for its tip, where only the flaps its drawn line
   * crosses land it (`reverse/reverseSeedFix`): those flaps, as indices into
   * the section's flaps. The notice offers them.
   */
  narrowerSeed?: readonly number[];
}

/**
 * How a window's notice numbers the flaps of the section it shows: as the
 * chips and the picker number them, so "Flap 2" in a fix is the chip that
 * reads Flap 2 — whichever flaps the engine listed, in whatever order.
 */
export function sectionFlapNames(section: FoldCrossSection | null): Pick<FoldRefusalContext, 'flapNumber' | 'flapOf'> {
  const flaps = section?.flaps ?? [];
  const numbers = flapNumbers(section, flaps.length);
  return {
    flapNumber: (flap) => numbers[flap] ?? flap + 1,
    flapOf: section
      ? (flap) => {
          const at = flaps.findIndex((each) => sameFlap(each, flap));
          return at >= 0 ? at : null;
        }
      : null,
  };
}

function words(t: TFunction, refused: FoldRefused, context: FoldRefusalContext): { title: string; text: string } {
  const { refusal } = refused;
  switch (refusal.code) {
    case 'pleat_failed':
      return { title: t('tools:fold.pleat.refusedTitle', 'The pleat cannot fold here'), text: refusal.reason === 'lines'
          ? t('tools:fold.pleat.lines', 'The valley line must be beyond the mountain line, toward the end that moves. Check the lines or press Swap.')
          : refusal.reason === 'limit'
            ? t('tools:fold.pleat.limit', 'There are too many layer arrangements to resolve this pleat. Select a smaller flap.')
            : t('tools:fold.pleat.blocked', 'Both folds must fit within the selected flap without moving other paper. Check the lines and selected layers.') };
    case 'repeat_failed':
      return { title: t('panels:fold.repeat.failureTitle', 'Cannot repeat'), text: t('panels:fold.repeat.rebuildRequired', 'The saved repeat no longer matches this state. Update it from its source steps.') };
    case 'return_target_invalid': case 'return_state_unavailable': case 'return_source_changed':
    case 'return_unavailable': case 'return_sheet_mismatch': case 'return_limit': case 'return_material':
    case 'return_order': case 'return_pose': case 'return_arrangement': case 'return_invalid_state':
      return { title: t('panels:fold.return.failureTitle', 'Cannot unfold'), text: foldReturnFailure(t, refusal.code) };
    case 'no_moving_side':
      return {
        title: t('tools:fold.refusal.noMovingSide.title', 'Nothing to fold'),
        text: t(
          'tools:fold.refusal.noMovingSide.text',
          'No paper lies on the side of the line that would move. Swap the moving side, or move the line onto the paper.'
        ),
      };
    case 'near_miss':
      return {
        title: t('tools:fold.refusal.nearMiss.title', 'Too close to a point'),
        text: t(
          'tools:fold.refusal.nearMiss.text',
          'The line passes just beside a point of the paper: too close to fold cleanly, too far to go through it.'
        ),
      };
    case 'witness_not_in_face':
    case 'seed_not_on_moving_side':
      return {
        title: t('tools:fold.refusal.pickAgain.title', 'Pick again'),
        text: t(
          'tools:fold.refusal.pickAgain.text',
          'That spot is not inside a layer on the moving side. Pick inside a layer, away from its creases.'
        ),
      };
    case 'empty_seed':
      return {
        title: t('tools:fold.refusal.emptySeed.title', 'Nothing to fold'),
        text: t('tools:fold.refusal.emptySeed.text', 'No layer is picked. Pick at least one flap to move.'),
      };
    case 'nothing_stays':
      return {
        title: t('tools:fold.refusal.nothingStays.title', 'Everything would move'),
        text: t(
          'tools:fold.refusal.nothingStays.text',
          'Every layer is on the moving side, so nothing would stay put. Pick a flap to fold.'
        ),
      };
    case 'closure_adds_flaps': {
      const [only] = refusal.added;
      return {
        title: t('tools:fold.refusal.closureAddsFlaps.title', 'More flaps would move'),
        text:
          refusal.added.length === 1 && only !== undefined
            ? t('tools:fold.refusal.closureAddsFlaps.textOne', 'Folding these layers moves flap {{number}} too.', {
                number: context.flapNumber(only),
              })
            : t('tools:fold.refusal.closureAddsFlaps.textMany', {
                count: refusal.added.length,
                defaultValue_one: 'Folding these layers moves {{count}} more flap too.',
                defaultValue_other: 'Folding these layers moves {{count}} more flaps too.',
              }),
      };
    }
    case 'layer_order':
      return {
        title: t('tools:fold.refusal.collision.title', 'Collision'),
        text: t('tools:fold.refusal.collision.text', 'The moving layers would pass through layers in their way.'),
      };
    case 'short_crease':
    case 'thin_piece':
    case 'degenerate_split':
      return {
        title: t('tools:fold.refusal.tooSmall.title', 'Too small to fold'),
        text: t(
          'tools:fold.refusal.tooSmall.text',
          'The fold would leave a crease or a strip of paper thinner than the paper itself.'
        ),
      };
    case 'sliver':
      return {
        title: t('tools:fold.refusal.sliver.title', 'A point lands just inside an edge'),
        text: t(
          'tools:fold.refusal.sliver.text',
          'A point of the moving layers would land a hair’s breadth inside another layer’s edge.'
        ),
      };
    case 'precrease_unfold_moved_more':
      return {
        title: t('tools:fold.refusal.precreaseUnfold.title', 'This precrease cannot unfold'),
        text: t('tools:fold.refusal.precreaseUnfold.text', 'Unfolding it would move more layers than folding it did.'),
      };
    case 'tuck_target_moves':
      return {
        title: t('tools:fold.refusal.tuckTarget.title', 'The layer to tuck under would move'),
        text: t('tools:fold.refusal.tuckTarget.text', 'Pick a layer that stays put to tuck the flap against.'),
      };
    // A line located from references that do not name paper of this state.
    case 'point_off_paper':
    case 'segment_too_short':
    case 'segment_not_on_a_face':
    case 'crease_not_found':
      return {
        title: t('tools:fold.refusal.offPaper.title', 'A reference is not on the paper'),
        text: t(
          'tools:fold.refusal.offPaper.text',
          'A point or edge the line was located from does not lie on the paper as it is folded now. Locate the line again.'
        ),
      };
    case 'free_line_too_short':
      return {
        title: t('tools:fold.refusal.pointsTooClose.title', 'The points are too close'),
        text: t(
          'tools:fold.refusal.pointsTooClose.text',
          'The two points land in the same place on the folded paper, so they make no line. Pick two points farther apart.'
        ),
      };
    case 'no_root':
      return {
        title: t('tools:fold.refusal.noRoot.title', 'No fold here'),
        text: t(
          'tools:fold.refusal.noRoot.text',
          'These references give no fold line on the paper as it is folded. Pick other references.'
        ),
      };
    case 'no_side':
    case 'side_on_line':
      return {
        title: t('tools:fold.refusal.noSide.title', 'Which side moves?'),
        text: t(
          'tools:fold.refusal.noSide.text',
          'Nothing says which side of the line moves. Pick a point off the line, on the side to move.'
        ),
      };
    case 'mover_stays':
      return {
        title: t('tools:fold.refusal.moverStays.title', 'The point would stay put'),
        text: t(
          'tools:fold.refusal.moverStays.text',
          'The layer that carries the point to move is not among the layers folding. Include its flap, or fold every layer.'
        ),
      };
    case 'crease_not_flat':
    case 'crease_not_folded':
      return {
        title: t('tools:fold.refusal.wrongCrease.title', 'Not that kind of crease'),
        text: t(
          'tools:fold.refusal.wrongCrease.text',
          'Unfold along a folded edge, and refold along a flat crease.'
        ),
      };
    // Over a cap — too many faces, or stacked too deep: the fold being made,
    // or a stored import's pattern (the import codes reach a notice only
    // from a replay).
    case 'too_many_faces':
    case 'stacked_too_deep':
    case 'import_too_many_faces':
    case 'import_stacked_too_deep': {
      const cap = foldCapOf(refusal);
      if (cap) return foldCapWords(t, cap, refusal.code.startsWith('import_') ? 'step' : 'fold');
      return {
        title: t('tools:fold.refusal.unsupported.title', 'This step cannot be folded'),
        text: t('tools:fold.refusal.unsupported.text', 'This version of Ori Studio cannot fold it as it is stored.'),
      };
    }
    // A stored step this build cannot fold as it is, an Import CP step among
    // them: nothing a folder asked for. The Import CP picker words its own
    // refusals; the import codes reach a notice only from a replay.
    case 'unexpected_choice':
    case 'root_missing':
    case 'import_not_finite':
    case 'import_no_border':
    case 'import_outline_loops':
    case 'import_outline_invalid':
    case 'import_shape_unsupported':
    case 'import_shape_mismatch':
    case 'import_crease_off_sheet':
    case 'import_conflicting_creases':
    case 'import_crease_not_chord':
    case 'import_disconnected_creases':
    case 'import_non_convex_face':
    case 'import_not_flat_foldable':
    case 'import_ambiguous_overlap':
    case 'import_no_order':
    case 'import_budget_exceeded':
    case 'import_order_open':
    case 'import_witness_not_in_face':
    case 'import_relation_one_face':
    case 'import_internal':
    case 'import_unreadable':
    case 'import_folded_form':
    case 'import_stored_unreadable':
    case 'import_order_broken':
    case 'import_figure_incomplete':
    case 'fold_export_too_large':
      return {
        title: t('tools:fold.refusal.unsupported.title', 'This step cannot be folded'),
        text: t('tools:fold.refusal.unsupported.text', 'This version of Ori Studio cannot fold it as it is stored.'),
      };
    // Compound folds (plan D4), one block per family. A choice still to make
    // reads as the chooser's prompt; a stored one that no longer resolves as
    // a step this build cannot fold as it is stored.
    case 'choice_needed':
      return choiceNeededWords(t, refusal.choice);
    case 'choice_broken':
      return {
        title: t('tools:fold.refusal.choiceBroken.title', 'A choice no longer fits'),
        text: t(
          'tools:fold.refusal.choiceBroken.text',
          'The opening or the layer order this step stored no longer fits the paper before it, so it cannot be folded as it is stored.'
        ),
      };
    // The reverse fold's.
    case 'reverse_no_opening':
      return {
        title: t('tools:fold.refusal.reverseNoOpening.title', 'This flap cannot open'),
        text: noOpening(t, refusal.cause, context.kind),
      };
    case 'reverse_kind_infeasible':
      return {
        title:
          refusal.kind === 'inside'
            ? t('tools:fold.refusal.insideInfeasible.title', 'It cannot go inside')
            : t('tools:fold.refusal.outsideInfeasible.title', 'It cannot wrap round the outside'),
        // The other kind is pointed to only when the engine says it lands.
        text: refused.fixes.some((fix) => fix.fix === 'other_kind')
          ? t(
              'tools:fold.refusal.kindInfeasible.text',
              'No way of stacking the layers lets the tip turn this way here. The other kind of reverse fold may fit.'
            )
          : t(
              'tools:fold.refusal.kindInfeasible.neither',
              'Neither kind of reverse fold fits here: no way of stacking the layers lets the tip turn. Move the line, or reverse other flaps.'
            ),
      };
    case 'reverse_tip_not_free':
      return {
        title: t('tools:fold.refusal.tipNotFree.title', 'Layers are in the way'),
        text: t(
          'tools:fold.refusal.tipNotFree.text',
          'Other layers lie where the tip would turn. Include their flaps in the fold, or reverse it somewhere else.'
        ),
      };
    // The crimp's (its tip at ℓ1 is a reverse fold's, whose refusals above
    // it shares).
    case 'crimp_lines_meet':
      return {
        title: t('tools:fold.refusal.crimpLinesMeet.title', 'The lines meet'),
        text: t(
          'tools:fold.refusal.crimpLinesMeet.redraw',
          'The two lines cross, or come too close, over the paper the crimp moves. Press Esc and draw the second line clear of the first, all the way across the flap.'
        ),
      };
    case 'crimp_misses_tip':
      return {
        title: t('tools:fold.refusal.crimpMissesTip.title', 'The second line misses the flap'),
        text: t(
          'tools:fold.refusal.crimpMissesTip.redraw',
          'The second line crosses none of the paper beyond the first, so nothing would turn back. Swap the tip side if the tip is the other end, or press Esc and draw the second line across the flap, beyond the first.'
        ),
      };
    case 'crimp_no_opening':
      return {
        title: t('tools:fold.refusal.crimpNoOpening.title', 'This flap cannot open at the second line'),
        text: t(
          'tools:fold.refusal.crimpNoOpening.text',
          'Its layers part at the first line, but at the second one of them has ended, or has nothing to turn on. Move the second line, or crimp other flaps.'
        ),
      };
    case 'crimp_kind_infeasible':
      return {
        title:
          refusal.kind === 'inside'
            ? t('tools:fold.refusal.crimpInsideInfeasible.title', 'It cannot crimp inside')
            : t('tools:fold.refusal.crimpOutsideInfeasible.title', 'It cannot crimp round the outside'),
        // The other kind is pointed to only when the engine says it lands.
        text: refused.fixes.some((fix) => fix.fix === 'other_kind')
          ? t(
              'tools:fold.refusal.crimpKindInfeasible.text',
              'No way of stacking the layers lets the tip turn this way on both lines. The other kind of crimp may fit.'
            )
          : t(
              'tools:fold.refusal.crimpKindInfeasible.neitherRedraw',
              'Neither an inside nor an outside crimp fits these lines: no way of stacking the layers lets the tip turn on both. Press Esc and draw the lines closer to parallel, or crimp fewer flaps.'
            ),
      };
    case 'crimp_tip_not_free':
      return {
        title: t('tools:fold.refusal.tipNotFree.title', 'Layers are in the way'),
        text: t(
          'tools:fold.refusal.crimpTipNotFree.text',
          'Other layers lie where the crimped paper would turn. Include their flaps in the crimp, or crimp it somewhere else.'
        ),
      };
    // The tuck's. With no layer named, the tools found none that takes it
    // (`tuckWithoutTarget`); with one, the engine found no order against it.
    // Under or over as the viewer sees it, the tuck window's: the refusal's
    // `placement` is the model frame's, the other way round on a view turned over.
    case 'tuck_infeasible': {
      const under = context.tuck ? context.tuck.under : refusal.placement === 'under';
      if (refusal.target === null) {
        return {
          title: t('tools:fold.refusal.tuckNoTarget.title', 'No layer takes the tuck here'),
          text:
            under
              ? t(
                  'tools:fold.refusal.tuckNoTarget.under',
                  'No layer that stays can take the flap under it here. Fold it the other way, swap the moving side, or locate another line.'
                )
              : t(
                  'tools:fold.refusal.tuckNoTarget.over',
                  'No layer that stays can take the flap over it here. Fold it the other way, swap the moving side, or locate another line.'
                ),
        };
      }
      return {
        title: under
          ? t('tools:fold.refusal.tuckInfeasible.titleUnder', 'It cannot be tucked under that layer')
          : t('tools:fold.refusal.tuckInfeasible.titleOver', 'It cannot be tucked over that layer'),
        text: refused.fixes.some((fix) => fix.fix === 'tuck_target')
          ? t(
              'tools:fold.refusal.tuckInfeasible.text',
              'No way of stacking the layers puts the flap right against that layer. Another layer here takes it.'
            )
          : t(
              'tools:fold.refusal.tuckInfeasible.none',
              'No way of stacking the layers puts the flap right against that layer. Tuck fewer flaps, or locate another line.'
            ),
      };
    }
    // The vertex folds' (`vertex/vertexRefusal`), in their tool's words: the
    // swivel by its edge's among them.
    case 'squash_no_flap':
    case 'squash_flap_not_free':
    case 'squash_flap_covered':
    case 'squash_target_outside':
    case 'petal_not_precreased':
    case 'petal_no_flap':
    case 'fan_center':
    case 'fan_ray_blocked':
    case 'fan_not_flat':
    case 'fan_fourth_beside_stayer':
    case 'fan_fourth_cannot_rise':
    case 'fan_stayer_detached':
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
      return vertexRefusalWords(t, refusal, context.vertex ?? vertexContextOf(refusal.code)) ?? invalidWords(t);
    // The sinks'.
    case 'sink_several_points':
    case 'sink_point_open':
    case 'sink_outline_mixed':
    case 'sink_no_axis':
    case 'sink_line_tilted':
    case 'sink_no_pocket':
    case 'unsink_not_sunk':
      return sinkWords(t, refused, refusal.code);
    // The compound pipeline's own: no order of the layers lands. A sink and a
    // vertex fold reach it with their preconditions met — the reverse fold,
    // the crimp and the tuck word theirs as their own codes — so it is said
    // in their words, pointing to the other sink or the other direction when
    // the engine says that one lands.
    case 'no_order':
      if (context.vertex) {
        return vertexNoOrderWords(t, context.vertex, refused.fixes.some((fix) => fix.fix === 'opposite_direction'));
      }
      if (context.kind === 'sink') return sinkNoOrderWords(t, refused, context.sink?.tool ?? null);
      return invalidWords(t);
    // A search that ran out: whether the fold fits is not known.
    case 'budget_exceeded':
      return {
        title: t('tools:fold.refusal.budget.title', 'The search ran out of time'),
        text: t(
          'tools:fold.refusal.budget.text',
          'Working out how the layers stack took too long here, so it is not known whether this fold fits. Fold fewer layers, or fold it elsewhere.'
        ),
      };
    // A partial precrease's (`precrease/precreaseRefusal`), in its own words.
    case 'extent_off_paper':
    case 'extent_too_short':
    case 'extent_misses_paper':
    case 'extent_misses_layers':
    case 'mark_off_sheet':
    case 'mark_too_short':
    case 'mark_on_crease':
    case 'marks_overlap':
      return extentRefusalWords(t, refusal.code, context.extent?.mode ?? null);
    // The sheet, and a state the engine itself could not make valid: nothing
    // a folder asked for by name, so nothing to say beyond that it cannot be.
    // With them, a pick that names nothing and a defect.
    case 'sheet_too_few_points':
    case 'sheet_not_finite':
    case 'sheet_not_convex':
    case 'sheet_side_too_short':
    case 'sheet_not_in_unit_frame':
    case 'invalid_rectangle':
    case 'invalid_sides':
    case 'duplicate_id':
    case 'unknown_vertex':
    case 'crease_unknown_vertex':
    case 'unused_vertex':
    case 'face_too_small':
    case 'missing_crease':
    case 'crease_face_count':
    case 'non_convex_face':
    case 'area_mismatch':
    case 'vertex_off_sheet':
    case 'border_off_outline':
    case 'root_not_rigid':
    case 'view_not_finite':
    case 'unknown_root':
    case 'unreached_face':
    case 'residual':
    case 'hinge_orientation':
    case 'folded_image':
    case 'prediction_mismatch':
    case 'no_such_choice':
    case 'internal':
      return invalidWords(t);
  }
}

/** A fold that cannot be made, with nothing more to say of why. */
function invalidWords(t: TFunction): { title: string; text: string } {
  return {
    title: t('tools:fold.refusal.invalid.title', 'This fold cannot be made'),
    text: t('tools:fold.refusal.invalid.text', 'It would not land on a valid flat model.'),
  };
}

/**
 * A sink whose layers no order lands, its preconditions met: the point the
 * open or closed sink pushes in, or the unsink pulls out. The other kind of
 * sink is pointed to only when the engine says it lands.
 */
function sinkNoOrderWords(t: TFunction, refused: FoldRefused, tool: FoldSinkToolId | null): { title: string; text: string } {
  if (tool === 'unsink') {
    return {
      title: t('tools:fold.refusal.sinkNoOrder.unsinkTitle', 'The point cannot come back out here'),
      text: t(
        'tools:fold.refusal.sinkNoOrder.unsink',
        'No way of stacking the layers lets the sunk point come back out here.'
      ),
    };
  }
  return {
    title: t('tools:fold.refusal.sinkNoOrder.title', 'The point cannot sink this way here'),
    text: refused.fixes.some((fix) => fix.fix === 'other_sink')
      ? t(
          'tools:fold.refusal.sinkNoOrder.otherSink',
          'No way of stacking the layers lets the point sink this way here. The other kind of sink fits.'
        )
      : t(
          'tools:fold.refusal.sinkNoOrder.none',
          'No way of stacking the layers lets the point sink this way here. Move the line, or pick another point.'
        ),
  };
}

/** A choice a stored compound step still needs, as its chooser prompts for it. */
function choiceNeededWords(
  t: TFunction,
  choice: 'opening' | 'pocket' | 'completion'
): { title: string; text: string } {
  switch (choice) {
    case 'opening':
      return {
        title: t('tools:fold.refusal.chooseOpening.title', 'Choose how it opens'),
        text: t('tools:fold.refusal.chooseOpening.text', 'The flap opens more than one way. Pick one to fold.'),
      };
    case 'completion':
      return {
        title: t('tools:fold.refusal.chooseOrder.title', 'Choose how the layers stack'),
        text: t(
          'tools:fold.refusal.chooseOrder.text',
          'The fold can land with its layers stacked more than one way. Pick one to fold.'
        ),
      };
    case 'pocket':
      return {
        title: t('tools:fold.refusal.choosePocket.title', 'Choose a pocket'),
        text: t(
          'tools:fold.refusal.choosePocket.text',
          'The point can sink into more than one pocket between its layers. Pick one to fold.'
        ),
      };
  }
}

/**
 * A sink's refusal's title, by its code alone: what the sink's kind control
 * says of a kind that does not fit (`tools/sink/sinkToolWindow`), and the
 * notice's title.
 */
export function sinkRefusalTitle(t: TFunction, code: FoldSinkRefusalCode): string {
  switch (code) {
    case 'sink_several_points':
      return t('tools:fold.refusal.sinkSeveralPoints.title', 'Pick one point');
    case 'sink_point_open':
      return t('tools:fold.refusal.sinkPointOpen.title', 'The point is open');
    case 'sink_outline_mixed':
      return t('tools:fold.refusal.sinkOutlineMixed.title', 'Its outside is not one fold');
    case 'sink_no_axis':
      return t('tools:fold.refusal.sinkNoAxis.title', 'The point has no centre line');
    case 'sink_line_tilted':
      return t('tools:fold.refusal.sinkLineTilted.title', 'The line is not square to the point');
    case 'sink_no_pocket':
      return t('tools:fold.refusal.sinkNoPocket.title', 'The point has no pocket');
    case 'unsink_not_sunk':
      return t('tools:fold.refusal.unsinkNotSunk.title', 'No sunk point here');
  }
}

/** A sink's refusal (`foldEngineSinkWire.ts`'s codes), in a folder's words; a precondition each but the last. */
function sinkWords(t: TFunction, refused: FoldRefused, code: FoldSinkRefusalCode): { title: string; text: string } {
  const { refusal } = refused;
  const title = sinkRefusalTitle(t, code);
  switch (code) {
    case 'sink_several_points': {
      const flaps = refusal.code === 'sink_several_points' ? refusal.flaps : 0;
      return {
        title,
        text: t('tools:fold.refusal.sinkSeveralPoints.text', {
          count: flaps,
          defaultValue_one: '{{count}} point lies on the tip side, and a sink takes one. Pick the point to sink.',
          defaultValue_other: '{{count}} points lie on the tip side, and a sink takes one. Pick the point to sink.',
        }),
      };
    }
    case 'sink_point_open':
      return {
        title,
        text: t(
          'tools:fold.refusal.sinkPointOpen.text',
          'Raw edges reach its tip: its layers are free corners, not a closed point, so nothing says how they would sink. Sink a point whose layers are joined at the tip.'
        ),
      };
    case 'sink_outline_mixed':
      return {
        title,
        text: t(
          'tools:fold.refusal.sinkOutlineMixed.text',
          'The point’s outside edges are mountain folds and valley folds both: it has no one outside to turn inside out, so it cannot open-sink.'
        ),
      };
    case 'sink_no_axis':
      return {
        title,
        text: t(
          'tools:fold.refusal.sinkNoAxis.text',
          'Its outside does not run along two straight sides, so there is no centre line for an open sink’s line to be square to.'
        ),
      };
    case 'sink_line_tilted':
      return {
        title,
        text: t(
          'tools:fold.refusal.sinkLineTilted.text',
          'An open sink needs the line exactly square to the point’s centre line: tilted even a little, the point cannot open-sink. The square line at the same depth can.'
        ),
      };
    case 'sink_no_pocket':
      return {
        title,
        text: t(
          'tools:fold.refusal.sinkNoPocket.text',
          'No gap between its layers runs the whole way round its outside for the tip to go into, so it cannot closed-sink.'
        ),
      };
    case 'unsink_not_sunk':
      return {
        title,
        text: t(
          'tools:fold.refusal.unsinkNotSunk.text',
          'Nothing sunk lies inside the paper along this line. Locate the ring a sink left, and pick the sunk point inside it.'
        ),
      };
  }
}

/**
 * Why a flap of a reverse fold's tip has no opening (`NoOpening`), in a
 * folder's words. A crimp's tip opens as a reverse fold's does at its first
 * line, so it is refused for the same reasons, named as a crimp.
 */
function noOpening(t: TFunction, cause: FoldNoOpening, kind: FoldRefusalContext['kind']): string {
  switch (cause) {
    case 'no_spine':
      return kind === 'crimp'
        ? t(
            'tools:fold.refusal.crimpNoOpening.noSpine',
            'A single layer has no folded edge to crimp along. Crimp a flap of layers joined by a fold.'
          )
        : t(
            'tools:fold.refusal.reverseNoOpening.noSpine',
            'A single layer has no folded edge to reverse along. Reverse a flap of layers joined by a fold.'
          );
    case 'no_split':
      return t(
        'tools:fold.refusal.reverseNoOpening.noSplit',
        'Its layers cannot be parted along a fold without a lower layer ending up over an upper one.'
      );
    case 'no_body':
      return t(
        'tools:fold.refusal.reverseNoOpening.noBody',
        'Parted along its folds, one half would hang on nothing that stays put at the line.'
      );
    case 'bodies_cross':
      return t(
        'tools:fold.refusal.reverseNoOpening.bodiesCross',
        'Parted along its folds, the paper each half hangs on would cross the other’s.'
      );
  }
}

function otherWayLabel(t: TFunction, kind: FoldRefusalContext['kind']): string {
  switch (kind) {
    case 'valley':
      return t('tools:fold.fix.mountainInstead', 'Mountain fold instead');
    case 'mountain':
      return t('tools:fold.fix.valleyInstead', 'Valley fold instead');
    case 'precrease':
      return t('tools:fold.fix.precreaseOtherWay', 'Precrease the other way');
    // The engine never offers a reverse fold, a crimp or a sink the other way
    // round; it offers the other kind.
    case 'pleat':
    case 'reverse':
    case 'crimp':
    case 'sink':
      return t('tools:fold.fix.swapInstead', 'Swap the moving side');
    case 'tuck':
      return t('tools:fold.fix.tuckOtherWay', 'Tuck the other way');
    // A vertex fold's is its own button (`vertexFixActions`), whose words these are.
    case 'vertex':
      return t('tools:fold.vertex.fix.otherWay', 'Fold it the other way');
  }
}

/**
 * A pick-a-flap fix's button, in the words of the fold it narrows: the flap
 * by its number on screen, or — one the section does not show — as this flap.
 */
function pickFlapLabel(t: TFunction, kind: FoldRefusalContext['kind'], number: number | null): string {
  if (number === null) return pickThisFlapLabel(t, kind);
  switch (kind) {
    case 'reverse':
      return t('tools:fold.fix.reverseFlap', 'Reverse flap {{number}} only', { number });
    case 'crimp':
      return t('tools:fold.fix.crimpFlap', 'Crimp flap {{number}} only', { number });
    case 'tuck':
      return t('tools:fold.fix.tuckFlap', 'Tuck flap {{number}} only', { number });
    case 'sink':
      return t('tools:fold.fix.sinkFlap', 'Sink flap {{number}} only', { number });
    default:
      return t('tools:fold.fix.pickFlap', 'Fold flap {{number}} only', { number });
  }
}

/** A pick-a-flap fix's button for a flap no chip numbers. */
function pickThisFlapLabel(t: TFunction, kind: FoldRefusalContext['kind']): string {
  switch (kind) {
    case 'reverse':
      return t('tools:fold.fix.reverseThisFlap', 'Reverse this flap only');
    case 'crimp':
      return t('tools:fold.fix.crimpThisFlap', 'Crimp this flap only');
    case 'tuck':
      return t('tools:fold.fix.tuckThisFlap', 'Tuck this flap only');
    case 'sink':
      return t('tools:fold.fix.sinkThisFlap', 'Sink this flap only');
    default:
      return t('tools:fold.fix.pickThisFlap', 'Fold this flap only');
  }
}

/** The other kind's button: a reverse fold's, or a crimp's. */
function otherKindLabel(t: TFunction, kind: FoldRefusalContext['kind'], other: FoldReverseKind): string {
  if (kind === 'crimp') {
    return other === 'inside'
      ? t('tools:fold.fix.insideCrimpInstead', 'Inside crimp instead')
      : t('tools:fold.fix.outsideCrimpInstead', 'Outside crimp instead');
  }
  return other === 'inside'
    ? t('tools:fold.fix.insideInstead', 'Inside reverse fold instead')
    : t('tools:fold.fix.outsideInstead', 'Outside reverse fold instead');
}

/** A tuck's other-target button: the layer by its number in the list the stepper steps through. */
function tuckTargetLabel(t: TFunction, context: FoldRefusalContext, face: number): string {
  const under = context.tuck?.under ?? true;
  const number = context.tuck?.targetNumber(face) ?? null;
  if (number === null) {
    return under
      ? t('tools:fold.fix.tuckUnderAnother', 'Tuck under the layer that fits instead')
      : t('tools:fold.fix.tuckOverAnother', 'Tuck over the layer that fits instead');
  }
  return under
    ? t('tools:fold.fix.tuckUnder', 'Tuck under listed layer {{number}} instead', { number })
    : t('tools:fold.fix.tuckOver', 'Tuck over listed layer {{number}} instead', { number });
}

/**
 * A line fix's button: a near miss's landmark line, or a sliver remedy that
 * turns the line about a point it keeps (O5) or slides it along the line it
 * stays square to (O7) until the point lands exactly on the edge. A sink's
 * is the line square to its point's centre line, at the same depth.
 */
function lineFixLabel(t: TFunction, fix: FoldUseLineFix, kind: FoldRefusalContext['kind']): string {
  if (kind === 'sink' && !fix.step) return t('tools:fold.fix.useSquareLine', 'Use the square line');
  // A swivel whose edge ends before it would turn: the plain fold along the bisector lays it on the line.
  if (kind === 'vertex' && !fix.step) return t('tools:fold.fix.foldOntoLine', 'Fold the edge onto the line instead');
  const line = fix.step?.op.line;
  if (line?.via !== 'axiom') return t('tools:fold.fix.useLine', 'Use the landmark line');
  return line.axiom === 7
    ? t('tools:fold.fix.slideToEdge', 'Slide the line to land the point on the edge')
    : t('tools:fold.fix.turnToEdge', 'Turn the line to land the point on the edge');
}

function fixActions(
  t: TFunction,
  fix: FoldFix,
  position: number,
  context: FoldRefusalContext,
  verbs: FoldFixVerbs
): NoticeAction[] {
  const disabled = context.readOnly;
  // A vertex fold's fixes are its own buttons, the other direction among them.
  const vertex = context.vertex ? vertexFixActions(t, fix, position, disabled, context.vertex, verbs) : null;
  if (vertex) return vertex;
  switch (fix.fix) {
    case 'include_flaps': {
      const [only] = fix.flaps;
      if (only === undefined) return [];
      return [
        {
          id: `include-${position}`,
          label:
            fix.flaps.length === 1
              ? t('tools:fold.fix.includeFlap', 'Include flap {{number}}', { number: context.flapNumber(only) })
              : t('tools:fold.fix.includeFlaps', {
                  count: fix.flaps.length,
                  defaultValue_one: 'Include the {{count}} flap',
                  defaultValue_other: 'Include the {{count}} flaps',
                }),
          run: () => verbs.includeFlaps(fix.flaps),
          disabled,
        },
      ];
    }
    case 'opposite_direction':
      return [{ id: `other-way-${position}`, label: otherWayLabel(t, context.kind), run: verbs.foldOtherWay, disabled }];
    case 'pick_flap':
      // The engine may list only some of the section's flaps — those that
      // open, those a seed names — so each is numbered by where it is among
      // the section's: the chip that reads the same number. With no section
      // shown there are no chips, and the flaps are numbered as listed.
      return fix.flaps.map((flap, index) => {
        const at = context.flapOf ? context.flapOf(flap) : index;
        return {
          id: `pick-${position}-${index}`,
          label: pickFlapLabel(t, context.kind, at === null ? null : context.flapNumber(at)),
          run: () => verbs.pickFlap(flap),
          disabled,
        };
      });
    case 'use_line':
      return [
        { id: `line-${position}`, label: lineFixLabel(t, fix, context.kind), run: () => verbs.useLine(fix), disabled },
      ];
    case 'other_kind': {
      const { otherKind } = verbs;
      if (!otherKind) return [];
      return [
        {
          id: `kind-${position}`,
          label: otherKindLabel(t, context.kind, fix.kind),
          run: () => otherKind(fix.kind),
          disabled,
        },
      ];
    }
    case 'tuck_target': {
      const { tuckTarget } = verbs;
      if (!tuckTarget) return [];
      return [
        {
          id: `target-${position}`,
          label: tuckTargetLabel(t, context, fix.face),
          run: () => tuckTarget(fix.face),
          disabled,
        },
      ];
    }
    case 'use_emergent':
      // A rabbit ear's or a swivel's: its tool's button (`vertexFixActions`), above.
      return [];
    case 'other_sink': {
      const { otherSink } = verbs;
      if (!otherSink) return [];
      return [
        {
          id: `sink-${position}`,
          label:
            fix.kind === 'closed'
              ? t('tools:fold.fix.closedSinkInstead', 'Closed sink instead')
              : t('tools:fold.fix.openSinkInstead', 'Open sink instead'),
          run: () => otherSink(fix.kind),
          disabled,
        },
      ];
    }
  }
}

/** The notice for a refused fold: its words, and a button per fix the engine offers. */
/**
 * A refusal's words where nothing on screen can fix it — no flaps numbered,
 * no fixes offered: Repeat's window, when the engine refuses a source step's
 * mirror. The words the tool window says it in, for a fold of `kind` (and a
 * sink's tool, for a sink's).
 */
export function foldRefusalWords(
  t: TFunction,
  refusal: FoldRefused['refusal'],
  { kind, sink }: Pick<FoldRefusalContext, 'kind' | 'sink'>
): { title: string; text: string } {
  return words(
    t,
    { refusal, fixes: [] },
    { kind, ...(sink ? { sink } : {}), flapNumber: (flap) => flap + 1, flapOf: null, readOnly: true }
  );
}

export function foldRefusalNotice(
  t: TFunction,
  refused: FoldRefused,
  context: FoldRefusalContext,
  verbs: FoldFixVerbs
): FoldRefusalNoticeModel {
  return {
    code: refused.refusal.code,
    ...words(t, refused, context),
    actions: [
      ...refused.fixes.flatMap((fix, position) => fixActions(t, fix, position, context, verbs)),
      // What a vertex fold's tools can do where the engine offers no fix.
      ...(context.vertex ? vertexExtraActions(t, refused.refusal, context.readOnly, context.vertex, verbs) : []),
      // And what the Precrease tool can do with part of a line.
      ...(context.extent ? extentExtraActions(t, refused.refusal.code, context.extent, context.readOnly, verbs) : []),
      // And a point that stays put, where paper that folds lies at its spot.
      ...movingPointActions(t, refused, context, verbs),
      // And a reverse fold that took more flaps than its drawn line crosses.
      ...narrowerSeedActions(t, context, verbs),
    ],
  };
}

/** A reverse fold's button that folds only the flaps its drawn line crosses, when those land it. */
function narrowerSeedActions(t: TFunction, context: FoldRefusalContext, verbs: FoldFixVerbs): NoticeAction[] {
  const { useNarrowerSeed } = verbs;
  const flaps = context.narrowerSeed ?? [];
  const [only] = flaps;
  if (only === undefined || !useNarrowerSeed) return [];
  return [
    {
      id: 'narrower-seed',
      label:
        flaps.length === 1
          ? pickFlapLabel(t, context.kind, context.flapNumber(only))
          : t('tools:fold.fix.reverseCrossedFlaps', 'Reverse only the flaps the line crosses'),
      run: useNarrowerSeed,
      disabled: context.readOnly,
    },
  ];
}

/** A point that stays put: the button that takes the point at its spot on paper that folds, when one lands the fold. */
function movingPointActions(t: TFunction, refused: FoldRefused, context: FoldRefusalContext, verbs: FoldFixVerbs): NoticeAction[] {
  const { useMovingPoint } = verbs;
  if (refused.refusal.code !== 'mover_stays' || !context.movingPoint || !useMovingPoint) return [];
  return [
    {
      id: 'moving-point',
      label: t('tools:fold.fix.useMovingPoint', 'Use the point on the moving flap'),
      run: useMovingPoint,
      disabled: context.readOnly,
    },
  ];
}

/** The flaps a refusal's fixes say are in the way: the chips mark them. */
export function neededFlaps(refused: FoldRefused | null): Set<number> {
  const needed = new Set<number>();
  for (const fix of refused?.fixes ?? []) {
    if (fix.fix === 'include_flaps') fix.flaps.forEach((flap) => needed.add(flap));
  }
  return needed;
}
