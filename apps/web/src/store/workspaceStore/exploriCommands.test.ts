import { describe, expect, it } from 'vitest';
import { createExploriDocument, type ExploriDocument } from '../../explori/document';
import { getWorkspaceCapabilities } from '../../lib/workspaceCapabilities';
import { workspaceCapabilityInput } from './capabilities';
import { createExploriDesignState } from './designContent';
import { singleDesignTab, type DesignTab } from './designTabs';
import type { WorkspaceState } from './types';

/**
 * Undo, Redo and Delete, on an ExplOri design, from the state the Edit menu
 * reads to the command that runs.
 *
 * All three were reported as "does nothing". None of them was a broken command:
 * the commands had ExplOri arms already. They were *disabled* — the capability
 * layer enumerated the kinds it knew and answered 0 / false for the rest, so the
 * menu item was greyed and its keyboard chord declined, and the arm behind it
 * was unreachable. The dispatch tests below would have passed the whole time.
 *
 * So these assert the enabling, which is where the bug actually lived, and they
 * go through `workspaceCapabilityInput` rather than a hand-built input — that
 * function is the thing that used to name kinds.
 */

function exploriTab(patch: Partial<ReturnType<typeof createExploriDesignState>> = {}): DesignTab {
  const base = singleDesignTab('explori', 'Search').designTabs[0];
  if (base.kind !== 'explori') throw new Error('expected an explori tab');
  return { ...base, explori: { ...base.explori, ...patch } };
}

/** A two-node tree: the root, and one leaf that Delete may remove. */
function treeWithLeaf(): ExploriDocument {
  const document = createExploriDocument();
  return {
    ...document,
    nodes: [...document.nodes, { id: 1, loc: { x: 1, y: 1 }, name: '' }],
    edges: [...document.edges, { id: 0, vertices: [0, 1], length: 1 }],
    nextNodeId: 2,
    nextEdgeId: 1,
  };
}

function stateWith(tab: DesignTab): WorkspaceState {
  // Only the fields the capability input reads; the rest of the store is not
  // involved in deciding whether Edit's verbs are live.
  return {
    designTabs: [tab],
    activeDesignId: tab.id,
    activeEditingContext: 'explori-tree',
    engineReady: true,
    status: 'idle',
    oristudioCpDocument: null,
    oristudioCpHistoryPast: [],
    oristudioCpHistoryFuture: [],
    oristudioCpSelection: { lines: [], points: [], circles: [] },
    oristudioBpBusy: false,
    importedCreasePattern: null,
    foldArtifacts: null,
    clipboard: null,
  } as unknown as WorkspaceState;
}

describe('ExplOri — Edit menu verbs are enabled', () => {
  it('enables Undo once the design has history', () => {
    const empty = getWorkspaceCapabilities(workspaceCapabilityInput(stateWith(exploriTab())));
    expect(empty['edit.undo'].enabled).toBe(false);

    const edited = getWorkspaceCapabilities(
      workspaceCapabilityInput(stateWith(exploriTab({ historyPast: [JSON.stringify(createExploriDocument())] })))
    );
    expect(edited['edit.undo'].enabled).toBe(true);
  });

  it('enables Redo once something has been undone', () => {
    const capabilities = getWorkspaceCapabilities(
      workspaceCapabilityInput(stateWith(exploriTab({ historyFuture: [JSON.stringify(createExploriDocument())] })))
    );
    expect(capabilities['edit.redo'].enabled).toBe(true);
  });

  it('enables Delete with a leaf selected, and not with the root', () => {
    const leaf = getWorkspaceCapabilities(
      workspaceCapabilityInput(
        stateWith(exploriTab({ document: treeWithLeaf(), selection: { kind: 'vertex', id: 1 } }))
      )
    );
    expect(leaf['edit.delete'].enabled).toBe(true);

    // The root is not deletable — there would be no tree left to search with.
    const root = getWorkspaceCapabilities(
      workspaceCapabilityInput(
        stateWith(exploriTab({ document: treeWithLeaf(), selection: { kind: 'vertex', id: 0 } }))
      )
    );
    expect(root['edit.delete'].enabled).toBe(false);
  });
});

/**
 * Saving.
 *
 * `file.save` and `file.saveAs` listed the kinds they knew, so an ExplOri design
 * failed all three arms. That was not cosmetic: `saveProject` opens by rejecting
 * a disabled capability, so Cmd+S, the Save button and File ▸ Save all refused —
 * the design could not be written at all, while the file layer had supported the
 * `explori` kind since the day it landed.
 */
describe('ExplOri — the design can be saved', () => {
  it('enables Save and Save As', () => {
    const capabilities = getWorkspaceCapabilities(
      workspaceCapabilityInput(stateWith(exploriTab()))
    );
    expect(capabilities['file.save'].enabled).toBe(true);
    expect(capabilities['file.saveAs'].enabled).toBe(true);
  });

  it('offers the project reason, not the crease-pattern kernel excuse', () => {
    const capabilities = getWorkspaceCapabilities(
      workspaceCapabilityInput(stateWith(exploriTab()))
    );
    expect(capabilities['file.save'].reason).not.toMatch(/crease-pattern kernel/i);
  });
});
