import { Telescope } from 'lucide-react';
import { exploriDocument } from '../explori/handles';
import { createExploriCodec } from '../explori/handles';
import { deletableExploriNodeId } from '../explori/deletion';
import { exploriResultToFold } from '../explori/foldExport';
import { exploriTilingLabel } from '../explori/types';
import type { WorkspaceCapabilityId } from '../lib/workspaceCapabilities';
import type { DesignKindDescriptor, SendToEditPayload, SendToEditRequest } from './types';

/**
 * Commands that make no sense while searching the 22.5° archive.
 *
 * An ExplOri design is a query, not a construction: there is nothing of ours to
 * optimize, and nothing to export until a result has been chosen and sent to the
 * Edit canvas — which is where every export already lives.
 */
const EXPLORI_HIDDEN_CAPABILITIES: readonly WorkspaceCapabilityId[] = [
  'view.conditions',
  'file.exportV5',
  'file.exportV4',
  'file.exportCp',
  'file.exportFold',
  'file.exportOri',
  'file.exportOrh',
  'file.exportSvg',
  'file.exportPng',
  'file.exportFoldedFold',
  'file.exportObj',
  'file.exportStl',
];

export function createExploriSendToEdit() {
  return async function sendToEdit(
    handle: number,
    request: SendToEditRequest
  ): Promise<SendToEditPayload> {
    const document = exploriDocument(handle);
    const selected = document?.selected;
    if (!selected) {
      // Structural: the Send to Edit affordances are only offered from a result,
      // so reaching here means a caller invented one.
      throw new Error('This ExplOri design has no chosen result to send.');
    }
    return {
      text: exploriResultToFold(selected, request.title),
      format: 'fold',
      label: 'Sent ExplOri result to Edit',
      filename: `${exploriTilingLabel(selected)}.fold`,
    };
  };
}

export function createExploriDesignKind(): DesignKindDescriptor {
  return {
    id: 'explori',
    // No engine: the document is plain JSON held by `explori/handles.ts`, so
    // there is no worker whose death could invalidate it.
    engine: null,
    osfKind: 'explori',
    analyticsId: 'explori',
    chooser: {
      order: 2,
      copy: (t) => ({
        title: t('panels:design.methodChooser.explori.title', 'Search 22.5°'),
        description: t(
          'panels:design.methodChooser.explori.description',
          'Draw a tree and find crease patterns that match it, from the ExplOri archive.'
        ),
      }),
      Icon: Telescope,
      // Nothing to wait for: the search runs on someone else's server and the
      // document is plain data, so neither engine has to be up.
      isAvailable: () => true,
    },
    panes: [
      {
        id: 'tree',
        component: 'explori-tree',
        title: (t) => t('panels:design.paneTitle.exploriTree', 'Tree'),
        placement: { kind: 'primary' },
        editingContext: 'explori-tree',
      },
      {
        id: 'results',
        component: 'explori-results',
        title: (t) => t('panels:design.paneTitle.exploriResults', 'Results'),
        placement: { kind: 'split', direction: 'right' },
        editingContext: 'explori-results',
      },
    ],
    capabilities: {
      owned: [],
      hiddenIds: EXPLORI_HIDDEN_CAPABILITIES,
      hiddenPrefixes: ['optimize.', 'cp.', 'bp.'],
    },
    history: (tab) =>
      tab.kind === 'explori'
        ? { past: tab.explori.historyPast.length, future: tab.explori.historyFuture.length }
        : { past: 0, future: 0 },
    deletableTarget: (tab) =>
      tab.kind === 'explori'
        ? deletableExploriNodeId(tab.explori.document, tab.explori.selection)
        : null,
    // The document is plain JSON and always present.
    isSavable: () => true,
    codec: createExploriCodec(),
    sendToEdit: createExploriSendToEdit(),
  };
}
