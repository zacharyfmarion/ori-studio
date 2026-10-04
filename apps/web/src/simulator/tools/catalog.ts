import type {
  SimulatorToolDefinition,
  SimulatorToolId,
  SimulatorToolsView,
  SimulatorToolWindowSections,
} from './types';

/**
 * The pins' own window, shown under any tool while there are pins: the count
 * and Clear, and whatever the simulation has to say about them. Edit's resting
 * tool is the analog — its window opens only when there is something to act on.
 */
function pinsWindow(view: SimulatorToolsView): SimulatorToolWindowSections | null {
  if (view.pinnedCount === 0 && view.notices.length === 0) return null;
  return { kind: 'pins', instructions: false, options: [], pins: view.pinnedCount > 0 };
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
  }),
};

/** Every tool, in rail order. */
export const SIMULATOR_TOOLS: readonly SimulatorToolDefinition[] = [ORBIT, PIN];

const BY_ID: Record<SimulatorToolId, SimulatorToolDefinition> = { orbit: ORBIT, pin: PIN };

export function simulatorTool(id: SimulatorToolId): SimulatorToolDefinition {
  return BY_ID[id];
}

/** The tool a fresh session and Escape come back to. */
export const RESTING_SIMULATOR_TOOL: SimulatorToolId = 'orbit';

export function isSimulatorToolId(value: unknown): value is SimulatorToolId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BY_ID, value);
}
