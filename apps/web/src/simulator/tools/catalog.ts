import type {
  SimulatorToolDefinition,
  SimulatorToolId,
  SimulatorToolsView,
  SimulatorToolWindowSections,
} from './types';

/**
 * The window for what the tools left on the paper, shown under a tool that has
 * no window of its own: the pins' count and Clear, Spring back while posed, and
 * whatever the simulation has to say about them. Edit's resting tool is the
 * analog — its window opens only when there is something to act on.
 */
function pinsWindow(view: SimulatorToolsView): SimulatorToolWindowSections | null {
  if (view.pinnedCount === 0 && view.notices.length === 0 && !view.posed) return null;
  return {
    kind: 'pins',
    instructions: false,
    options: [],
    pins: view.pinnedCount > 0,
    pose: view.posed,
    needsPins: false,
  };
}

/**
 * Orbit: a drag turns the model, Shift-drag rolls it. The resting tool, and what
 * every drag did before there were tools.
 */
const ORBIT: SimulatorToolDefinition = {
  id: 'orbit',
  icon: 'orbit',
  shortcut: 'simulator.tool.orbit',
  input: 'orbit',
  cursor: 'grab',
  window: pinsWindow,
};

/**
 * Pin: a box or a click picks crease-pattern faces, and the faces picked stay
 * where they are while the rest of the paper folds around them.
 */
const PIN: SimulatorToolDefinition = {
  id: 'pin',
  icon: 'pin',
  shortcut: 'simulator.tool.pin',
  input: 'pick-faces',
  cursor: 'crosshair',
  window: (view) => ({
    kind: 'pin',
    instructions: true,
    options: ['pinThroughLayers'],
    pins: view.pinnedCount > 0,
    pose: view.posed,
    needsPins: false,
  }),
};

/**
 * Pull: drag the paper and it follows, turning about its creases while the
 * pins hold; let go and it stays there, until the fold target moves. Pins are
 * what it pulls against, so with none its window says to make some first.
 */
const PULL: SimulatorToolDefinition = {
  id: 'pull',
  icon: 'pull',
  shortcut: 'simulator.tool.pull',
  input: 'pull',
  cursor: 'grab',
  window: (view) => ({
    kind: 'pull',
    instructions: true,
    options: [],
    pins: view.pinnedCount > 0,
    pose: view.posed,
    needsPins: view.pinnedCount === 0,
  }),
};

/** Every tool, in rail order. */
export const SIMULATOR_TOOLS: readonly SimulatorToolDefinition[] = [ORBIT, PIN, PULL];

const BY_ID: Record<SimulatorToolId, SimulatorToolDefinition> = { orbit: ORBIT, pin: PIN, pull: PULL };

export function simulatorTool(id: SimulatorToolId): SimulatorToolDefinition {
  return BY_ID[id];
}

/** The tool a fresh session and Escape come back to. */
export const RESTING_SIMULATOR_TOOL: SimulatorToolId = 'orbit';

export function isSimulatorToolId(value: unknown): value is SimulatorToolId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BY_ID, value);
}
