/**
 * What the Layer order dialog says when it has no session to show: each
 * refusal of an open by its code (E4, E5), an engine that went away and one
 * that never loaded (offline), as the approved refusal frames word them
 * (`Round4-States`, "Refusals"); and
 * why Apply could not save. Host-neutral: the same sentence in Edit, the
 * Diagram and Pose, and never an upstream's name or a host's.
 *
 * "Stopped unexpectedly" is for an engine that failed (a crash, a trap, a
 * defect); a browser that failed to load it always gets the connection's
 * sentence (`LayerOrderSessionLoss`).
 *
 * Copy only: `t` with literal keys, so the extractor sees every string.
 */
import type { TFunction } from 'i18next';
import type { FaceLetters } from '../../layer-order/engine/faceIndex';
import type { LayerRefusal } from '../../layer-order/engine/layerOrderEngine';
import type { LayerOrderSessionStatus } from '../../layer-order/dialog/useLayerOrderSession';
import type { NoticeTone } from '../ui/Notice';

/** What the notice offers: Keep trying an open that ran out (a later deadline), Try again after a loss, or nothing. */
export type LayerOrderNoticeRetry = 'keep_trying' | 'try_again' | null;

export interface LayerOrderNotice {
  readonly text: string;
  readonly retry: LayerOrderNoticeRetry;
  /** A refusal or a loss is `danger`; an open that only ran out of time is the quiet `info`. */
  readonly tone: NoticeTone;
}

/** What the notice names: the faces' letters, and what the host calls the fold. */
export interface LayerOrderNoticeContext {
  readonly letters: FaceLetters | null;
  readonly name?: string;
}

/** The notice in place of the folded pane and the inspector, or null while the session opens or is open. */
export function sessionNotice(
  t: TFunction,
  status: LayerOrderSessionStatus,
  context: LayerOrderNoticeContext
): LayerOrderNotice | null {
  if (status.kind === 'lost') {
    return {
      text:
        status.cause === 'load'
          ? t('dialogs:layerOrder.lostLoad', 'Layer order couldn’t load. Check your connection, then try again.')
          : t('dialogs:layerOrder.lost', 'Layer order stopped unexpectedly. Nothing was changed.'),
      retry: 'try_again',
      tone: 'danger',
    };
  }
  if (status.kind !== 'refused') return null;
  const { refusal } = status;
  if (refusal.code === 'session_timed_out') {
    return {
      text: t('dialogs:layerOrder.refused.timedOut', 'Couldn’t work out this figure’s layer orders in time.'),
      retry: 'keep_trying',
      tone: 'info',
    };
  }
  return { text: refusalText(t, refusal, context), retry: null, tone: 'danger' };
}

