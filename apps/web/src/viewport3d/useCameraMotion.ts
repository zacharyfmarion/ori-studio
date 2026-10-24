import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { viewLookingFrom, type OrbitView, type ViewDirection } from '../lib/viewport3dCamera';
import { viewCubeSnapAt, viewCubeSnapDurationMs } from './viewCube/viewCubeTween';

/** Camera animation lifetime shared by independent rendering backends. */
export function useCameraMotion(viewRef: RefObject<OrbitView>, present: () => void) {
  const animation = useRef<number | null>(null);
  const cancel = useCallback(() => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  const apply = useCallback(
    (next: OrbitView) => {
      cancel();
      viewRef.current = next;
      present();
    },
    [cancel, viewRef, present]
  );
  const snap = useCallback(
    (direction: ViewDirection) => {
      const from = viewRef.current;
      const to = { ...viewLookingFrom(from, direction), roll: 0 };
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        apply(to);
        return;
      }
      apply(viewCubeSnapAt(from, to, 0));
      const started = performance.now();
      const duration = viewCubeSnapDurationMs(from, to);
      const step = (now: number) => {
        const progress = (now - started) / duration;
        viewRef.current = viewCubeSnapAt(from, to, progress);
        present();
        animation.current = progress >= 1 ? null : requestAnimationFrame(step);
      };
      animation.current = requestAnimationFrame(step);
    },
    [apply, present, viewRef]
  );
  const roll = useCallback((value: number) => apply({ ...viewRef.current, roll: value }), [apply, viewRef]);
  return { apply, cancel, snap, roll };
}
