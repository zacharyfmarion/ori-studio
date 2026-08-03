import { Navigate, useLocation } from 'react-router-dom';
import { EDIT_PATH } from './paths';
import { readShareFragment } from '../lib/shareLink';
import { useWorkspaceStore } from '../store/workspaceStore';

/**
 * Landing route for a share link (`/s#<payload>`).
 *
 * It does exactly two things: hand the raw payload to the store as pending
 * intent, and redirect to Edit. It deliberately does **not** decode or provision
 * anything — routing decides intent, surfaces self-provision. The decode happens
 * in `ensureEditCreasePattern`, the same seam that otherwise creates a blank
 * document, so there is one provisioning path rather than two.
 *
 * The redirect is what makes this simpler than reading the fragment on `/edit`:
 * the payload leaves the URL as soon as it is captured, so a refresh cannot
 * re-import it over work in progress and no reload guard is needed.
 *
 * Capturing during render rather than in an effect is deliberate — the redirect
 * below unmounts this component immediately, so an effect would race it. The
 * write is idempotent (same payload, same value), which is what makes it safe
 * under StrictMode's double render.
 */
export function ShareRoute() {
  const { hash } = useLocation();
  const payload = readShareFragment(hash);

  if (payload && useWorkspaceStore.getState().pendingSharedCpPayload !== payload) {
    useWorkspaceStore.getState().setPendingSharedCp(payload);
  }

  // A `/s` with no usable fragment is just a link someone truncated; Edit's
  // normal empty state is a better answer than an error screen.
  return <Navigate to={EDIT_PATH} replace />;
}
