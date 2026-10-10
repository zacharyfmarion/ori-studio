import type { MenuActionId } from '../commands/menuActions';
import type { DocumentMode } from '../lib/sampleProject';
import type { EditingContext } from '../workspaces/editingContext';
import type { OristudioCpActionId } from '../lib/oristudioCpActions';
import {
  handleShortcutKeyDown,
  type ShortcutExecutors,
} from './shortcutDispatcher';
import type {
  DiagramShortcutId,
  ReferencesShortcutId,
  ShortcutDefaultsSource,
  ShortcutOverrides,
  ShortcutScope,
  SimulatorShortcutId,
  ViewportShortcutId,
} from './shortcuts';

type CpActionExecutor = (id: OristudioCpActionId) => unknown;
/**
 * `true` claims the chord, `false` declines it and lets the next scope have it.
 * Every id must answer one or the other; see `ShortcutExecutors.viewport`.
 */
type ViewportExecutor = (id: ViewportShortcutId) => boolean;
/** Claims or declines, as the viewport's does; see `ShortcutExecutors.simulator`. */
type SimulatorExecutor = (id: SimulatorShortcutId) => boolean;
type ReferencesExecutor = (id: ReferencesShortcutId) => unknown;
/** May decline, as a viewport executor may; see `ShortcutExecutors.diagram`. */
type DiagramExecutor = (id: DiagramShortcutId) => boolean;

/**
 * Which viewport currently owns keyboard shortcuts. This is the document modes
 * plus the Box Pleating packing pane, which is its own focusable viewport
 * surface distinct from the tree (design) pane, and the Diagram workspace, whose
 * views share one surface with one owner at a time.
 */
export type ViewportSurface = DocumentMode | 'bp-editor' | 'diagram';

const viewportExecutors: Partial<Record<ViewportSurface, ViewportExecutor>> = {};
let cpActionExecutor: CpActionExecutor | null = null;
let activeViewportSurface: ViewportSurface | null = null;
/**
 * Set while a simulation owns the keyboard: the Simulate workspace panel, or a
 * focused inline simulation window on the Edit canvas. Its presence is what
 * pushes the `simulator` scope, so the simulator's bare letters and Space only
 * take precedence over the CP tools when a simulation is actually in hand.
 */
let simulatorExecutor: SimulatorExecutor | null = null;
/**
 * Told whenever {@link simulatorExecutor} comes or goes. The Simulate rail's
 * buttons are enabled by exactly this: the panel registers its executor only
 * while its simulation is ready, so "is there one" is the readiness the rail
 * needs, and a second flag for it would be a second source of truth.
 */
const simulatorExecutorListeners = new Set<() => void>();
/**
 * Set while the References panel is mounted. Same mechanism as the simulator's:
 * its presence pushes the `references` scope, so the step and zoom keys apply
 * only while that workspace is on screen.
 */
let referencesExecutor: ReferencesExecutor | null = null;
/**
 * Set while the Diagram workspace is mounted, and the `diagram` scope's reason
 * to be in the stack.
 */
let diagramExecutor: DiagramExecutor | null = null;

export interface ShortcutRuntimeContext {
  activeEditingContext: EditingContext;
  activeViewportSurface?: ViewportSurface | null;
  /** Overrides the registered-executor check; for tests. */
  simulatorFocused?: boolean;
  /** Overrides the registered-executor check; for tests. */
  referencesFocused?: boolean;
}

/** The viewport pane that owns shortcuts for a given editing context. */
function viewportSurfaceForContext(context: EditingContext): ViewportSurface {
  if (context === 'crease-pattern') return 'crease-pattern';
  if (context === 'bp-packing') return 'bp-editor';
  if (context === 'diagram') return 'diagram';
  return 'tree';
}

export interface ShortcutRuntimeOptions {
  context: ShortcutRuntimeContext;
  overrides?: ShortcutOverrides;
  /** The active keyboard layout; both come from the same store subscription. */
  defaultsSource?: ShortcutDefaultsSource;
  menu: (id: MenuActionId) => unknown;
}

export function registerViewportShortcutExecutor(
  surface: ViewportSurface,
  executor: ViewportExecutor
): () => void {
  viewportExecutors[surface] = executor;
  return () => {
    if (viewportExecutors[surface] === executor) {
      delete viewportExecutors[surface];
    }
  };
}

/**
 * Claim the keyboard for a simulation. Returns an unregister; call it on blur or
 * unmount, or the CP tools stay shadowed after the simulation is gone.
 */
export function registerSimulatorShortcutExecutor(executor: SimulatorExecutor): () => void {
  setSimulatorExecutor(executor);
  return () => {
    if (simulatorExecutor === executor) {
      setSimulatorExecutor(null);
    }
  };
}

function setSimulatorExecutor(next: SimulatorExecutor | null): void {
  if (simulatorExecutor === next) return;
  simulatorExecutor = next;
  for (const listener of simulatorExecutorListeners) listener();
}

/**
 * Hear when a simulation takes or gives up the keyboard. Shaped for
 * `useSyncExternalStore`, with {@link hasSimulatorExecutor} as the snapshot.
 */
export function subscribeSimulatorExecutor(listener: () => void): () => void {
  simulatorExecutorListeners.add(listener);
  return () => {
    simulatorExecutorListeners.delete(listener);
  };
}

/** Whether a simulation is in hand, so its verbs have somewhere to go. */
export function hasSimulatorExecutor(): boolean {
  return simulatorExecutor !== null;
}

