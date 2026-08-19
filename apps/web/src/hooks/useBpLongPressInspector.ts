import { useCallback, useEffect, useRef } from 'react';
import { useLayoutStore } from '../store/layoutStore';

const BP_LONG_PRESS_MS = 520;
const BP_LONG_PRESS_MOVE_PX = 12;

interface PointerLike {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
}

interface PendingLongPress {
  pointerId: number;
  startX: number;
  startY: number;
  timer: ReturnType<typeof setTimeout>;
  cleanup: () => void;
}

export function useBpLongPressInspector() {
  const activatePanel = useLayoutStore((state) => state.activatePanel);
  const pendingRef = useRef<PendingLongPress | null>(null);

  const clearPending = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.cleanup();
    pendingRef.current = null;
  }, []);

  useEffect(() => clearPending, [clearPending]);

  return useCallback(
    (event: PointerLike) => {
      if (typeof window === 'undefined') return;
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;

      clearPending();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        if (
          Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > BP_LONG_PRESS_MOVE_PX
        ) {
          clearPending();
        }
      };
      const onPointerEnd = (endEvent: PointerEvent) => {
        if (endEvent.pointerId === pointerId) clearPending();
      };
      const cleanup = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerEnd);
        window.removeEventListener('pointercancel', onPointerEnd);
      };

      const timer = setTimeout(() => {
        cleanup();
        pendingRef.current = null;
        activatePanel('inspector');
      }, BP_LONG_PRESS_MS);

      pendingRef.current = { pointerId, startX, startY, timer, cleanup };
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerup', onPointerEnd, { passive: true });
      window.addEventListener('pointercancel', onPointerEnd, { passive: true });
    },
    [activatePanel, clearPending],
  );
}