function refusalText(t: TFunction, refusal: LayerRefusal, { letters, name }: LayerOrderNoticeContext): string {
  switch (refusal.code) {
    case 'source_non_convex_face': {
      const face = letters?.letterOf(refusal.face) ?? '';
      return face
        ? t(
            'dialogs:layerOrder.refused.nonConvexFace',
            'Face {{face}} isn’t convex. Layer order can’t work with non-convex faces yet.',
            { face }
          )
        : t(
            'dialogs:layerOrder.refused.nonConvex',
            'A face of this figure isn’t convex. Layer order can’t work with non-convex faces yet.'
          );
    }
    case 'source_digest_mismatch':
      return name
        ? t(
            'dialogs:layerOrder.refused.digestMismatchNamed',
            'Layer order couldn’t match its faces to the ones this figure was folded with, so it can’t open on {{name}}. Nothing was changed.',
            { name }
          )
        : t(
            'dialogs:layerOrder.refused.digestMismatch',
            'Layer order couldn’t match its faces to the ones this figure was folded with, so it can’t open on it. Nothing was changed.'
          );
    case 'session_no_order':
      return t('dialogs:layerOrder.refused.noOrder', 'Layer order couldn’t be determined for this figure.');
    case 'source_ambiguous_overlap':
      return t(
        'dialogs:layerOrder.refused.ambiguousOverlap',
        'Some of this figure’s faces overlap too closely to tell which covers which, so Layer order can’t open on it. Nothing was changed.'
      );
    case 'source_tolerance':
      return t(
        'dialogs:layerOrder.refused.tolerance',
        'Some of this figure’s faces or creases are too small or too close together for Layer order to work with. Nothing was changed.'
      );
    case 'source_stacked_too_deep':
      return t(
        'dialogs:layerOrder.refused.tooDeep',
        'This figure stacks {{depth}} layers in one place, more than Layer order can work with yet. Nothing was changed.',
        { depth: refusal.deepest }
      );
    case 'source_too_many_faces':
      return t(
        'dialogs:layerOrder.refused.tooManyFaces',
        'This figure has {{faces}} faces, more than the {{limit}} Layer order can work with. Nothing was changed.',
        { faces: refusal.face_count, limit: refusal.limit }
      );
    case 'source_no_faces':
      return t('dialogs:layerOrder.refused.noFaces', 'This figure has no faces to put in order.');
    case 'record_newer':
      return t(
        'dialogs:layerOrder.refused.recordNewer',
        'Made with a newer Ori Studio: its layer constraints can’t be changed here.'
      );
    case 'record_over_budget':
      return t(
        'dialogs:layerOrder.refused.recordTooLarge',
        'This figure’s saved constraints are too large to open. Nothing was changed.'
      );
    case 'record_damaged':
    case 'session_bad_record':
      return t(
        'dialogs:layerOrder.refused.recordUnreadable',
        'This figure’s saved constraints couldn’t be read, so Layer order can’t open on them. Nothing was changed.'
      );
    case 'source_kernel':
    case 'source_same_parity':
    case 'session_timed_out':
      return t(
        'dialogs:layerOrder.refused.unreadable',
        'Layer order couldn’t read how this figure folds, so it can’t open on it. Nothing was changed.'
      );
  }
}

/** Why Apply waits, by U9's reasons (`applyBlocker`, D10). */
export type LayerOrderApplyWait = 'opening' | 'refused' | 'busy' | 'clash' | 'unsettled';

/** Apply's title while it waits, for each of U9's reasons; the clash's is the board's (Round4-States, "The clashing set"). */
export function applyWaitText(t: TFunction, why: LayerOrderApplyWait): string {
  switch (why) {
    case 'opening':
      return t('dialogs:layerOrder.applyOpening', 'Nothing to apply yet');
    case 'refused':
      return t('dialogs:layerOrder.applyNothing', 'Nothing to apply');
    case 'busy':
      return t('dialogs:layerOrder.applyBusy', 'Wait for the check to finish');
    case 'clash':
      return t('dialogs:layerOrder.applyClash', 'Remove one of the clashing constraints to apply');
    case 'unsettled':
      return t('dialogs:layerOrder.applyUnsettled', 'The saved constraints haven’t been checked yet');
  }
}

/**
 * What Apply also does, at the foot beside it, for a host whose picture was
 * folded from creases that have changed since (D12, the approved "Stale
 * figure: Apply also refolds" frame): named, when the host names its fold.
 */
export function applyRefoldsText(t: TFunction, name: string | undefined): string {
  return name
    ? t('dialogs:layerOrder.applyRefoldsNamed', '{{name}}’s creases changed since it was folded: Apply also refolds it.', {
        name,
      })
    : t('dialogs:layerOrder.applyRefolds', 'The creases changed since this was folded: Apply also refolds it.');
}

/** Why Apply could not save: its record is over the budget, or the save refused for another reason. */
export function applyRefusalText(t: TFunction, refusal: LayerRefusal): string {
  return refusal.code === 'record_over_budget'
    ? t('dialogs:layerOrder.applyRefused.tooLarge', 'This layer order is too large to save with the figure.')
    : t('dialogs:layerOrder.applyRefused.other', 'Couldn’t save this layer order. Nothing was changed.');
}
