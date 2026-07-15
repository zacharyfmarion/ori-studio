import type { MenuActionId } from '../commands/menuActions';
import type { DocumentMode } from '../lib/sampleProject';
import type { EditingContext } from '../workspaces/editingContext';
import type { OristudioCpActionId } from '../lib/oristudioCpActions';
import {
  handleShortcutKeyDown,
  type ShortcutExecutors,
} from './shortcutDispatcher';
import type {
  ShortcutOverrides,
  ShortcutScope,
  ViewportShortcutId,
} from './shortcuts';

type CpActionExecutor = (id: OristudioCpActionId) => unknown;
type ViewportExecutor = (id: ViewportShortcutId) => unknown;

/**
 * Which viewport currently owns keyboard shortcuts. This is the document modes
 * plus the Box Pleating packing pane, which is its own focusable viewport
 * surface distinct from the tree (design) pane.
 */
export type ViewportSurface = DocumentMode | 'bp-editor';

const viewportExecutors: Partial<Record<ViewportSurface, ViewportExecutor>> = {};
let cpActionExecutor: CpActionExecutor | null = null;
let activeViewportSurface: ViewportSurface | null = null;

export interface ShortcutRuntimeContext {
  activeEditingContext: EditingContext;
  activeViewportSurface?: ViewportSurface | null;
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
  const scopes: ShortcutScope[] = ['viewport'];
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

  return handleShortcutKeyDown(event, {
    scopeStack: shortcutScopeStackForContext(options.context),
    overrides: options.overrides,
    executors,
  });
}
