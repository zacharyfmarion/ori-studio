import type { MenuActionId } from '../commands/menuActions';
import { shortcutLabelForAction, type ShortcutOverrides } from '../keyboard/shortcuts';
import { EXAMPLE_PROJECTS } from '../examples/catalog';

export type MenuActionItem = {
  type: 'action';
  id: MenuActionId;
  label: string;
  shortcut?: string;
};

/**
 * A menu entry whose id is not part of the static {@link MenuActionId} union —
 * used for data-driven items such as examples, where the id carries a payload
 * (e.g. `file.openExample:<id>`). The shared dispatcher handles these by prefix.
 * No capability lookup is performed.
 */
export type MenuCommandItem = {
  type: 'command';
  actionId: string;
  label: string;
  disabled?: boolean;
};

export type MenuSeparator = {
  type: 'separator';
};

export type MenuSubmenu = {
  type: 'submenu';
  label: string;
  items: MenuItemDef[];
};

export type MenuItemDef = MenuActionItem | MenuCommandItem | MenuSeparator | MenuSubmenu;

export type MenuDef = {
  label: string;
  items: MenuItemDef[];
};

function shortcut(id: MenuActionId, overrides?: ShortcutOverrides): string | undefined {
  return shortcutLabelForAction(id, overrides);
}

/** Build the `Examples ▸` submenu items from the checked-in example catalog. */
function exampleProjectItems(): MenuItemDef[] {
  return EXAMPLE_PROJECTS.map((example) => ({
    type: 'command',
    actionId: `file.openExample:${example.id}`,
    label: example.title,
  }));
}

