import { Navigate, useLocation, useParams } from 'react-router-dom';
import { EDIT_PATH } from './paths';
import { isShareId, readShareFragment } from '../lib/shareLink';
import { inlinedSharedCp } from '../cp-workspace/share/sharedCpBootstrap';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { PendingSharedCp } from '../store/workspaceStore/types';

/**
 * Landing route for a share link.
 *
 * Handles all three ways one can arrive, in order of preference:
 *
 * 1. `/s/<id>` where the server inlined the crease pattern into the page — the normal
 *    case, and the fast one: no request, so the pattern is there at first paint.
 * 2. `/s/<id>` with nothing inlined — a hand-typed URL, or a link opened inside the
 *    ~60s KV takes to propagate. Resolved by a fetch, later, on the Edit surface.
 * 3. `/s#<payload>` — the original fragment scheme. Links already shared must not break.
 *
 * It does exactly two things: hand the intent to the store, and redirect to Edit. It
 * deliberately does **not** decode, fetch, or provision anything — routing decides
 * intent, surfaces self-provision. The work happens in `ensureEditCreasePattern`, the
 * same seam that otherwise creates a blank document, so there is one provisioning path
 * rather than two.
 *
 * The redirect is what makes this simpler than reading the URL on `/edit`: the share
 * leaves the URL as soon as it is captured, so a refresh cannot re-import it over work
 * in progress and no reload guard is needed.
 *
 * Capturing during render rather than in an effect is deliberate — the redirect below
 * unmounts this component immediately, so an effect would race it. The write is
 * idempotent, which is what makes it safe under StrictMode's double render.
 */
export function ShareRoute() {
  const { hash } = useLocation();
  const { shareId } = useParams<{ shareId?: string }>();

  const pending = resolvePendingShare(shareId, hash);
  if (pending) {
    const store = useWorkspaceStore.getState();
    if (!isSamePending(store.pendingSharedCp, pending)) store.setPendingSharedCp(pending);
  }

  // A `/s` with nothing usable is a link someone truncated; Edit's normal empty state is
  // a better answer than an error screen.
  return <Navigate to={EDIT_PATH} replace />;
}

function resolvePendingShare(shareId: string | undefined, hash: string): PendingSharedCp | null {
  if (shareId && isShareId(shareId)) {
    const inlined = inlinedSharedCp();
    // Trust the inlined payload only when it is the share actually being opened; a stale
    // one from a previous navigation would silently load the wrong pattern.
    if (inlined && inlined.id === shareId) {
      return { kind: 'payload', payload: inlined.payload };
    }
    return { kind: 'id', shareId };
  }

  const payload = readShareFragment(hash);
  return payload ? { kind: 'payload', payload } : null;
}

function isSamePending(a: PendingSharedCp | null, b: PendingSharedCp): boolean {
  if (!a || a.kind !== b.kind) return false;
  return a.kind === 'payload' && b.kind === 'payload'
    ? a.payload === b.payload
    : a.kind === 'id' && b.kind === 'id' && a.shareId === b.shareId;
}
