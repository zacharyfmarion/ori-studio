import { useCallback, useEffect, useRef, useState } from 'react';
import { createSimulatorRateMeter, type SimulatorRate } from './simulatorRate';

/**
 * The Simulate panel's speed readout: feed it every frame through `observe`;
 * `rate` changes about once a second, so the panel re-renders once a second
 * for it, not once a frame. Null while off, and until the first window closes.
 */
export function useSimulatorRate(enabled: boolean): {
  rate: SimulatorRate | null;
  observe: (stepsThisTick: number) => void;
} {
  const meterRef = useRef(createSimulatorRateMeter());
  const enabledRef = useRef(enabled);
  const [rate, setRate] = useState<SimulatorRate | null>(null);

  useEffect(() => {
    enabledRef.current = enabled;
    meterRef.current.reset();
    if (!enabled) setRate(null);
  }, [enabled]);

  const observe = useCallback((stepsThisTick: number) => {
    if (!enabledRef.current) return;
    const next = meterRef.current.observe(stepsThisTick, performance.now());
    if (next) setRate(next);
  }, []);

  return { rate, observe };
}