export function getMenuBarDef(
  overrides?: ShortcutOverrides
): MenuDef[] {
  return [
    {
      label: 'File',
      items: [
        { type: 'action', id: 'file.new', label: 'New', shortcut: shortcut('file.new', overrides) },
        { type: 'action', id: 'file.open', label: 'Open...', shortcut: shortcut('file.open', overrides) },
        { type: 'action', id: 'file.importAdd', label: 'Import (Add)...' },
        { type: 'action', id: 'file.detectCpImage', label: 'Detect CP from Image...' },
        { type: 'submenu', label: 'Examples', items: exampleProjectItems() },
        { type: 'separator' },
        { type: 'action', id: 'file.save', label: 'Save', shortcut: shortcut('file.save', overrides) },
        { type: 'action', id: 'file.saveAs', label: 'Save As...', shortcut: shortcut('file.saveAs', overrides) },
        { type: 'separator' },
        {
          type: 'submenu',
          label: 'Export',
          items: [
            { type: 'action', id: 'file.exportV5', label: 'Export TreeMaker 5...' },
            { type: 'action', id: 'file.exportV4', label: 'Export TreeMaker 4...' },
            { type: 'separator' },
            { type: 'action', id: 'file.exportCp', label: 'Export CP...' },
            { type: 'action', id: 'file.exportFold', label: 'Export FOLD...' },
            { type: 'action', id: 'file.exportOri', label: 'Export ORI...' },
            { type: 'action', id: 'file.exportOrh', label: 'Export ORH...' },
            { type: 'separator' },
            { type: 'action', id: 'file.exportSvg', label: 'Export SVG...' },
            { type: 'action', id: 'file.exportPng', label: 'Export PNG...' },
          ],
        },
        { type: 'separator' },
        { type: 'action', id: 'file.settings', label: 'Settings', shortcut: shortcut('file.settings', overrides) },
      ],
    },
    {
      label: 'Edit',
      items: [
        { type: 'action', id: 'edit.undo', label: 'Undo', shortcut: shortcut('edit.undo', overrides) },
        { type: 'action', id: 'edit.redo', label: 'Redo', shortcut: shortcut('edit.redo', overrides) },
        { type: 'separator' },
        { type: 'action', id: 'edit.cut', label: 'Cut', shortcut: shortcut('edit.cut', overrides) },
        { type: 'action', id: 'edit.copy', label: 'Copy', shortcut: shortcut('edit.copy', overrides) },
        { type: 'action', id: 'edit.paste', label: 'Paste', shortcut: shortcut('edit.paste', overrides) },
        { type: 'separator' },
        { type: 'action', id: 'edit.delete', label: 'Delete Selected', shortcut: shortcut('edit.delete', overrides) },
        { type: 'separator' },
        {
          type: 'submenu',
          label: 'Select',
          items: [
            { type: 'action', id: 'edit.selectAll', label: 'Select All', shortcut: shortcut('edit.selectAll', overrides) },
            { type: 'action', id: 'edit.deselectAll', label: 'Deselect All' },
            { type: 'action', id: 'edit.selectByIndex', label: 'Select By Index...' },
            { type: 'action', id: 'edit.selectMovableParts', label: 'Select Movable Parts' },
            { type: 'action', id: 'edit.selectCorridorFacets', label: 'Select Corridor Facets' },
          ],
        },
        {
          type: 'submenu',
          label: 'Node',
          items: [
            { type: 'action', id: 'edit.makeRoot', label: 'Make Root' },
            { type: 'action', id: 'edit.absorbNodes', label: 'Absorb Nodes' },
            { type: 'action', id: 'edit.absorbRedundantNodes', label: 'Absorb Redundant Nodes' },
            { type: 'separator' },
            { type: 'action', id: 'edit.perturbNodes', label: 'Perturb Nodes' },
            { type: 'action', id: 'edit.perturbAllNodes', label: 'Perturb All Nodes' },
          ],
        },
        {
          type: 'submenu',
          label: 'Edge',
          items: [
            { type: 'action', id: 'edit.splitEdge', label: 'Split Edge...' },
            { type: 'action', id: 'edit.setEdgeLength', label: 'Set Edge Length...' },
            { type: 'action', id: 'edit.scaleEdgeLengths', label: 'Scale Edge Lengths...' },
            { type: 'separator' },
            { type: 'action', id: 'edit.renormalizeToEdge', label: 'Renormalize To Edge' },
            { type: 'action', id: 'edit.renormalizeToUnitScale', label: 'Renormalize To Unit Scale' },
            { type: 'action', id: 'edit.absorbEdges', label: 'Absorb Edges' },
          ],
        },
        {
          type: 'submenu',
          label: 'Strain',
          items: [
            { type: 'action', id: 'edit.removeStrain', label: 'Remove Strain' },
            { type: 'action', id: 'edit.removeAllStrain', label: 'Remove All Strain' },
            { type: 'separator' },
            { type: 'action', id: 'edit.relieveStrain', label: 'Relieve Strain' },
            { type: 'action', id: 'edit.relieveAllStrain', label: 'Relieve All Strain' },
          ],
        },
        {
          type: 'submenu',
          label: 'Stubs',
          items: [
            { type: 'action', id: 'edit.addLargestStubForNodes', label: 'Add Largest Stub From Nodes' },
            { type: 'action', id: 'edit.addLargestStubForPoly', label: 'Add Largest Stub From Poly' },
            { type: 'separator' },
            { type: 'action', id: 'edit.triangulateTree', label: 'Triangulate Tree' },
          ],
        },
      ],
    },
    {
      label: 'View',
      items: [
        { type: 'action', id: 'view.design', label: 'Design' },
        { type: 'action', id: 'view.edit', label: 'Edit' },
        { type: 'action', id: 'view.simulate', label: 'Simulate' },
        { type: 'action', id: 'view.conditions', label: 'Conditions' },
        { type: 'separator' },
        { type: 'action', id: 'view.resetLayout', label: 'Reset Layout' },
      ],
    },
    {
      label: 'Design',
      items: [
        { type: 'action', id: 'optimize.scale', label: 'Optimize Scale', shortcut: shortcut('optimize.scale', overrides) },
        { type: 'action', id: 'optimize.edges', label: 'Optimize Edges' },
        { type: 'action', id: 'optimize.strain', label: 'Optimize Strain' },
        { type: 'separator' },
        { type: 'action', id: 'cp.build', label: 'Build Crease Pattern', shortcut: shortcut('cp.build', overrides) },
      ],
    },
    {
      label: 'Crease Pattern',
      items: [
        {
          type: 'submenu',
          label: 'Selected Lines',
          items: [
            { type: 'action', id: 'cp.deleteSelectedLines', label: 'Delete Selected Lines' },
            { type: 'separator' },
            { type: 'action', id: 'cp.changeCreaseType', label: 'Change Crease Type' },
            { type: 'action', id: 'cp.advanceCreaseType', label: 'Advance Crease Type' },
            { type: 'action', id: 'cp.toggleMountainValley', label: 'Toggle Mountain/Valley' },
            { type: 'separator' },
            { type: 'action', id: 'cp.makeMountain', label: 'Make Mountain' },
            { type: 'action', id: 'cp.makeValley', label: 'Make Valley' },
            { type: 'action', id: 'cp.makeEdge', label: 'Make Edge' },
            { type: 'action', id: 'cp.makeAuxiliary', label: 'Make Auxiliary' },
            { type: 'separator' },
            { type: 'action', id: 'cp.replaceLineType', label: 'Replace Selected Line Type...' },
            { type: 'action', id: 'cp.deleteLineType', label: 'Delete Selected Line Type...' },
          ],
        },
        {
          type: 'submenu',
          label: 'Transform Selection',
          items: [
            { type: 'action', id: 'cp.transformFlipHorizontal', label: 'Flip Horizontal' },
            { type: 'action', id: 'cp.transformFlipVertical', label: 'Flip Vertical' },
            { type: 'separator' },
            { type: 'action', id: 'cp.transformRotateLeft', label: 'Rotate Left 90' },
            { type: 'action', id: 'cp.transformRotateRight', label: 'Rotate Right 90' },
          ],
        },
        {
          type: 'submenu',
          label: 'Diagnostics',
          items: [
            { type: 'action', id: 'cp.checkCamv', label: 'Check CAMV', shortcut: shortcut('cp.checkCamv', overrides) },
            { type: 'action', id: 'cp.check1', label: 'Check Overlaps' },
            { type: 'action', id: 'cp.check2', label: 'Check T-junctions' },
            { type: 'action', id: 'cp.check3', label: 'Check Vertex Foldability' },
            { type: 'action', id: 'cp.check4', label: 'Check Maekawa/LBL' },
          ],
        },
        {
          type: 'submenu',
          label: 'Repair',
          items: [
            { type: 'action', id: 'cp.fix1', label: 'Repair Overlaps' },
            { type: 'action', id: 'cp.fix2', label: 'Split T-junctions' },
            { type: 'action', id: 'cp.fixInaccurate', label: 'Fix Inaccurate Creases...' },
          ],
        },
        {
          type: 'submenu',
          label: 'Annotations',
          items: [
            { type: 'action', id: 'cp.changeCircleColor', label: 'Change Circle Color...' },
            { type: 'action', id: 'cp.organizeCircles', label: 'Organize Circles' },
          ],
        },
      ],
    },
    {
      label: 'Help',
      items: [
        { type: 'action', id: 'help.documentation', label: 'Ori Studio Help', shortcut: shortcut('help.documentation', overrides) },
        { type: 'separator' },
        { type: 'action', id: 'help.about', label: 'About Ori Studio' },
      ],
    },
  ];
}
