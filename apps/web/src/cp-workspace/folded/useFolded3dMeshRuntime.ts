import { useCallback, useEffect, useRef, useState } from 'react';
import { transfer } from 'comlink';
import type { OrbitView, RenderSettings } from '@treemaker/origami-simulator';
import {
  releaseSimulatorClient,
  retainSimulatorClient,
  type SimulatorClient,
} from '../../store/workspaceStore/simulatorRuntime';
import {
  beginCameraMessage,
  endCameraMessage,
  recordSimulatorProbe,
} from '../../simulator/simulatorPerfProbe';
import { useSimulatorPerfLog } from '../../simulator/useSimulatorPerfLog';
import { folded3dMeshPayload } from './folded3dWindow';
import type { Folded3dMesh } from './folded3dMesh';

/**
 * Drives one 3D folded figure's mesh in the simulator worker.
 *
 * A sibling of `useSimulatorRuntime`, deliberately not a generalisation of it.
 * That hook is solver-shaped end to end — a rAF tick loop, a convergence flag,
 * an in-flight guard, recycled position buffers, a fold percent, a playhead, a
 * material — and a folded figure uses none of it, because its geometry is
 * final. Threading a `kind` through every branch of a 628-line hook whose every
 * branch is currently exercised would be the highest-risk, lowest-value way to
 * share four lines of worker plumbing. What the two genuinely share is the
 * reference-counted worker client, and that is what is shared.
 *
 * There is no tick loop here at all: a frame is produced only when something
 * asks for one — a camera change, a colour change, or the window being resized
 * by the crease-pattern camera.
 */

/**
 * Render-target edge a window opens at, in device pixels. Replaced by the real
 * size as soon as the viewport's ResizeObserver reports one. Matches the inline
 * simulation's, because it sizes the same shared canvas.
 */
const INITIAL_RENDER_EDGE = 512;

export type Folded3dMeshStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface Folded3dMeshRuntime {
  status: Folded3dMeshStatus;
  /**
   * True when the worker reported a default framebuffer shallower than the layer
   * displacement was budgeted for. Surfaced rather than silently tolerated: at 16
   * bits a deep stack's layers collide, and the symptom is shimmer nobody can
   * attribute to anything.
   */
  shallowDepthBuffer: boolean;
  /** Move the camera and redraw. No-op until the mesh is loaded. */
  setCamera: (view: OrbitView, width: number, height: number) => void;
  /** Change colours or style and redraw. */
  setRenderSettings: (settings: RenderSettings) => void;
}

