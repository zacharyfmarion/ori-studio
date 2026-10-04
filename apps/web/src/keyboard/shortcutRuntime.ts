import type { MenuActionId } from '../commands/menuActions';
import type { DocumentMode } from '../lib/sampleProject';
import type { EditingContext } from '../workspaces/editingContext';
import type { OristudioCpActionId } from '../lib/oristudioCpActions';
import {
  handleShortcutKeyDown,
  type ShortcutExecutors,
} from './shortcutDispatcher';
import type {
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

/**
 * Which viewport currently owns keyboard shortcuts. This is the document modes
 * plus the Box Pleating packing pane, which is its own focusable viewport
 * surface distinct from the tree (design) pane.
 */
export type ViewportSurface = DocumentMode | 'bp-editor';

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

  return handleShortcutKeyDown(event, {
    scopeStack: shortcutScopeStackForContext(options.context),
    overrides: options.overrides,
    defaultsSource: options.defaultsSource,
    executors,
  });
}
