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
    default:
      return formatUnknownError(error);
  }
}
