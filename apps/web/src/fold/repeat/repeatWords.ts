import type { TFunction } from 'i18next';
import type { FoldModelLine, FoldOpKind } from '../document/foldSequenceDocument';
import { FOLD_VERTEX_OP_KINDS } from '../document/foldSequenceDocument';
import type { FoldRefusalBody, FoldRefusalCode } from '../engine/foldEngineWire';
import type { FoldSinkToolId } from '../tools/foldToolCatalog';
import { foldRefusalWords, type FoldRefusalContext } from '../tools/refusalNotice';

/**
 * Why a repeat stopped: Repeat's own code, or the engine's refusal of a
 * source step's mirror — its code, the refusal itself and the kind of step
 * it was, when the engine said. The code is analytics' (`fold refused`); the
 * words never show it.
 */
export interface RepeatStop {
  code: string;
  refusal?: FoldRefusalBody;
  op?: FoldOpKind;
}

/**
 * What Repeat's window lets the user change about a stopped repeat, which its
 * advice offers: another of the starting model's symmetry axes, and a range
 * that starts after the operation that stopped it (the range always ends at
 * the step on screen). Showing the steps individually is no remedy: it
 * changes how a repeat is saved, not whether it folds. Failing both, the
 * other side can still be folded with the tools, whose own window words
 * their refusals with fixes.
 */
export interface RepeatRemedies {
  otherAxis: boolean;
  laterStart: boolean;
}

const NO_REMEDIES: RepeatRemedies = { otherAxis: false, laterStart: false };

/** How near a named direction an axis is, in degrees, to be called by it. */
const AXIS_TOLERANCE_DEG = 0.01;

/**
 * A symmetry axis by where it runs on the paper, as the crease pattern pane
 * shows the sheet (front up, y up, never turned with the view): a diagonal
 * from corner to corner, a center line from edge to edge, or else the line
 * through the center at its angle from the horizontal, counter-clockwise. A
 * sheet's axes all cross its middle, so no two run the same way and each
 * name is the one axis.
 */
export function repeatAxisName(t: TFunction, line: FoldModelLine): string {
  // The line runs along (−n.y, n.x); its angle is taken modulo a half turn.
  const raw = (Math.atan2(line.n[0], -line.n[1]) * 180) / Math.PI;
  const angle = ((raw % 180) + 180) % 180;
  const near = (target: number) => Math.abs(angle - target) <= AXIS_TOLERANCE_DEG || Math.abs(angle - target - 180) <= AXIS_TOLERANCE_DEG;
  if (near(45)) return t('panels:fold.repeat.axisName.rising', 'Diagonal, bottom left to top right');
  if (near(135)) return t('panels:fold.repeat.axisName.falling', 'Diagonal, top left to bottom right');
  if (near(90)) return t('panels:fold.repeat.axisName.vertical', 'Center line, top to bottom');
  if (near(0)) return t('panels:fold.repeat.axisName.horizontal', 'Center line, left to right');
  return t('panels:fold.repeat.axisName.angle', 'Line through the center at {{degrees}}°', { degrees: Math.round(angle) });
}

/** What a refused step's words are read against: the fold family of the step whose mirror was refused. */
function refusalKindOf(op: FoldOpKind | undefined): Pick<FoldRefusalContext, 'kind' | 'sink'> {
  switch (op) {
    case 'mountain':
    case 'precrease':
    case 'pleat':
    case 'crimp':
    case 'tuck':
      return { kind: op };
    case 'inside-reverse':
    case 'outside-reverse':
      return { kind: 'reverse' };
    case 'open-sink':
    case 'closed-sink':
    case 'unsink':
      return { kind: 'sink', sink: { tool: op satisfies FoldSinkToolId } };
    default:
      return (FOLD_VERTEX_OP_KINDS as readonly string[]).includes(op ?? '') ? { kind: 'vertex' } : { kind: 'valley' };
  }
}

/**
 * The engine refusals whose tool-window words are a reason and nothing more:
 * Repeat says them as the window does. The others' words end in advice for
 * the tool in hand — pick again, swap the moving side, draw the line again —
 * which a repeat has no control for, so Repeat says their reason in a
 * headline (the window's title) or, for the refusals of a plain fold's own
 * picks and line, in a sentence of its own about the mirrored fold
 * (`mirrorReason`).
 */
