import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { orbitCameraSpread, type CameraSpreadPose } from '../../cp-workspace/folded/cameraSpreadCamera';
import type { CameraSpreadOptions } from '../../cp-workspace/folded/cameraSpreadScene';

interface Drag {
  pointer: number;
  x: number;
  y: number;
  pose: CameraSpreadPose;
  node: HTMLCanvasElement;
}

export function useCameraSpreadOrbit(
  options: CameraSpreadOptions,
  onOrbit: (pose: CameraSpreadPose) => void
) {
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const enabled = options.projection !== 'diagram';
  useEffect(() => {
    setDragging(false);
    return () => {
      const held = drag.current;
      drag.current = null;
      if (held?.node.hasPointerCapture(held.pointer)) held.node.releasePointerCapture(held.pointer);
    };
  }, [options.projection]);
  const end = (event: PointerEvent<HTMLCanvasElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return {
    'data-orbitable': enabled,
    'data-dragging': enabled && dragging,
    onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
      if (!enabled || event.button !== 0 || !event.isPrimary || drag.current) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const { directionDeg, inclinationDeg, rollDeg } = options;
      drag.current = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        pose: { directionDeg, inclinationDeg, rollDeg },
        node: event.currentTarget,
      };
      setDragging(true);
    },
    onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
      const held = drag.current;
      if (!enabled || !held || held.pointer !== event.pointerId) return;
      // A missed mouse-up (for example after a window switch) must not stick.
      if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
        end(event);
        return;
      }
      onOrbit(orbitCameraSpread(held.pose, event.clientX - held.x, event.clientY - held.y));
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
  };
}
