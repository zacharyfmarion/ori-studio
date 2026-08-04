import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { creasePatternRotationFromOrieditaMetadata } from '../../lib/orieditaNativeMetadata';
import type { UserCamera } from '../renderer/camera';

/**
 * How long the camera must hold still before it is recorded as document state.
 * Long enough that a pan, or a rotate-and-adjust, writes once at the end; short
 * enough that a save straight after moving the view catches up.
 */
const CAMERA_SETTLE_MS = 200;

export interface CpDocumentCamera {
  /** The camera the open document was saved at, or null to auto-fit. */
  initialCamera: UserCamera | null;
  /**
   * A view rotation the document names without a full camera — an imported
   * Oriedita file's own camera angle. Used as the angle of the auto-fit.
   */
  initialRotation: number | null;
  /** Record a moved camera, on settle. */
  onCameraChange: (camera: UserCamera) => void;
}

/**
 * The document's view, as document state: what the canvas should open at, and
 * where a moved camera gets recorded.
 *
 * The view is not a transient way of looking at a crease pattern. Hex pleating
 * is worked at a rotated canvas for the whole life of a design, and every object
 * created on that canvas is oriented relative to it, so a reopen that snapped
 * back to square would tilt all of them. That makes "where the camera is" the
 * same kind of thing as the selection or the colour mode.
 *
 * Both directions live here rather than in the panel because they are one
 * concern with one invariant: the value written back on settle is the value the
 * canvas is restored from, and a `.ori` file supplies only half of it.
 *
 * `metadata` is the open crease-pattern document's own metadata bag, which is
 * where an imported Oriedita camera rides along.
 */
export function useCpDocumentCamera(
  metadata: Record<string, unknown> | null | undefined
): CpDocumentCamera {
  // Snapshotted at load, never read live.
  //
  // `oristudioCpCamera` is both halves of this hook: the file's camera on open,
  // and wherever the user has since moved to once a settle writes back. Reading
  // it live conflates them, and the canvas re-frames more than once per open —
  // its framing key carries the wasm handle, which lands after the document — so
  // a live read hands our own write-back to the second re-frame as if the file
  // had supplied it. On a document whose content is still arriving that pins the
  // view to the half-loaded fit instead of re-fitting against everything.
  //
  // `projectLoadId` changes exactly once per open, which is the boundary that
  // actually separates "what the file said" from "where the user is".
  const projectLoadId = useWorkspaceStore((state) => state.projectLoadId);
  const liveCamera = useWorkspaceStore((state) => state.oristudioCpCamera);
  // Re-snapshot during render rather than in an effect: the canvas re-frames in
  // its own effect, and child effects run before the parent's, so a snapshot
  // taken in an effect here would arrive a render *after* the frame that needed
  // it. Both values land in one store update, so the render that sees a new load
  // id already sees that document's camera.
  const [snapshot, setSnapshot] = useState({ loadId: projectLoadId, camera: liveCamera });
  if (snapshot.loadId !== projectLoadId) {
    setSnapshot({ loadId: projectLoadId, camera: liveCamera });
  }
  const initialCamera =
    snapshot.loadId === projectLoadId ? snapshot.camera : liveCamera;

  // From the document's own metadata rather than the store, so it travels with
  // the document exactly like its mouse mode and tool options do.
  const initialRotation = useMemo(
    () => creasePatternRotationFromOrieditaMetadata(metadata),
    [metadata]
  );

  // A drag moves the camera ~60x a second, and this is document state, so it is
  // recorded on settle rather than per frame.
  const settleTimerRef = useRef<number | undefined>(undefined);
  const onCameraChange = useCallback((camera: UserCamera) => {
    window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(
      () => useWorkspaceStore.getState().setOristudioCpCamera(camera),
      CAMERA_SETTLE_MS
    );
  }, []);
  useEffect(() => () => window.clearTimeout(settleTimerRef.current), []);

  return { initialCamera, initialRotation, onCameraChange };
}