const REASON_ONLY: ReadonlySet<FoldRefusalCode> = new Set<FoldRefusalCode>([
  'near_miss',
  'layer_order',
  'short_crease',
  'thin_piece',
  'degenerate_split',
  'sliver',
  'precrease_unfold_moved_more',
]);

/**
 * A mirrored fold's refusal of its own picks and line, said of the mirror:
 * the tool's words speak of a spot, a line or references the user picked,
 * and in a repeat the user picked none of them. Null for the rest.
 */
function mirrorReason(t: TFunction, code: FoldRefusalCode): string | null {
  switch (code) {
    case 'witness_not_in_face':
    case 'seed_not_on_moving_side':
      return t(
        'panels:fold.repeat.mirror.pickAgain',
        'The spot the mirrored fold picks is not inside a layer on the moving side.',
      );
    case 'no_moving_side':
      return t('panels:fold.repeat.mirror.noMovingSide', 'No paper lies on the side of the mirrored line that would move.');
    case 'empty_seed':
      return t('panels:fold.repeat.mirror.emptySeed', 'The mirrored fold picks no layer to move.');
    case 'nothing_stays':
      return t(
        'panels:fold.repeat.mirror.nothingStays',
        'Every layer is on the moving side of the mirrored line, so nothing would stay put.',
      );
    case 'closure_adds_flaps':
      return t('panels:fold.repeat.mirror.closureAddsFlaps', 'Folding the mirrored layers would move other flaps too.');
    case 'point_off_paper':
    case 'segment_too_short':
    case 'segment_not_on_a_face':
    case 'crease_not_found':
      return t(
        'panels:fold.repeat.mirror.offPaper',
        'A point or edge the mirrored line is located from does not lie on the paper as it is folded now.',
      );
    case 'free_line_too_short':
      return t(
        'panels:fold.repeat.mirror.pointsTooClose',
        'The mirrored line’s two points land in the same place on the folded paper, so they make no line.',
      );
    case 'no_root':
      return t('panels:fold.repeat.mirror.noRoot', 'The mirrored references give no fold line on the paper as it is folded.');
    case 'no_side':
    case 'side_on_line':
      return t('panels:fold.repeat.mirror.noSide', 'Nothing says which side of the mirrored line moves.');
    case 'mover_stays':
      return t(
        'panels:fold.repeat.mirror.moverStays',
        'The layer that carries the point to move is not among the layers the mirrored fold moves.',
      );
    case 'crease_not_flat':
    case 'crease_not_folded':
      return t(
        'panels:fold.repeat.mirror.wrongCrease',
        'The mirrored line does not run along a folded edge to unfold, or a flat crease to refold.',
      );
    case 'budget_exceeded':
      return t(
        'panels:fold.repeat.mirror.budget',
        'Working out how the mirrored layers stack took too long, so it is not known whether they fit.',
      );
    default:
      return null;
  }
}

/** What to try instead, from what the window lets the user change (`RepeatRemedies`). */
function repeatAdvice(t: TFunction, { otherAxis, laterStart }: RepeatRemedies): string {
  if (otherAxis && laterStart)
    return t('panels:fold.repeat.advice.axisOrLater', 'Try another axis, or start the range after this operation.');
  if (otherAxis)
    return t('panels:fold.repeat.advice.axis', 'Try another axis, or fold the other side with the tools.');
  if (laterStart)
    return t(
      'panels:fold.repeat.advice.later',
      'Start the range after this operation, or fold the other side with the tools.',
    );
  return t('panels:fold.repeat.advice.tools', 'Fold the other side with the tools instead.');
}

/** A reason said in a full sentence, then what to try instead. */
function withAdvice(t: TFunction, reason: string, remedies: RepeatRemedies | null): string {
  if (remedies === null) return reason;
  return t('panels:fold.repeat.reasonAdvice', '{{reason}} {{advice}}', { reason, advice: repeatAdvice(t, remedies) });
}

/**
 * Why a repeat stopped, and what to try instead. Repeat's own reasons are in
 * its words. A source step's mirror the engine refused keeps the engine's
 * reason — the tool window's words when they are a reason alone, else
 * Repeat's sentence about the mirror or the window's headline — and ends in
 * advice for what Repeat's window can change (`RepeatRemedies`), never the
 * advice of the tool the step was folded with.
 */
