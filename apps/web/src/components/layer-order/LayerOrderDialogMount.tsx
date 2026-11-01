import { useEffect, useRef, useState } from 'react';
import { useInRouterContext, useLocation } from 'react-router-dom';
import {
  abandonLayerOrderDialog,
  registerLayerOrderDialogMount,
  useLayerOrderDialogOpening,
  useLoadedLayerOrderDialog,
  withdrawLayerOrderDialog,
} from '../../layer-order/dialog/layerOrderDialogGateway';
import { useLayoutStore } from '../../store/layoutStore';
import { ErrorBoundary } from '../errors/ErrorBoundary';

/**
 * The Layer order dialog's place at the app root (`App.tsx`). Nothing until a
 * host opens the dialog through its gateway, which asks for the dialog's code
 * then; the dialog once that code is here. Rendering this loads no code,
 * spawns no worker and costs a store read. Like a host, it reaches the dialog
 * only through the gateway (`layerOrderBoundary.test.ts`).
 *
 * Its being mounted is what lets a host's open go ahead: with none mounted, an
 * open answers `unavailable` at once rather than waiting on a dialog nobody
 * shows, and an open dialog goes when its mount does.
 *
 * **The dialog goes with the place it was opened in.** When the route or the
 * workspace changes under an open dialog (the browser's Back, a workspace
 * switch from the native menu), it closes and its host hears `cancelled`, as
 * Cancel would answer: its Apply would land in a workspace no longer on
 * screen, so no host's Apply ever meets an answer from a place the user left.
 *
 * **A dialog that crashes** is reported (the boundary) and answers its host
 * `cancelled` at once, so the host never waits and the next open is not
 * `busy`; its worker goes with it. Its fallback ("This dialog stopped
 * working") stays on screen, with Close rather than Try again, until it is
 * closed or another opening takes its place.
 */
export function LayerOrderDialogMount() {
  const opening = useLayerOrderDialogOpening();
  const chunk = useLoadedLayerOrderDialog();
  // The opening whose dialog crashed, kept so its fallback outlives its answer.
  const [crashed, setCrashed] = useState<number | null>(null);
  useEffect(() => registerLayerOrderDialogMount(), []);
  const workspace = useLayoutStore((state) => state.activeWorkspace);
  useClosedWhenLeft(opening?.id ?? null, workspace);
  // The route, where there is a router to read it from (the app's; not a host's unit test).
  const routed = useInRouterContext();
  const watch = routed && opening ? <RouteWatch id={opening.id} /> : null;
  const shown = opening?.id ?? crashed;
  // The watch first in one fragment either way, so it keeps where it started as the code arrives.
  if (shown === null || !chunk) return <>{watch}</>;
  return (
    <>
      {watch}
      <ErrorBoundary
        key={shown}
        surface="overlay:layer-order"
        variant="overlay"
        // Its host has heard `cancelled`: nothing can reopen it, so the fallback offers Close, not Try again.
        retryable={false}
        onError={() => {
          abandonLayerOrderDialog(shown);
          setCrashed(shown);
        }}
      >
        {opening?.id === shown ? <chunk.LayerOrderDialog opening={opening} /> : null}
      </ErrorBoundary>
    </>
  );
}

/** The route's half of {@link useClosedWhenLeft}: rendered only inside a router. */
function RouteWatch({ id }: { id: number }) {
  const { pathname } = useLocation();
  useClosedWhenLeft(id, pathname);
  return null;
}

/**
 * Close the dialog of opening `id` when `where` changes while it is open:
 * `where` as it was when the opening was first seen is where it belongs.
 */
function useClosedWhenLeft(id: number | null, where: string) {
  const at = useRef<{ id: number; where: string } | null>(null);
  useEffect(() => {
    if (id === null) {
      at.current = null;
      return;
    }
    const was = at.current;
    if (was?.id !== id) {
      at.current = { id, where };
      return;
    }
    if (was.where !== where) withdrawLayerOrderDialog(id);
  }, [id, where]);
}
