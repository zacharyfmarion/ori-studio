/**
 * The DOM contract between the Worker that serves `/s/<id>` and the client that reads it.
 *
 * Owned in one place because the two sides fail *silently* when they disagree: the client
 * simply finds no element, falls back to fetching the share by id, and everything still
 * works — just with the extra KV read and the first-paint delay the inlining exists to
 * avoid. Nothing errors, so a drift here would show up only as a slow, unexplained rise in
 * read volume.
 *
 * Deliberately dependency-free: this is bundled into a Worker, where anything touching
 * `document` would not merely be dead weight but a crash.
 */

/** Id of the `<script type="application/json">` carrying the inlined crease pattern. */
export const SHARED_CP_SCRIPT_ID = 'shared-cp';