export function repeatFailure(t: TFunction, stop: RepeatStop, remedies: RepeatRemedies | null = NO_REMEDIES): string {
  switch (stop.code) {
    case 'repeat_return_target':
      return t(
        'panels:fold.repeat.returnTarget',
        'This unfold returns to a step before the selected range. Include that part of the sequence in the repeat.',
      );
    case 'repeat_view_axis':
      return t(
        'panels:fold.repeat.viewAxis',
        'This range needs a turn-over about an oblique axis. Repeat the folds separately from that view change.',
      );
    case 'repeat_axis':
      return t(
        'panels:fold.repeat.noAxis',
        'This starting model has no verified matching pair of sides. Choose a different range.',
      );
    case 'repeat_swivel_behind':
      return t(
        'panels:fold.repeat.swivelBehind',
        'On the other side, this swivel’s valley and mountain lie on the layer behind. Turn the model over and make the swivel there.',
      );
    case 'repeat_pleat_behind':
      return t(
        'panels:fold.repeat.pleatBehind',
        'Seen from the other side, this pleat’s mountain and valley trade places, which a pleat step cannot record. Turn the model over and make the pleat there.',
      );
    case 'repeat_ambiguous':
      return withAdvice(
        t,
        t(
          'panels:fold.repeat.ambiguous',
          'The mirrored operation lands two different ways that both match the original, so which one is meant is not known.',
        ),
        remedies,
      );
    case 'repeat_nothing':
      return t(
        'panels:fold.repeat.nothing',
        'Every operation in the range is its own mirror across this axis, so repeating it changes nothing. Choose another axis or range.',
      );
    case 'repeat_unsupported':
      return t(
        'panels:fold.repeat.unsupported',
        'This range includes a Collapse or another Repeat that cannot yet be mirrored. Choose a range of fold operations.',
      );
    case 'repeat_limit':
    case 'repeat_order_limit':
      return t('panels:fold.repeat.limit', 'This repeat exceeds the search limit. Try a shorter range.');
    case 'repeat_order':
      return withAdvice(
        t,
        t('panels:fold.repeat.orderConflict', 'The original layer relationships cannot be preserved on the other side.'),
        remedies,
      );
    case 'repeat_reference':
      return withAdvice(
        t,
        t('panels:fold.repeat.reference', 'A reference does not have a matching point on the other side.'),
        remedies,
      );
    case 'repeat_extra_material':
    case 'repeat_material':
    case 'repeat_creases':
      return withAdvice(
        t,
        t(
          'panels:fold.repeat.materialConflict',
          'Repeating would change additional paper or creases. The two sides cannot be folded independently in this range.',
        ),
        remedies,
      );
    case 'repeat_unavailable':
      return t(
        'panels:fold.repeat.unavailable',
        'The source states are unavailable or changed. Wait for replay, then reopen Repeat.',
      );
    default:
      return stop.refusal ? mirrorRefusal(t, stop.refusal, stop.op, remedies) : withAdvice(
        t,
        t('panels:fold.repeat.refusedPlain', 'The mirrored operation cannot be folded. No steps were added.'),
        remedies,
      );
  }
}

/** The engine's refusal of a source step's mirror: its reason, then Repeat's advice. */
function mirrorRefusal(t: TFunction, refusal: FoldRefusalBody, op: FoldOpKind | undefined, remedies: RepeatRemedies | null): string {
  const own = mirrorReason(t, refusal.code);
  if (own) return withAdvice(t, own, remedies);
  const words = foldRefusalWords(t, refusal, refusalKindOf(op));
  if (REASON_ONLY.has(refusal.code)) return withAdvice(t, words.text, remedies);
  // A headline has no full stop of its own, unless it asks a question.
  if (/[.?!。？！]$/.test(words.title)) return withAdvice(t, words.title, remedies);
  if (remedies === null) return t('panels:fold.repeat.headlineReason', '{{reason}}.', { reason: words.title });
  return t('panels:fold.repeat.headlineAdvice', '{{reason}}. {{advice}}', {
    reason: words.title,
    advice: repeatAdvice(t, remedies),
  });
}

/**
 * Why the repeat across an axis is refused, in a line, with no advice: what
 * the axis list says under an axis it offers disabled. `step` is the source
 * operation it stopped at (0-based), when it stopped at one.
 */
export function repeatAxisRefusal(t: TFunction, stop: RepeatStop, step: number | null): string {
  const reason = repeatFailure(t, stop, null);
  return step === null || stop.code === 'repeat_nothing'
    ? reason
    : t('panels:fold.repeat.axisStopsAt', 'Stops at operation {{number}}: {{reason}}', { number: step + 1, reason });
}
