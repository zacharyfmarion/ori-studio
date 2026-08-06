import { designKind } from '../designKinds';
import type { DesignKindDescriptor } from '../designKinds';
import type { DesignMethod } from '../store/workspaceStore/designVariant';

/**
 * The single value that identifies what the user is currently editing. Every
 * shell subsystem — menus, capabilities, undo/redo, shortcut routing — reads this
 * rather than the legacy `documentMode`/`activeEditingSurface` pair.
 *
 * `bp-tree` and `bp-packing` are distinct contexts that share one document and
 * one undo stack; they differ only in their view-scoped commands.
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
 * Panels that belong to Edit and Simulate.
 *
 * Static, because those workspaces have no kinds — there is one crease pattern
 * and one simulator, and a pane of either is that workspace's context whatever
 * else is open.
 */
const STATIC_PANEL_CONTEXTS: Record<string, EditingContext> = {
  'crease-pattern': 'crease-pattern',
  'cp-view-controls': 'crease-pattern',
  simulator: 'simulate',
  'simulator-view-controls': 'simulate',
  sequence: 'simulate',
};

/**
 * Resolve the active editing context from the active pane and the design it
 * belongs to.
 *
 * The Design half comes from the **kind descriptor**: each kind declares an
 * `editingContext` per pane, and this looks the active pane up in the active
 * design's kind. It used to be a hardcoded switch listing `inspector`,
 * `diagnostics`, `conditions`, and `bp-editor` by name, which meant a third
 * design kind could not have contexts without an edit here — the exact coupling
 * the registry exists to remove.
 */
export function resolveEditingContext(input: EditingContextInput): EditingContext {
  const staticContext = input.activePanelId
    ? STATIC_PANEL_CONTEXTS[input.activePanelId]
    : undefined;
  if (staticContext) return staticContext;

  if (input.designMethod === 'none') return 'design-nux';
  const kind = designKind(input.designMethod);
  if (!kind) return 'design-nux';

  // A box-pleat design whose document is still loading is not yet editable as
  // one. Reporting its pane's context anyway would offer BP commands against a
  // document that does not exist; the chooser context is the honest answer for
  // that window, and it resolves as soon as the worker answers.
  if (input.designMethod === 'box-pleat' && !input.hasBpDocument) return 'design-nux';

  return paneContext(kind, input.activePanelId) ?? primaryContext(kind);
}

function paneContext(kind: DesignKindDescriptor, panelId: string | null): EditingContext | null {
  if (panelId === null) return null;
  return kind.panes.find((pane) => pane.component === panelId)?.editingContext ?? null;
}

/**
 * The context of the kind's canvas.
 *
 * The fallback for a pane the kind does not declare — which happens for one
 * render after a tab switch, while `activePanelId` still names the outgoing
 * design's pane. Answering with the incoming design's canvas is what stops the
 * menus flickering through the other kind's commands.
 */
function primaryContext(kind: DesignKindDescriptor): EditingContext {
  const primary = kind.panes.find((pane) => pane.placement.kind === 'primary');
  return primary?.editingContext ?? 'design-nux';
}
