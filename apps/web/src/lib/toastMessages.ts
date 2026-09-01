import type { TFunction } from 'i18next';

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
}

/** The `code` of a `{ code, message }` engine error envelope, if present. */
function errorEnvelopeCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

/**
 * A human-readable description for an engine error. Structural fold failures
 * (from `to_js_folding_error`) carry a stable `code` and an opaque Rust Debug
 * string as their message; translate the known codes to a plain-language
 * explanation and fall back to the raw message for everything else. Literal
 * `t()` calls so the i18n extractor can see the keys.
 */
export function humanizeError(error: unknown, t: TFunction): string {
  switch (errorEnvelopeCode(error)) {
    // Worker failures (see lib/workerDiagnostics.ts). The raw event message is
    // never useful ("uncaught exception in worker"), and what the user needs to
    // know is which capability just stopped and that reopening restores it.
    case 'worker_treemaker':
      return t(
        'errors:worker.treemaker',
        'The design engine stopped unexpectedly. Reload Ori Studio to continue working on this tree.'
      );
    case 'worker_oristudio_cp':
      return t(
        'errors:worker.oristudioCp',
        'The crease-pattern engine stopped unexpectedly. Reload Ori Studio — unsaved edits since the last save may be lost.'
      );
    // Share-link failures. The kernel's own message is precise but internal
    // ("payload is too short: need at least 16 bytes"); what the user needs is
    // which of the two things went wrong, because only one of them is fixable
    // by them.
    case 'share_link_invalid':
      return t(
        'errors:shareLink.invalid',
        'That share link is incomplete or damaged — it was probably cut short when it was copied. Ask for it again.'
      );
    case 'share_link_too_new':
      return t(
        'errors:shareLink.tooNew',
        'That share link was made with a newer version of Ori Studio. Reload to get the latest version, then open it again.'
      );
    // Failures from the share service. Each says what the person can actually do:
    // wait, shrink the pattern, or nothing at all.
    // Reached only after the retry window has run out. We genuinely cannot tell "never
    // existed" from "not propagated yet" — KV takes up to a minute globally — so the copy
    // does not claim either.
    case 'not_found':
      return t(
        'errors:shareLink.notFound',
        "Couldn't open this share link. If it was just created, try again in a moment."
      );
    case 'rate_limited':
      return t(
        'errors:shareLink.rateLimited',
        'Too many share links from this connection. Wait a few minutes and try again.'
      );
    case 'payload_too_large':
      return t(
        'errors:shareLink.tooLarge',
        'This crease pattern is too large to share as a link. Export it as a file instead.'
      );
    // Deliberately vague. The quota does reset at a known instant (00:00 UTC), but the
    // classification behind this code is a regex over the thrown message — naming a time
    // would send someone away for hours whenever that heuristic misfires on an unrelated
    // failure. A vague true message beats a precise false one.
    case 'storage_quota':
      return t(
        'errors:shareLink.storageQuota',
        'Sharing is temporarily unavailable. Please try again later.'
      );
    case 'storage_failure':
      return t(
        'errors:shareLink.storageFailure',
        "Couldn't create a share link. Check your connection and try again."
      );
    case 'worker_oristudio_bp':
    case 'worker_oristudio_bp_optimizer':
      return t(
        'errors:worker.oristudioBp',
        'The box-pleating engine stopped unexpectedly. Reload Ori Studio to continue working on this design.'
      );
    case 'worker_simulator':
      return t(
        'errors:worker.simulator',
        'The simulator stopped unexpectedly. Reopen the Simulate workspace to restart it.'
      );
    case 'worker_cp_detect':
      return t(
        'errors:worker.cpDetect',
        'Crease-pattern detection stopped unexpectedly. Try importing the image again.'
      );
    // Project files we read and rejected (see lib/projectFileError.ts). Their
    // own messages are precise but internal ("field workspace.documents must be
    // an array"); all the user can act on is which of these three it is.
    case 'project_file_too_new':
      return t(
        'errors:projectFile.tooNew',
        'This project was saved by a newer version of Ori Studio. Update Ori Studio, then open it again.'
      );
    case 'project_file_unrecognized':
      return t('errors:projectFile.unrecognized', "This file isn't an Ori Studio project.");
    case 'project_file_damaged':
      return t(
        'errors:projectFile.damaged',
        "This Ori Studio project can't be read. It may be damaged, or saved by a version this app doesn't support."
      );
    case 'fold_same_parity':
      return t(
        'errors:fold.sameParity',
        "This crease pattern can't be folded flat: two faces meet with the same orientation across a crease."
      );
    // The same parity failure, when the kernel could say *why*. A border segment
    // with paper on both sides is a cut through the sheet, and the folder reads
    // it as a crease — so the raw verdict above names some unrelated crease
    // instead. `fold_interior_cut` is the flat twin of the 3D `interior_cut`
    // refusal, and is worded to match it.
    case 'fold_interior_cut':
      return t(
        'errors:fold.interiorCut',
        "This crease pattern can't be folded: an edge line runs through the middle of the paper, with paper on both sides of it. Remove it, or make it a crease."
      );
    // A fold that produced nothing. The kernel's step ladder stops at step 1
    // when the arrangement cannot be traced, and used to hand back a folded
    // figure with no faces in it and no error at all — see `fold_segments`.
    // Same sentence as the 3D refusal, because it is the same geometry.
    case 'fold_faces_unresolved':
      return t(
        'dialogs:fold3dRefused.facesUnresolved',
        'The faces of this crease pattern could not be worked out. Creases that cross without a vertex, or stop short of one, are the usual cause.'
      );
    case 'fold_layer_search':
      return t(
        'errors:fold.layerSearch',
        "This crease pattern couldn't be folded: its layers can't be arranged without overlap."
      );
    case 'fold_contradiction':
      return t(
        'errors:fold.contradiction',
        "This crease pattern isn't flat-foldable: some faces have no consistent stacking order."
      );
    // The walk places faces by stepping across creases, so it can only ever
    // reach one connected piece. Two designs on one canvas is the ordinary way
    // to get here, and it is fixable by selecting one of them.
    case 'fold_disconnected':
      return t(
        'errors:fold.disconnected',
        "This selection falls into separate pieces that don't touch, so it can't be folded as one model. Select one piece and fold again."
      );
    // Both of these mean the *caller* routed a fold to the wrong door, not that
    // anything is wrong with the crease pattern — `resolveFoldRoute` decides
    // which folder a selection goes to, and both kernel guards are assertions
    // it holds. Worded anyway, because unreachable-by-design is not the same as
    // unreachable, and the alternative is raw Rust English in eight locales.
    case 'fold_needs_3d':
      return t(
        'errors:fold.needs3d',
        "Some of these creases fold to an angle other than a full mountain or valley, so they have no flat folded form. Try folding again — if it keeps happening, the app and the crease pattern have got out of step."
      );
    case 'fold_is_flat':
      return t(
        'errors:fold.isFlat',
        'These creases are all full mountain and valley folds, so they fold flat rather than into a 3D shape.'
      );
    // A `foldedForm` frame the export declines to write, having measured how
    // big it would be first. The cap sits about forty times above the widest
    // frame any admitted corpus model produces, so nothing short of a pattern
    // far outside anything measured reaches this — but a 20 MB frame is a file
    // nothing can open, and refusing it beats writing it.
    case 'folded_form_too_large':
      return t(
        'errors:fold.foldedFormTooLarge',
        'This folded figure is too large to write into a FOLD file. Export the crease pattern on its own, or save the project as .osf, which keeps the figure.'
      );
    // A FOLD file we decline to open, rather than one we failed to read. The
    // importer keeps x and y and drops the rest, so a folded model would arrive
    // as its own flat shadow with every crease in the wrong place.
    case 'fold_folded_form':
      return t(
        'errors:fold.foldedForm',
        'This FOLD file holds a folded model rather than a crease pattern, so there are no creases to open. Open the crease pattern it was folded from instead.'
      );
    default:
      return formatUnknownError(error);
  }
}
