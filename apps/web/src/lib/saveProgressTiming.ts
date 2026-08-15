/**
 * When a save is worth mentioning.
 *
 * Same rule as the folding indicator, and the same reason: most saves finish in
 * a few hundred milliseconds and an indicator that appears for 80ms reads as a
 * glitch. What makes a save different is that it *ends* in a confirmation
 * ("{{name}} saved"), so the spinner does not have to linger as long — it is
 * replaced rather than simply removed.
 */
export const SAVE_TOAST_DELAY_MS = 500;
export const SAVE_TOAST_MIN_VISIBLE_MS = 800;

/**
 * When a save has run long enough that "Saving…" stops being reassuring and the
 * user deserves to know why. A project embedding tens of megabytes of reference
 * images is the usual answer.
 */
export const SAVE_LONG_RUN_MS = 5_000;