/**
 * Run a simulator verb from outside the simulation's view — the Simulate
 * workspace's rail is a panel of its own, and the view is what holds the
 * viewport and the renderer a verb acts on. The same arrangement as
 * {@link runReferencesCommand}. False while no simulation is in hand, or when
 * the one in hand declines the verb.
 */
export function runSimulatorCommand(id: SimulatorShortcutId): boolean {
  if (!simulatorExecutor) return false;
  return simulatorExecutor(id);
}

/**
 * Claim the keyboard for the References workspace. Returns an unregister; call
 * it on unmount, or the scope outlives the panel.
 */
export function registerReferencesShortcutExecutor(executor: ReferencesExecutor): () => void {
  referencesExecutor = executor;
  return () => {
    if (referencesExecutor === executor) {
      referencesExecutor = null;
    }
  };
}

/**
 * Run a References verb from outside the References view — its right rail is a
 * panel of its own, and the view is what holds the diagrams a verb acts on.
 * Through the executor the view registers, so a button there and the view's
 * own key are one path. False while no References view is mounted.
 */
export function runReferencesCommand(id: ReferencesShortcutId): boolean {
  if (!referencesExecutor) return false;
  referencesExecutor(id);
  return true;
}

/**
 * Claim the keyboard for the Diagram workspace. Returns an unregister; call it
 * on unmount, or the scope outlives the panel.
 */
export function registerDiagramShortcutExecutor(executor: DiagramExecutor): () => void {
  diagramExecutor = executor;
  return () => {
    if (diagramExecutor === executor) {
      diagramExecutor = null;
    }
  };
}

/**
 * Modes a workspace has armed that Escape puts down before anything else —
 * the Diagram's anchor pick (Revision 2) — each asked whether it is armed
 * now. The mode itself ends through its scope's own cancel; this only tells
 * a layer that also closes on Escape, the touch View sheet
 * (`useWorkspaceViewDrawer`), to leave the key to the runtime, so one Escape
 * leaves the mode and the sheet stays open.
 */
const armedModes = new Set<() => boolean>();

/** Claim Escape for a mode while `armed` says it is armed. Returns an unregister; call it on unmount. */
export function registerArmedMode(armed: () => boolean): () => void {
  armedModes.add(armed);
  return () => {
    armedModes.delete(armed);
  };
}

/** Whether a mode is armed that the next Escape puts down, through the runtime. */
export function escapeEndsArmedMode(): boolean {
  for (const armed of armedModes) if (armed()) return true;
  return false;
}

export function registerCpActionShortcutExecutor(executor: CpActionExecutor): () => void {
  cpActionExecutor = executor;
  return () => {
    if (cpActionExecutor === executor) {
      cpActionExecutor = null;
    }
  };
}

export function setActiveShortcutViewportSurface(surface: ViewportSurface): void {
  activeViewportSurface = surface;
}

/**
 * Give up a claim made with {@link setActiveShortcutViewportSurface}, for a
 * surface that is going away. Only its own: a claim another surface has since
 * made stands. Without it the claim outlives its panel, and the next workspace's
 * viewport keys go to a surface with no executor until something is clicked.
 */
export function releaseShortcutViewportSurface(surface: ViewportSurface): void {
  if (activeViewportSurface === surface) activeViewportSurface = null;
}

function resolvedViewportSurface(context: ShortcutRuntimeContext): ViewportSurface {
  return (
    context.activeViewportSurface ??
    activeViewportSurface ??
    viewportSurfaceForContext(context.activeEditingContext)
  );
}

export function shortcutScopeStackForContext(
  context: ShortcutRuntimeContext
): ShortcutScope[] {
  const scopes: ShortcutScope[] = [];
  // Ahead of everything: a simulation in hand should answer Space and the view
  // toggles, not the crease-pattern tools bound to the same keys.
  if (context.simulatorFocused ?? simulatorExecutor !== null) {
    scopes.push('simulator');
  }
  if (context.referencesFocused ?? referencesExecutor !== null) {
    scopes.push('references');
  }
  // Only in its own context, so it can never stack with `crease-pattern`.
  // Edit Path's node keys first: the same executor, which declines them
  // unless a node is selected, so the arrows then reach the steps' scope.
  if (context.activeEditingContext === 'diagram' && diagramExecutor !== null) {
    scopes.push('diagram-place', 'diagram-path', 'diagram');
  }
  scopes.push('viewport');
  if (context.activeEditingContext === 'crease-pattern') {
    scopes.push('crease-pattern');
  }

  scopes.push('global');
  return scopes;
}

export function handleShortcutRuntimeKeyDown(
  event: KeyboardEvent,
  options: ShortcutRuntimeOptions
): boolean {
  const executors: ShortcutExecutors = {
    menu: options.menu,
    viewport: viewportExecutors[resolvedViewportSurface(options.context)],
  };

  if (options.context.activeEditingContext === 'crease-pattern' && cpActionExecutor) {
    executors.cpAction = cpActionExecutor;
  }

  if (simulatorExecutor) {
    executors.simulator = simulatorExecutor;
  }

  if (referencesExecutor) {
    executors.references = referencesExecutor;
  }

  if (diagramExecutor) {
    executors.diagram = diagramExecutor;
  }

  return handleShortcutKeyDown(event, {
    scopeStack: shortcutScopeStackForContext(options.context),
    overrides: options.overrides,
    defaultsSource: options.defaultsSource,
    executors,
  });
}
