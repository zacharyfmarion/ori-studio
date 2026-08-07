import { describe, expect, it } from 'vitest';
import {
  getWorkspaceCapabilities,
  maskCapabilitiesForContext,
  type WorkspaceCapabilities,
  type WorkspaceCapabilityId,
} from '../lib/workspaceCapabilities';
import type { EditingContext } from '../workspaces/editingContext';

/**
 * Every editing context the shell can be in. Masking is a total function of this
 * value, so equivalence has to be checked across all of them, not a sample.
 */
const ALL_CONTEXTS: EditingContext[] = [
  'design-nux',
  'treemaker-tree',
  'bp-tree',
  'bp-packing',
  'crease-pattern',
  'simulate',
];

/**
 * The masking rules exactly as they stood before the design-kind registry, kept
 * here as an oracle.
 *
 * Phase 0 claims to move per-kind capability rules onto the descriptors without
 * changing what the user sees. That claim is only worth anything if it is
 * checked against the old behavior rather than against a re-reading of the new
 * code, so this copy stays until a later phase deliberately changes a rule — at
 * which point the diff to this function is the record of what changed.
 */
const LEGACY_TREE_ONLY = new Set<WorkspaceCapabilityId>([
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
]);

const LEGACY_BP_HIDDEN = new Set<WorkspaceCapabilityId>([
  ...LEGACY_TREE_ONLY,
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
]);

const LEGACY_SIMULATE_VISIBLE_EDIT = new Set<WorkspaceCapabilityId>(['edit.undo', 'edit.redo']);

function legacyMask(
  capabilities: WorkspaceCapabilities,
  context: EditingContext
): WorkspaceCapabilities {
  const masked = { ...capabilities };
  const ids = Object.keys(masked) as WorkspaceCapabilityId[];
  const hide = (id: WorkspaceCapabilityId) => {
    masked[id] = { ...masked[id], visible: false, enabled: false };
  };

  if (context !== 'treemaker-tree') {
    for (const id of LEGACY_TREE_ONLY) hide(id);
  }

  if (context !== 'crease-pattern') {
    for (const id of ids) {
      if (id.startsWith('cp.') && id !== 'cp.build') hide(id);
    }
  }

  if (context === 'simulate') {
    for (const id of ids) {
      const isAuthoring =
        id.startsWith('cp.') ||
        id.startsWith('optimize.') ||
        (id.startsWith('edit.') && !LEGACY_SIMULATE_VISIBLE_EDIT.has(id));
      if (isAuthoring) hide(id);
    }
    return masked;
  }

  if (context === 'bp-tree' || context === 'bp-packing') {
    for (const id of ids) {
      if (id.startsWith('optimize.') || id.startsWith('cp.') || LEGACY_BP_HIDDEN.has(id)) {
        hide(id);
      }
    }
  }

  return masked;
}

/**
 * A capability set with everything visible and enabled, so masking is the only
 * thing that can turn anything off. Built from the real id list rather than a
 * hand-written one, so a capability added later is covered automatically.
 */
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
    boxPleatCanSubdivide: true,
    boxPleatCanUnsubdivide: false,
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

function hiddenIds(capabilities: WorkspaceCapabilities): string[] {
  return Object.entries(capabilities)
    .filter(([, capability]) => !capability.visible)
    .map(([id]) => id)
    .sort();
}

describe('registry-driven capability masking', () => {
  it('covers a non-trivial set of capabilities', () => {
    // Guards the whole suite: if the fixture ever produced an empty or tiny id
    // list, every equivalence assertion below would pass vacuously.
    expect(Object.keys(allVisibleCapabilities()).length).toBeGreaterThan(30);
  });

  it.each(ALL_CONTEXTS)('matches the pre-registry rules in %s', (context) => {
    const base = allVisibleCapabilities();
    expect(hiddenIds(maskCapabilitiesForContext(base, context))).toEqual(
      hiddenIds(legacyMask(base, context))
    );
  });

  it.each(ALL_CONTEXTS)('also matches on enabled, not just visible, in %s', (context) => {
    const base = allVisibleCapabilities();
    expect(maskCapabilitiesForContext(base, context)).toEqual(legacyMask(base, context));
  });

  it('hides cp.build in a box-pleat context but not in the chooser', () => {
    // The one rule that needed explicit modelling: the shared "hide cp.* outside
    // the CP editor" rule exempts `cp.build`, but box-pleat hides it too. It is
    // asserted directly because the equivalence oracle above would keep passing
    // if both sides regressed together.
    const base = allVisibleCapabilities();
    expect(maskCapabilitiesForContext(base, 'bp-tree')['cp.build'].visible).toBe(false);
    expect(maskCapabilitiesForContext(base, 'bp-packing')['cp.build'].visible).toBe(false);
    expect(maskCapabilitiesForContext(base, 'design-nux')['cp.build'].visible).toBe(true);
    expect(maskCapabilitiesForContext(base, 'treemaker-tree')['cp.build'].visible).toBe(true);
  });

  it("hides a kind's owned capabilities everywhere except that kind", () => {
    const base = allVisibleCapabilities();
    // `edit.makeRoot` is TreeMaker-owned.
    expect(maskCapabilitiesForContext(base, 'treemaker-tree')['edit.makeRoot'].visible).toBe(true);
    for (const context of ALL_CONTEXTS.filter((c) => c !== 'treemaker-tree')) {
      expect(maskCapabilitiesForContext(base, context)['edit.makeRoot'].visible).toBe(false);
    }
  });
});
