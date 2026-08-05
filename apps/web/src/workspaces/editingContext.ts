import type { DesignMethod } from '../store/workspaceStore/designVariant';

/**
 * The single value that identifies what the user is currently editing. It is
 * derived from the active Dockview panel (plus, for the polymorphic design
 * panel, the design document's kind). Every shell subsystem — menus,
 * capabilities, undo/redo, shortcut routing — reads this rather than the legacy
 * `documentMode`/`activeEditingSurface` pair.
 *
 * `bp-tree` and `bp-packing` are distinct contexts that share one document and
 * one undo stack; they differ only in their view-scoped commands. Because the BP
 * tree and BP packing already live in separate Dockview panels, the active panel
 * distinguishes them for free.
 */
export type EditingContext =
  | 'design-nux'
  | 'treemaker-tree'
  | 'bp-tree'
  | 'bp-packing'
  | 'crease-pattern'
  | 'simulate';

export interface EditingContextInput {
  activePanelId: string | null;
  designMethod: DesignMethod;
  hasBpDocument: boolean;
}

/**
 * Resolve the active editing context from the active panel and design state.
 *
 * The `design` panel is polymorphic (method chooser / TreeMaker tree / BP tree),
 * so its context depends on the design document state. Every other panel maps
 * statically. Side panes resolve to their workspace's primary editing context so
 * that focusing them does not change what the shell thinks is being edited.
 */
export function resolveEditingContext(input: EditingContextInput): EditingContext {
  switch (input.activePanelId) {
    case 'bp-editor':
      return 'bp-packing';
    case 'crease-pattern':
    case 'cp-view-controls':
      return 'crease-pattern';
    case 'simulator':
    case 'simulator-view-controls':
    case 'sequence':
      return 'simulate';
    case 'inspector':
    case 'diagnostics':
    case 'conditions':
      // TreeMaker-only side panes.
      return 'treemaker-tree';
    case 'design':
    default:
      if (input.designMethod === 'none') return 'design-nux';
      if (input.designMethod === 'box-pleat' && input.hasBpDocument) return 'bp-tree';
      return 'treemaker-tree';
  }
}
