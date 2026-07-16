/**
 * A tiny stateful wrapper around a pure {@link ToolEngine}: it owns the engine's
 * state so callers (the surface adapter) can just `feed` inputs without knowing
 * the engine's state shape. The engine stays pure and unit-testable; this holds
 * the mutable interaction state for one in-progress tool gesture.
 */
import type { ToolEngine, ToolInput, ToolOutput } from './types';

export interface ToolRuntime {
  feed(input: ToolInput): ToolOutput<unknown>;
  reset(): void;
}

export function createToolRuntime<S>(engine: ToolEngine<S>): ToolRuntime {
  let state = engine.initialState;
  return {
    feed(input: ToolInput): ToolOutput<unknown> {
      const out = engine.reduce(state, input);
      state = out.state;
      return out;
    },
    reset(): void {
      state = engine.initialState;
    },
  };
}
