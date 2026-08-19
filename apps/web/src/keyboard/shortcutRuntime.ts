import type { MenuActionId } from '../commands/menuActions';
import type { DocumentMode } from '../lib/sampleProject';
import type { EditingContext } from '../workspaces/editingContext';
import type { OristudioCpActionId } from '../lib/oristudioCpActions';
import { handleShortcutKeyDown, type ShortcutExecutors } from './shortcutDispatcher';
import type {
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
type SimulatorExecutor = (id: SimulatorShortcutId) => unknown;

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

export interface ShortcutRuntimeContext {
  activeEditingContext: EditingContext;
  activeViewportSurface?: ViewportSurface | null;
  /** Overrides the registered-executor check; for tests. */
  simulatorFocused?: boolean;
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
  executor: ViewportExecutor,
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
  simulatorExecutor = executor;
  return () => {
    if (simulatorExecutor === executor) {
      simulatorExecutor = null;
    }
  };
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

export function shortcutScopeStackForContext(context: ShortcutRuntimeContext): ShortcutScope[] {
  const scopes: ShortcutScope[] = [];
  // Ahead of everything: a simulation in hand should answer Space and the view
  // toggles, not the crease-pattern tools bound to the same keys.
  if (context.simulatorFocused ?? simulatorExecutor !== null) {
    scopes.push('simulator');
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
  options: ShortcutRuntimeOptions,
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

  return handleShortcutKeyDown(event, {
    scopeStack: shortcutScopeStackForContext(options.context),
    overrides: options.overrides,
    defaultsSource: options.defaultsSource,
    executors,
  });
}
