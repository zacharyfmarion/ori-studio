import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
  type PointerEvent,
} from 'react';
import {
  createCameraGesture,
  clampCameraZoom,
  panCamera,
  setUprightView,
  wheelZoomFactor,
  type OrbitView,
} from '../lib/viewport3dCamera';
import { createTouchArbiter } from '../lib/gestures/touchArbiter';
import { useCameraMotion } from './useCameraMotion';
import { ViewCube, type ViewCubeHandle } from './viewCube/ViewCube';
import { ViewportNavigation } from './ViewportNavigation';
import styles from './Viewport3d.module.css';

export interface Viewport3dHandle {
  setView: (view: OrbitView) => void;
  setUpright: () => void;
  resetView: () => void;
  presentBitmap: (bitmap: ImageBitmap) => void;
}

/** Camera and bitmap surface for static backends, with no simulation/tool contract. */
export function Viewport3d({
  ref,
  initialView,
  onView,
  onGesture,
  className,
  label,
  interactive = true,
  orbitEnabled = true,
  bitmapVisible = true,
}: {
  ref?: Ref<Viewport3dHandle>;
  initialView: OrbitView;
  onView: (view: OrbitView, size: { width: number; height: number; dpr: number }) => void;
  onGesture?: (held: boolean, cancelled?: boolean) => void;
  className?: string;
  label: string;
  interactive?: boolean;
  orbitEnabled?: boolean;
  /** Keep input/navigation active over a higher quality settled vector picture. */
  bitmapVisible?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cubeRef = useRef<ViewCubeHandle | null>(null);
  const viewRef = useRef(initialView);
  const openingRef = useRef(initialView);
  const sizeRef = useRef({ width: 1, height: 1, dpr: 1 });
  const callbackRef = useRef(onView);
  useLayoutEffect(() => {
    callbackRef.current = onView;
  }, [onView]);
  const interactionRef = useRef(onGesture);
  useLayoutEffect(() => {
    interactionRef.current = onGesture;
  }, [onGesture]);
  const contactsRef = useRef(new Set<number>());
  const originRef = useRef<OrbitView | null>(null);
  const arbiter = useMemo(() => createTouchArbiter(), []);
  const pointerRef = useRef<number | null>(null);
  const [pan, setPan] = useState(false);
  const present = useCallback(() => {
    cubeRef.current?.setView(viewRef.current);
    callbackRef.current(viewRef.current, sizeRef.current);
  }, []);
  const { apply, cancel, snap, roll } = useCameraMotion(viewRef, present);
  const beginGesture = useCallback(() => {
    cancel();
    originRef.current ??= viewRef.current;
    interactionRef.current?.(true);
  }, [cancel]);
  const endGesture = useCallback(() => {
    if (contactsRef.current.size === 0) {
      originRef.current = null;
      interactionRef.current?.(false);
    }
  }, []);
  const readView = useCallback(() => viewRef.current, []);
  const readShortEdge = useCallback(() => Math.min(sizeRef.current.width, sizeRef.current.height), []);
  // The factory stores these callbacks; it only reads their refs on input events.
  const gesture = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- The factory stores callbacks; it does not call them during render.
      createCameraGesture({
        read: readView,
        write: apply,
        shortEdge: readShortEdge,
        begin: beginGesture,
        end: endGesture,
      }),
    [apply, beginGesture, endGesture, readView, readShortEdge]
  );
  const reset = useCallback(() => apply({ ...openingRef.current }), [apply]);
  useImperativeHandle(
    ref,
    () => ({
      setView: (view) => {
        contactsRef.current.clear();
        arbiter.reset();
        pointerRef.current = null;
        originRef.current = null;
        gesture.end();
        interactionRef.current?.(false, true);
        apply(view);
      },
      resetView: reset,
      setUpright: () => apply(setUprightView(viewRef.current)),
      presentBitmap(bitmap) {
        const element = canvasRef.current;
        if (!element) {
          bitmap.close();
          return;
        }
        if (element.width !== bitmap.width) element.width = bitmap.width;
        if (element.height !== bitmap.height) element.height = bitmap.height;
        const ctx = element.getContext('bitmaprenderer');
        if (ctx) ctx.transferFromImageBitmap(bitmap);
        else {
          element.getContext('2d')?.drawImage(bitmap, 0, 0);
          bitmap.close();
        }
      },
    }),
    [apply, reset, arbiter, gesture]
  );
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      sizeRef.current = {
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
        dpr: window.devicePixelRatio || 1,
      };
      present();
    };
    const heldContacts = contactsRef.current;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      arbiter.reset();
      heldContacts.clear();
      interactionRef.current?.(false, true);
    };
  }, [arbiter, gesture, present]);
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (interactive)
        apply({ ...viewRef.current, zoom: clampCameraZoom(viewRef.current.zoom * wheelZoomFactor(event.deltaY)) });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [interactive, apply]);
  const down = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!interactive || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    contactsRef.current.add(event.pointerId);
    const result = arbiter.down(event.nativeEvent);
    if (result.abort.length) {
      gesture.end();
      pointerRef.current = null;
    }
    if (result.action === 'ignore') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (result.action === 'transform') return;
    pointerRef.current = event.pointerId;
    gesture.begin(
      { x: event.clientX, y: event.clientY },
      event.button === 1 || pan || !orbitEnabled ? 'pan' : event.shiftKey ? 'roll' : 'orbit'
    );
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    const result = arbiter.move(event.nativeEvent);
    if (result.action === 'transform') {
      apply(
        panCamera(
          { ...viewRef.current, zoom: clampCameraZoom(viewRef.current.zoom * result.transform.scale) },
          result.transform.dx,
          result.transform.dy,
          Math.min(sizeRef.current.width, sizeRef.current.height)
        )
      );
    } else if (result.action === 'forward' && pointerRef.current === event.pointerId)
      gesture.move({ x: event.clientX, y: event.clientY });
  };
  const end = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!contactsRef.current.has(event.pointerId)) return;
    arbiter.up(event.nativeEvent);
    contactsRef.current.delete(event.pointerId);
    const cancelled = event.type === 'pointercancel' || event.type === 'lostpointercapture';
    if (cancelled && originRef.current) {
      apply(originRef.current);
      originRef.current = null;
      interactionRef.current?.(false, true);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointerRef.current === event.pointerId) {
      pointerRef.current = null;
      gesture.end();
    }
    if (contactsRef.current.size === 0) {
      originRef.current = null;
      interactionRef.current?.(false, cancelled);
    }
  };
  return (
    <>
      <canvas
        ref={canvasRef}
        className={`${styles.canvas} ${className ?? ''}`}
        data-bitmap-hidden={!bitmapVisible || undefined}
        aria-label={label}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onDoubleClick={() => {
          if (interactive) reset();
        }}
      />
      <ViewportNavigation
        pan={pan || !orbitEnabled}
        onPan={setPan}
        disabled={!interactive}
        onFit={() => apply({ ...viewRef.current, zoom: 1, pan: [0, 0] })}
      />
      {orbitEnabled && (
        <ViewCube
          ref={(handle) => {
            cubeRef.current = handle;
            handle?.setView(viewRef.current);
          }}
          interactive={interactive}
          orbit={gesture}
          onSnap={snap}
          onRoll={roll}
        />
      )}
    </>
  );
}
