import type { MenuActionId } from '../commands/menuActions';
import type { DocumentMode } from '../lib/sampleProject';
import type { EditingContext } from '../workspaces/editingContext';
import type { OristudioCpActionId } from '../lib/oristudioCpActions';
import {
  type ConditionalScopeExecutor,
  type ConditionalScopeExecutors,
  handleShortcutKeyDown,
  type ShortcutExecutors,
} from './shortcutDispatcher';
import {
  CONDITIONAL_SHORTCUT_SCOPES,
  type ConditionalShortcutTarget,
  type ReferencesShortcutId,
  type ShortcutDefaultsSource,
  type ShortcutOverrides,
  type ShortcutScope,
  type SimulatorShortcutId,
  type ViewportShortcutId,
} from './shortcuts';

type CpActionExecutor = (id: OristudioCpActionId) => unknown;
/**
 * `true` claims the chord, `false` declines it and lets the next scope have it.
 * Every id must answer one or the other; see `ShortcutExecutors.viewport`.
 */
type ViewportExecutor = (id: ViewportShortcutId) => boolean;

/**
 * Which viewport currently owns keyboard shortcuts. This is the document modes
 * plus the Box Pleating packing pane, which is its own focusable viewport
 * surface distinct from the tree (design) pane, and the Diagram and Fold
 * workspaces, whose views (and Fold's two canvas panes) share one surface each
 * with one owner at a time.
 */
export type ViewportSurface = DocumentMode | 'bp-editor' | 'diagram' | 'fold';

const viewportExecutors: Partial<Record<ViewportSurface, ViewportExecutor>> = {};
let cpActionExecutor: CpActionExecutor | null = null;
let activeViewportSurface: ViewportSurface | null = null;
/**
 * Each conditional surface's executor, set while that surface owns the
 * keyboard: a simulation in hand (the Simulate workspace panel, or a focused
 * inline window on the Edit canvas), the References panel, the Diagram
 * workspace, the Fold workspace. Its presence is what pushes the surface's
 * scopes, so their keys take precedence over the CP tools and the viewport only
 * while the surface is actually in hand.
 */
const conditionalExecutors: ConditionalScopeExecutors = {};
/**
 * Told whenever a surface's executor comes or goes. The Simulate rail's
 * buttons are enabled by exactly this: the panel registers its executor only
 * while its simulation is ready, so "is there one" is the readiness the rail
 * needs, and a second flag for it would be a second source of truth.
 */
const conditionalExecutorListeners = new Map<ConditionalShortcutTarget, Set<() => void>>();

export interface ShortcutRuntimeContext {
  activeEditingContext: EditingContext;
  activeViewportSurface?: ViewportSurface | null;
  /** Overrides the registered-executor check, per surface; for tests. */
  registeredExecutors?: Partial<Record<ConditionalShortcutTarget, boolean>>;
}

/** The viewport pane that owns shortcuts for a given editing context. */
function viewportSurfaceForContext(context: EditingContext): ViewportSurface {
  if (context === 'crease-pattern') return 'crease-pattern';
  if (context === 'bp-packing') return 'bp-editor';
  if (context === 'diagram') return 'diagram';
  if (context === 'fold') return 'fold';
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
 * Claim the keyboard for a conditional surface: while registered, the scopes
 * `target` answers are in the stack (`CONDITIONAL_SHORTCUT_SCOPES`) and their
 * bindings come here. Returns an unregister; call it on blur or unmount, or the
 * scopes outlive the surface and keep shadowing the keys beneath them. A newer
 * registration replaces an older one, whose unregister then leaves it be.
 */
export function registerConditionalScopeExecutor<T extends ConditionalShortcutTarget>(
  target: T,
  executor: ConditionalScopeExecutor<T>
): () => void {
  setConditionalExecutor(target, executor);
  return () => {
    if (conditionalExecutors[target] === executor) {
      setConditionalExecutor(target, undefined);
    }
  };
}

function setConditionalExecutor<T extends ConditionalShortcutTarget>(
  target: T,
  next: ConditionalScopeExecutor<T> | undefined
): void {
  // The registry seen through `target` alone: written through the whole map, a
  // generic key would have to take every surface's executor at once.
  const executors: { [K in T]?: ConditionalScopeExecutor<K> } = conditionalExecutors;
  if (executors[target] === next) return;
  if (next) executors[target] = next;
  else delete executors[target];
  for (const listener of conditionalExecutorListeners.get(target) ?? []) listener();
}

/**
 * Hear when a simulation takes or gives up the keyboard. Shaped for
 * `useSyncExternalStore`, with {@link hasSimulatorExecutor} as the snapshot.
 */
export function subscribeSimulatorExecutor(listener: () => void): () => void {
  const listeners = conditionalExecutorListeners.get('simulator') ?? new Set<() => void>();
  conditionalExecutorListeners.set('simulator', listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether a simulation is in hand, so its verbs have somewhere to go. */
export function hasSimulatorExecutor(): boolean {
  return conditionalExecutors.simulator !== undefined;
}

/**
 * Run a simulator verb from outside the simulation's view — the Simulate
 * workspace's rail is a panel of its own, and the view is what holds the
 * viewport and the renderer a verb acts on. The same arrangement as
 * {@link runReferencesCommand}. False while no simulation is in hand, or when
 * the one in hand declines the verb.
 */
export function runSimulatorCommand(id: SimulatorShortcutId): boolean {
  const simulator = conditionalExecutors.simulator;
  if (!simulator) return false;
  return simulator(id);
}

/**
 * Run a References verb from outside the References view — its right rail is a
 * panel of its own, and the view is what holds the diagrams a verb acts on.
 * Through the executor the view registers, so a button there and the view's
 * own key are one path. False while no References view is mounted.
 */
export function runReferencesCommand(id: ReferencesShortcutId): boolean {
  const references = conditionalExecutors.references;
  if (!references) return false;
  references(id);
  return true;
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
  // Ahead of everything, in the table's order: each surface's scopes while it
  // holds an executor, and only in the one context a scope names, if any.
  for (const { scope, target, onlyIn } of CONDITIONAL_SHORTCUT_SCOPES) {
    if (onlyIn !== null && context.activeEditingContext !== onlyIn) continue;
    if (context.registeredExecutors?.[target] ?? (conditionalExecutors[target] !== undefined)) {
      scopes.push(scope);
    }
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
    ...conditionalExecutors,
    menu: options.menu,
    viewport: viewportExecutors[resolvedViewportSurface(options.context)],
  };

  if (options.context.activeEditingContext === 'crease-pattern' && cpActionExecutor) {
    executors.cpAction = cpActionExecutor;
  }

  return handleShortcutKeyDown(event, {
    scopeStack: shortcutScopeStackForContext(options.context),
    overrides: options.overrides,
    defaultsSource: options.defaultsSource,
    executors,
  });
}
