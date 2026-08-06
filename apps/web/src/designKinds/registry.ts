import type { EditingContext } from '../workspaces/editingContext';
import { createBoxPleatDesignKind } from './boxPleat';
import { createExploriDesignKind } from './explori';
import { createTreemakerDesignKind } from './treemaker';
import type { DesignKindDescriptor, DesignKindId, DesignPaneSpec } from './types';

/**
 * Engine clients are fetched lazily, through a dynamic import, for two reasons.
 *
 * Bundle: the capability layer and the method chooser both read descriptors, and
 * neither should pull a wasm worker in to render a menu or a card.
 *
 * Cycles: `engineRuntime` and `oristudioBpRuntime` sit downstream of the store,
 * which is downstream of the capability layer, which reads this registry. A
 * static import here would close that loop.
 */
const getTreemakerClient = async () =>
  (await import('../store/workspaceStore/engineRuntime')).getEngine();

const getBoxPleatClient = async () =>
  (await import('../store/workspaceStore/oristudioBpRuntime')).getOristudioBpClient();

/**
 * Every design authoring method the app ships.
 *
 * Adding a third is meant to be adding one entry here plus its descriptor module.
 * `registry.test.ts` holds that claim to account with a stub kind: if registering
 * one requires an edit anywhere else, the descriptor interface is missing a field.
 */
export const DESIGN_KINDS: readonly DesignKindDescriptor[] = [
  createTreemakerDesignKind(getTreemakerClient),
  createBoxPleatDesignKind(getBoxPleatClient),
  createExploriDesignKind(),
];

/**
 * Lookups over a descriptor list.
 *
 * Parameterized rather than hardcoded to {@link DESIGN_KINDS} so the extensibility
 * test can drive the same consumers with a list containing a stub kind, without
 * mutating global state and leaking between tests.
 */
export function designKindRegistry(kinds: readonly DesignKindDescriptor[] = DESIGN_KINDS) {
  const byId = new Map<DesignKindId, DesignKindDescriptor>(kinds.map((kind) => [kind.id, kind]));

  const byContext = new Map<EditingContext, DesignKindDescriptor>();
  for (const kind of kinds) {
    for (const pane of kind.panes) {
      byContext.set(pane.editingContext, kind);
    }
  }

  return {
    all: kinds,
    ids: kinds.map((kind) => kind.id),
    /** The descriptor for an id, or undefined for an id no kind claims. */
    get: (id: DesignKindId): DesignKindDescriptor | undefined => byId.get(id),
    /**
     * The kind whose panes declare this editing context, or undefined for a
     * context no design owns (`crease-pattern`, `simulate`, `design-nux`).
     */
    forContext: (context: EditingContext): DesignKindDescriptor | undefined =>
      byContext.get(context),
    /** Chooser cards, in the order they should be offered. */
    chooserOrder: [...kinds].sort((a, b) => a.chooser.order - b.chooser.order),
  };
}

const defaultRegistry = designKindRegistry();

/** The descriptor for a design kind, or undefined if the id is not registered. */
export function designKind(id: DesignKindId): DesignKindDescriptor | undefined {
  return defaultRegistry.get(id);
}

/**
 * The design kind that owns an editing context, or null for the contexts no
 * design owns.
 */
export function designKindForContext(context: EditingContext): DesignKindDescriptor | null {
  return defaultRegistry.forContext(context) ?? null;
}

/** Chooser cards in presentation order. */
export function designKindsForChooser(): readonly DesignKindDescriptor[] {
  return defaultRegistry.chooserOrder;
}

/** The pane a kind opens on — its primary canvas. */
export function primaryPane(kind: DesignKindDescriptor): DesignPaneSpec {
  const primary = kind.panes.find((pane) => pane.placement.kind === 'primary');
  if (!primary) {
    // Structural, not user-facing: a descriptor with no canvas cannot be
    // rendered at all, and `registry.test.ts` asserts every registered kind has
    // exactly one.
    throw new Error(`Design kind "${kind.id}" declares no primary pane`);
  }
  return primary;
}