export function useFolded3dMeshRuntime(options: {
  /** The mesh to draw, or null while there is nothing to draw. */
  mesh: Folded3dMesh | null;
  /** Called with each rendered frame. Ownership transfers to the caller. */
  onFrame: (bitmap: ImageBitmap) => void;
}): Folded3dMeshRuntime {
  const { mesh, onFrame } = options;
  const [status, setStatus] = useState<Folded3dMeshStatus>('idle');
  const [shallowDepthBuffer, setShallowDepthBuffer] = useState(false);
  /**
   * Bumped to reload a mesh the worker no longer has. The cap should make this
   * unreachable, so it is a recovery path rather than a routine one — but unlike
   * a solver session, a mesh costs nothing to rebuild, which is exactly why
   * evicting one is safe in the first place.
   */
  const [reloadNonce, setReloadNonce] = useState(0);

  const clientRef = useRef<SimulatorClient | null>(null);
  const tokenRef = useRef<number | undefined>(undefined);
  const generationRef = useRef(0);
  const busyRef = useRef<object | null>(null);
  const dirtyRef = useRef(false);
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);
  // The last camera and settings pushed, so a reload after an eviction comes
  // back looking the way the window looked rather than at the defaults.
  const cameraRef = useRef<{
    view: OrbitView;
    width: number;
    height: number;
  } | null>(null);
  const settingsRef = useRef<RenderSettings | null>(null);

  // A mounted runtime is what "someone is drawing with the simulator" means, so
  // the worker's lifetime hangs off it exactly as it does for a simulation.
  useEffect(() => {
    clientRef.current = retainSimulatorClient();
    return () => {
      const token = tokenRef.current;
      const client = clientRef.current;
      if (token !== undefined && client) {
        void client.releaseFolded3dMesh(token).catch(() => undefined);
      }
      tokenRef.current = undefined;
      clientRef.current = null;
      releaseSimulatorClient();
    };
  }, []);

  /**
   * One frame in flight, with camera/settings overwritten by the newest input.
   * Present each completed frame of this mesh even when another view is waiting:
   * rejecting it on every pointermove starves presentation when input is faster
   * than rendering. The trailing send always uses the final absolute view.
   * Both camera and settings use this pump, so a slider cannot build a second
   * queue or race an orbit reply. A generation change still rejects old meshes.
   */
  const flush = useCallback(function send(): void {
    const client = clientRef.current,
      token = tokenRef.current;
    const camera = cameraRef.current,
      settings = settingsRef.current;
    if (
      !client ||
      token === undefined ||
      busyRef.current ||
      !dirtyRef.current ||
      (!camera && !settings)
    )
      return;
    const generation = generationRef.current;
    const request = {};
    busyRef.current = request;
    dirtyRef.current = false;
    const started = beginCameraMessage();
    void (
      camera
        ? client.setFolded3dMeshCamera(token, camera, settings ?? undefined)
        : client.setFolded3dMeshRenderSettings(token, settings!)
    )
      .then((frame) => {
        if (
          generationRef.current !== generation ||
          tokenRef.current !== token
        ) {
          frame?.bitmap?.close();
          return;
        }
        if (!frame) {
          // A missing token means eviction. Reload using the latest view.
          tokenRef.current = undefined;
          setStatus('loading');
          setReloadNonce((nonce) => nonce + 1);
        } else if (frame.bitmap) onFrameRef.current(frame.bitmap);
      })
      .catch(() => undefined)
      .finally(() => {
        endCameraMessage(started);
        // A previous mesh must not release the new mesh's in-flight guard.
        if (busyRef.current !== request) return;
        busyRef.current = null;
        send();
      });
    recordSimulatorProbe('cameraDispatch', performance.now() - started);
  }, []);

  useEffect(() => {
    if (!mesh) {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    const generation = ++generationRef.current;
    setStatus('loading');
    void (async () => {
      const client = clientRef.current;
      if (!client) return;
      try {
        // The same private canvas every inline simulation renders into, grown to
        // whichever window has asked for the most pixels. Requested before the
        // load because the mesh's GL context comes from it.
        await client.attachBitmapOutput(
          INITIAL_RENDER_EDGE,
          INITIAL_RENDER_EDGE
        );
        // Buffers are copied by `folded3dMeshPayload` and then transferred, so
        // the mesh itself survives to be uploaded again after an eviction.
        const { payload, transferables } = folded3dMeshPayload(mesh);
        const info = await client.loadFolded3dMesh(
          transfer(payload, transferables)
        );
        if (cancelled) {
          if (info)
            void client.releaseFolded3dMesh(info.token).catch(() => undefined);
          return;
        }
        if (!info) {
          // No GPU, or the context could not be had. A real answer: the caller
          // keeps drawing this figure the way it does today.
          setStatus('error');
          return;
        }
        tokenRef.current = info.token;
        setShallowDepthBuffer(info.shallowDepthBuffer);
        setStatus('ready');
        // Draw immediately at whatever the window already knows, so a reload
        // does not blank the picture until the next camera move.
        dirtyRef.current = true;
        flush();
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      generationRef.current = generation + 1;
      busyRef.current = null;
      dirtyRef.current = false;
      const token = tokenRef.current;
      tokenRef.current = undefined;
      if (token !== undefined) {
        void clientRef.current
          ?.releaseFolded3dMesh(token)
          .catch(() => undefined);
      }
    };
  }, [mesh, reloadNonce, flush]);

  const setCamera = useCallback(
    (view: OrbitView, width: number, height: number) => {
      cameraRef.current = { view, width, height };
      dirtyRef.current = true;
      flush();
    },
    [flush]
  );

  const setRenderSettings = useCallback(
    (settings: RenderSettings) => {
      settingsRef.current = settings;
      dirtyRef.current = true;
      flush();
    },
    [flush]
  );

  // A folded figure draws into the same shared buffer as every simulation, so
  // it is subject to the same costs and belongs in the same readout. Without
  // this, a page showing only folded figures logged nothing while doing exactly
  // the work under investigation. The poller is shared, so mounting many
  // figures still produces one line per second.
  useSimulatorPerfLog();

  return { status, shallowDepthBuffer, setCamera, setRenderSettings };
}
