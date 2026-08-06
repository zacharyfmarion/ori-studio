import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import {
  maskCapabilitiesForContext,
  getWorkspaceCapabilities,
  type WorkspaceCapabilities,
  type WorkspaceCapabilityId,
} from '../lib/workspaceCapabilities';
import { ENGINE_IDS } from '../engines/engineHost';
import type { EditingContext } from '../workspaces/editingContext';
import { DESIGN_KINDS, designKindRegistry, primaryPane } from './registry';
import type { DesignKindDescriptor } from './types';

/** Renders inline English defaults, matching the app's fallback translator. */
const t = ((_key: string, defaultValue?: string) =>
  defaultValue ?? _key) as unknown as TFunction;

describe('design kind registry', () => {
  it('registers every shipped kind', () => {
    expect(designKindRegistry().ids).toEqual(['treemaker', 'box-pleat', 'explori']);
  });

  it.each(DESIGN_KINDS.map((kind) => [kind.id, kind] as const))(
    '%s declares a complete descriptor',
    (_id, kind) => {
      expect(kind.osfKind).toBeTruthy();
      // A kind may legitimately have no engine: its documents are plain data.
      if (kind.engine !== null) expect(ENGINE_IDS).toContain(kind.engine);
      expect(kind.analyticsId).toBeTruthy();
      expect(kind.panes.length).toBeGreaterThan(0);
      expect(typeof kind.sendToEdit).toBe('function');
      for (const method of ['create', 'hydrate', 'serialize', 'free'] as const) {
        expect(typeof kind.codec[method]).toBe('function');
      }
    }
  );

  it.each(DESIGN_KINDS.map((kind) => [kind.id, kind] as const))(
    '%s has exactly one primary pane',
    (_id, kind) => {
      const primaries = kind.panes.filter((pane) => pane.placement.kind === 'primary');
      expect(primaries).toHaveLength(1);
      expect(primaryPane(kind)).toBe(primaries[0]);
    }
  );

  it.each(DESIGN_KINDS.map((kind) => [kind.id, kind] as const))(
    '%s gives every pane a unique id',
    (_id, kind) => {
      const ids = kind.panes.map((pane) => pane.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  );

  it('maps each design editing context to exactly one kind', () => {
    const registry = designKindRegistry();
    expect(registry.forContext('treemaker-tree')?.id).toBe('treemaker');
    expect(registry.forContext('bp-tree')?.id).toBe('box-pleat');
    expect(registry.forContext('bp-packing')?.id).toBe('box-pleat');
  });

  it('claims no kind for the contexts no design owns', () => {
    const registry = designKindRegistry();
    for (const context of ['design-nux', 'crease-pattern', 'simulate'] as EditingContext[]) {
      expect(registry.forContext(context)).toBeUndefined();
    }
  });

  it('renders chooser copy and pane titles through the translator', () => {
    for (const kind of DESIGN_KINDS) {
      const copy = kind.chooser.copy(t);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
      for (const pane of kind.panes) {
        expect(pane.title(t).length).toBeGreaterThan(0);
      }
    }
  });

  it('orders chooser cards by their declared order', () => {
    const order = designKindRegistry().chooserOrder.map((kind) => kind.id);
    expect(order).toEqual(['treemaker', 'box-pleat', 'explori']);
  });

});

/**
 * The executable form of the "a third design kind is trivial to add" claim.
 *
 * A stub kind is registered and driven through the consumers that Phase 0 has
 * made registry-driven. Anything that needs an edit outside `designKinds/` to
 * make this pass is a field the descriptor interface is missing.
 */
describe('extensibility: a third design kind', () => {
  /**
   * `EditingContext` is a closed union, so a stub kind cannot invent a context
   * without editing `workspaces/editingContext.ts`. That is a real, known cost of
   * adding a kind — see the Phase 0 notes — and it is one line. The cast stands
   * in for that line so the rest of the machinery can be exercised here.
   */
  const STUB_CONTEXT = 'stub-design' as EditingContext;

  const stubKind: DesignKindDescriptor = {
    id: 'stub' as DesignKindDescriptor['id'],
    engine: 'treemaker',
    osfKind: 'treemaker-tree',
    analyticsId: 'stub',
    chooser: {
      order: 99,
      copy: () => ({ title: 'Stub', description: 'A design kind that exists only in tests.' }),
      Icon: () => null,
      isAvailable: () => true,
    },
    panes: [
      {
        id: 'canvas',
      component: 'design',
        title: () => 'Stub canvas',
        placement: { kind: 'primary' },
        editingContext: STUB_CONTEXT,
      },
    ],
    capabilities: {
      // Owns nothing, so registering it cannot change any other context. The
      // `owned` path gets its own kind below, where changing other contexts is
      // the behavior under test rather than a side effect.
      owned: [],
      hiddenIds: ['file.exportSvg'],
      hiddenPrefixes: ['optimize.'],
    },
    codec: {
      create: async () => 1,
      hydrate: async () => 2,
      serialize: async () => 'stub',
      free: async () => undefined,
    },
    sendToEdit: async () => ({
      text: '',
      format: 'fold',
      label: 'Sent stub to Edit',
      filename: 'stub.fold',
    }),
  };

  const kinds = [...DESIGN_KINDS, stubKind];

  function allVisibleCapabilities(): WorkspaceCapabilities {
    const real = getWorkspaceCapabilities({
      activeEditingContext: 'treemaker-tree',
      engineReady: true,
      status: 'ready',
      edgeCount: 0,
      creaseCount: 0,
      facetCount: 0,
      hasEditableCreasePattern: false,
      hasImportedCreasePattern: false,
      hasBoxPleatDocument: false,
      boxPleatTreeEdgeCount: 0,
      boxPleatBusy: false,
      hasSimulationModel: false,
      oristudioCpSelectedLineCount: 0,
      oristudioCpSelectedPointCount: 0,
      oristudioCpSelectedCircleCount: 0,
      hasDeletableBpSelection: false,
      historyPastCount: 0,
      historyFutureCount: 0,
      clipboard: null,
      selection: { kind: 'tree' },
    });
    const ids = Object.keys(real) as WorkspaceCapabilityId[];
    return Object.fromEntries(
      ids.map((id) => [id, { enabled: true, visible: true, label: id, reason: '' }])
    ) as WorkspaceCapabilities;
  }

  it('resolves through the registry with no other change', () => {
    const registry = designKindRegistry(kinds);
    expect(registry.ids).toContain('stub');
    expect(registry.forContext(STUB_CONTEXT)?.id).toBe('stub');
    expect(primaryPane(stubKind).id).toBe('canvas');
  });

  it('appears in the chooser in its declared position', () => {
    expect(designKindRegistry(kinds).chooserOrder.map((kind) => kind.id)).toEqual([
      'treemaker',
      'box-pleat',
      'explori',
      'stub',
    ]);
  });

  it('masks capabilities in its own context without touching the mask function', () => {
    const base = allVisibleCapabilities();
    const masked = maskCapabilitiesForContext(base, STUB_CONTEXT, kinds);
    // Its own declared suppressions apply.
    expect(masked['file.exportSvg'].visible).toBe(false);
    expect(masked['optimize.scale'].visible).toBe(false);
    // Other kinds' owned capabilities are hidden, as in any foreign context.
    expect(masked['edit.makeRoot'].visible).toBe(false);
    // Untouched capabilities stay visible.
    expect(masked['file.save'].visible).toBe(true);
  });

  it('registering it changes nothing for the shipped kinds', () => {
    const base = allVisibleCapabilities();
    for (const context of [
      'design-nux',
      'treemaker-tree',
      'bp-tree',
      'bp-packing',
      'crease-pattern',
      'simulate',
    ] as EditingContext[]) {
      expect(
        maskCapabilitiesForContext(base, context, kinds),
        `context ${context}`
      ).toEqual(maskCapabilitiesForContext(base, context, DESIGN_KINDS));
    }
  });

  it('a kind that owns a capability hides it in every other context', () => {
    // Separated from the stub above because claiming a capability is *supposed*
    // to restrict it elsewhere — that is the feature, not a regression.
    const owningStub: DesignKindDescriptor = {
      ...stubKind,
      id: 'owning-stub' as DesignKindDescriptor['id'],
      capabilities: { owned: ['view.conditions'], hiddenIds: [], hiddenPrefixes: [] },
    };
    const withOwner = [...DESIGN_KINDS, owningStub];
    const base = allVisibleCapabilities();

    expect(maskCapabilitiesForContext(base, STUB_CONTEXT, withOwner)['view.conditions'].visible).toBe(
      true
    );
    for (const context of ['treemaker-tree', 'crease-pattern'] as EditingContext[]) {
      expect(
        maskCapabilitiesForContext(base, context, withOwner)['view.conditions'].visible,
        `context ${context}`
      ).toBe(false);
    }
  });
});
