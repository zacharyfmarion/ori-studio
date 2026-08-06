import { DraftingCompass } from 'lucide-react';
import type { EngineClient } from '../store/workspaceStore/engineRuntime';
import type { WorkspaceCapabilityId } from '../lib/workspaceCapabilities';
import type {
  DesignKindCodec,
  DesignKindDescriptor,
  SendToEditPayload,
  SendToEditRequest,
} from './types';

/**
 * Edit commands that only mean anything while authoring a TreeMaker tree. Hidden
 * in every other context, which is what collapses the Node/Edge/Strain/Stubs
 * submenus and the tree-only Select items away from the CP editor, BP, Simulate,
 * and the chooser.
 *
 * Moved here verbatim from `workspaceCapabilities.ts`, where it was a
 * module-level constant that the masking function special-cased by name.
 */
const TREEMAKER_OWNED_CAPABILITIES: readonly WorkspaceCapabilityId[] = [
  'edit.makeRoot',
  'edit.splitEdge',
  'edit.setEdgeLength',
  'edit.scaleEdgeLengths',
  'edit.renormalizeToEdge',
  'edit.renormalizeToUnitScale',
  'edit.absorbNodes',
  'edit.absorbRedundantNodes',
  'edit.absorbEdges',
  'edit.perturbNodes',
  'edit.perturbAllNodes',
  'edit.removeStrain',
  'edit.removeAllStrain',
  'edit.relieveStrain',
  'edit.relieveAllStrain',
  'edit.addLargestStubForNodes',
  'edit.addLargestStubForPoly',
  'edit.triangulateTree',
  'edit.selectByIndex',
  'edit.selectMovableParts',
  'edit.selectCorridorFacets',
];

/**
 * Paper the blank tree starts on. Matches `createBlankTree`/`createStarterTree`
 * in `engineRuntime`, which is what picking Circle-packed produces today.
 */
const BLANK_PAPER = { paper_width: 1, paper_height: 1 } as const;

/**
 * The codec takes its client from a factory so tests can supply a fake, and so
 * this module carries no runtime dependency on `engineRuntime` — the descriptor
 * is imported by the capability layer, which must not drag the engine in with it.
 */
export function createTreemakerCodec(
  getClient: () => Promise<EngineClient>
): DesignKindCodec {
  return {
    async create() {
      const api = await getClient();
      return api.newDesign(BLANK_PAPER);
    },
    async hydrate(text: string) {
      const api = await getClient();
      return api.loadTmd(text);
    },
    async serialize(handle: number) {
      const api = await getClient();
      return api.saveTmd5(handle);
    },
    async free(handle: number) {
      const api = await getClient();
      // Freeing an already-dead handle is not an error worth surfacing: the
      // registry frees on close, on eviction, and in failure paths, and those can
      // legitimately race. Matches how `engineRuntime` already swallows it.
      await api.freeTree(handle).catch(() => undefined);
    },
  };
}

export function createTreemakerSendToEdit(getClient: () => Promise<EngineClient>) {
  return async function sendToEdit(
    handle: number,
    request: SendToEditRequest
  ): Promise<SendToEditPayload> {
    const api = await getClient();
    // Build creases first: `exportFold` reads what the last build produced, so
    // exporting without this hands over a stale (or empty) crease pattern.
    await api.buildCreasePattern(handle);
    return {
      text: await api.exportFold(handle),
      // The engine's FOLD already uses the CP editor's crease convention, so no
      // ORIPA-style 2<->3 swap is needed here (unlike box-pleat).
      format: 'fold',
      label: 'Sent design to Edit',
      filename: `${request.title || 'design'}.fold`,
    };
  };
}

export function createTreemakerDesignKind(
  getClient: () => Promise<EngineClient>
): DesignKindDescriptor {
  return {
    id: 'treemaker',
    engine: 'treemaker',
    osfKind: 'treemaker-tree',
    analyticsId: 'treemaker',
    chooser: {
      order: 0,
      // Literal `t()` calls, so `i18n:extract` sees these strings. Same keys the
      // chooser used before the registry, so no catalog entry moves.
      copy: (t) => ({
        title: t('panels:design.methodChooser.circlePacked.title', 'Circle-packed'),
        description: t(
          'panels:design.methodChooser.circlePacked.description',
          'Sketch a tree and let circle/river packing optimize the base, TreeMaker-style.'
        ),
      }),
      Icon: DraftingCompass,
      // Circle-packing runs on the treemaker engine — wait for it to load.
      isAvailable: ({ engineReady }) => engineReady,
    },
    panes: [
      {
        id: 'tree',
        component: 'design',
        title: (t) => t('panels:design.paneTitle.tree', 'Design'),
        placement: { kind: 'primary' },
        editingContext: 'treemaker-tree',
      },
      {
        id: 'inspector',
        component: 'inspector',
        title: (t) => t('panels:design.paneTitle.inspector', 'Inspector'),
        placement: { kind: 'side', group: 'tools', initialWidth: 320 },
        editingContext: 'treemaker-tree',
      },
      {
        id: 'diagnostics',
        component: 'diagnostics',
        title: (t) => t('panels:design.paneTitle.diagnostics', 'Diagnostics'),
        placement: { kind: 'side', group: 'tools', inactive: true },
        editingContext: 'treemaker-tree',
      },
      {
        id: 'conditions',
        component: 'conditions',
        title: (t) => t('panels:design.paneTitle.conditions', 'Conditions'),
        placement: { kind: 'side', group: 'tools', inactive: true },
        editingContext: 'treemaker-tree',
      },
    ],
    capabilities: {
      owned: TREEMAKER_OWNED_CAPABILITIES,
      // TreeMaker suppresses nothing of its own. `cp.*` is hidden outside the CP
      // editor by a rule that belongs to that surface, not to this kind.
      hiddenIds: [],
      hiddenPrefixes: [],
    },
    codec: createTreemakerCodec(getClient),
    sendToEdit: createTreemakerSendToEdit(getClient),
  };
}
