/**
 * The From Fold… browser's card pictures (plan D17): each card the step it
 * would add, captured as the pull captures it (`captureFoldTarget`) — its
 * state spread as the step will be, its fold's line, arrow and circles
 * lifted — and made the step a pull makes (`sentStep`), which the card draws
 * as a Diagram card draws a step. Until 2026-11-03 the cards showed Fold's
 * strip pictures: the state a step lands, with no marks.
 *
 * A capture asks the engine about the step's states and, spread, solves the
 * layers — a fraction of a second, more for a dense state — so:
 *
 * - **Kept by what it is of** (`FoldPullPreviewRequest.key`): a capture made
 *   is shown again at once, in the browser opened again too.
 * - **Asked as a card comes near the view**, and made one at a time in the
 *   order asked; one no card wants any more by its turn — the browser
 *   closed — is passed over.
 * - **Capped** at {@link MAX_PREVIEWS}, the oldest a card does not show let
 *   go first. One that came to nothing is let go once no card shows it, so
 *   the next card to want it asks again.
 *
 * The capture is injected: the app's is the Fold session's
 * (`useFoldPullPreview.ts`), a test's a fake.
 *
 * React-free.
 */
import { createStore } from 'zustand/vanilla';
import { reportError } from '../../monitoring';
import type { DiagramStep } from '../document/diagramDocument';
import type { FoldPullPreviewRequest } from './foldPull';

/** A card's picture, as the step it would add; null when there is none to draw. */
export type FoldPullPreview = DiagramStep | null;

/** Make the step a card's request would add. */
export type FoldPullPreviewCapture = (request: FoldPullPreviewRequest) => Promise<FoldPullPreview>;

/** How many previews are kept, beyond those a card shows. */
export const MAX_PREVIEWS = 64;

/** The previews made, by key, oldest first. */
export const foldPullPreviews = createStore<{ byKey: ReadonlyMap<string, FoldPullPreview> }>(() => ({
  byKey: new Map(),
}));

interface PreviewJob {
  request: FoldPullPreviewRequest;
  capture: FoldPullPreviewCapture;
}

const queue: PreviewJob[] = [];
/** How many mounted cards want each key. */
const wanted = new Map<string, number>();
/** The key being captured now, if any: one capture at a time. */
let capturing: string | null = null;

/**
 * A card wants `request`'s picture: captured by `capture` unless it is kept,
 * queued or being captured. Returns what lets it go.
 */
export function wantFoldPullPreview(request: FoldPullPreviewRequest, capture: FoldPullPreviewCapture): () => void {
  const { key } = request;
  wanted.set(key, (wanted.get(key) ?? 0) + 1);
  const known = foldPullPreviews.getState().byKey.has(key) || capturing === key;
  if (!known && !queue.some((job) => job.request.key === key)) {
    queue.push({ request, capture });
    void drain();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release(key);
  };
}

function release(key: string): void {
  const count = (wanted.get(key) ?? 0) - 1;
  if (count > 0) {
    wanted.set(key, count);
    return;
  }
  wanted.delete(key);
  const { byKey } = foldPullPreviews.getState();
  if (byKey.get(key) !== null) return;
  const next = new Map(byKey);
  next.delete(key);
  foldPullPreviews.setState({ byKey: next });
}

/** Keep a preview, newest last, then let go of the oldest past the cap that no card shows. */
function keep(key: string, preview: FoldPullPreview): void {
  // Nothing to draw, and no card to say so: the next card to want it asks again.
  if (preview === null && !wanted.has(key)) return;
  const next = new Map(foldPullPreviews.getState().byKey);
  next.delete(key);
  next.set(key, preview);
  for (const oldest of [...next.keys()]) {
    if (next.size <= MAX_PREVIEWS) break;
    if (!wanted.has(oldest)) next.delete(oldest);
  }
  foldPullPreviews.setState({ byKey: next });
}

/** Capture the queue, one at a time, in the order asked: a job no card wants any more is passed over. */
async function drain(): Promise<void> {
  if (capturing !== null) return;
  for (let job = queue.shift(); job; job = queue.shift()) {
    const { key } = job.request;
    if (!wanted.has(key) || foldPullPreviews.getState().byKey.has(key)) continue;
    capturing = key;
    let preview: FoldPullPreview = null;
    try {
      preview = await job.capture(job.request);
    } catch (error) {
      // Not the user's to act on: the card says it can't be drawn, and the step itself is captured at Add.
      reportError(error, { surface: 'diagram:fold-browser-preview' });
    }
    capturing = null;
    keep(key, preview);
  }
}

/** Forget every preview and every job: for tests. */
export function clearFoldPullPreviews(): void {
  queue.length = 0;
  wanted.clear();
  capturing = null;
  foldPullPreviews.setState({ byKey: new Map() });
}
