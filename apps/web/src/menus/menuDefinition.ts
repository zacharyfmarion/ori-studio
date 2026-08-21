import type { MenuActionId } from '../commands/menuActions';
import { shortcutLabelForAction, type ShortcutResolutionInput } from '../keyboard/shortcuts';
import { surfaceSupports } from '../platform/capabilities';

/**
 * Minimal translator shape: `(key, englishDefault) => localized`. The app passes
 * react-i18next's `t`; callers that only need English (tests, native-menu wiring) can omit
 * it and get the inline English defaults via {@link identityTranslate}.
 */
export type MenuTranslate = (key: string, defaultValue: string) => string;

const identityTranslate: MenuTranslate = (_key, defaultValue) => defaultValue;

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

function shortcut(id: MenuActionId, resolution?: ShortcutResolutionInput): string | undefined {
  return shortcutLabelForAction(id, resolution);
}

export function getMenuBarDef(
  resolution?: ShortcutResolutionInput,
  t: MenuTranslate = identityTranslate
): MenuDef[] {
  return [
    {
      label: t('menu:menubar.file', 'File'),
      items: [
        { type: 'action', id: 'file.new', label: t('menu:file.new', 'New Project'), shortcut: shortcut('file.new', resolution) },
        { type: 'action', id: 'file.open', label: t('menu:file.open', 'Open...'), shortcut: shortcut('file.open', resolution) },
        { type: 'action', id: 'file.importAdd', label: t('menu:file.importAdd', 'Import (Add)...') },
        // "Detect CP from Image..." is still experimental — dev builds only.
        ...(import.meta.env.DEV
          ? [
              {
                type: 'action' as const,
                id: 'file.detectCpImage' as const,
                label: t('menu:file.detectCpImage', 'Detect CP from Image...'),
              },
            ]
          : []),
        { type: 'separator' },
        { type: 'action', id: 'file.save', label: t('menu:file.save', 'Save'), shortcut: shortcut('file.save', resolution) },
        { type: 'action', id: 'file.saveAs', label: t('menu:file.saveAs', 'Save As...'), shortcut: shortcut('file.saveAs', resolution) },
        { type: 'separator' },
        {
          type: 'submenu',
          label: t('menu:file.export', 'Export'),
          items: [
            { type: 'action', id: 'file.exportV5', label: t('menu:file.exportV5', 'Export TreeMaker 5...') },
            { type: 'action', id: 'file.exportV4', label: t('menu:file.exportV4', 'Export TreeMaker 4...') },
            { type: 'separator' },
            { type: 'action', id: 'file.exportCp', label: t('menu:file.exportCp', 'Export CP...') },
            { type: 'action', id: 'file.exportFold', label: t('menu:file.exportFold', 'Export FOLD...') },
            { type: 'action', id: 'file.exportBps', label: t('menu:file.exportBps', 'Export .bps...') },
            { type: 'action', id: 'file.exportOri', label: t('menu:file.exportOri', 'Export ORI...') },
            { type: 'action', id: 'file.exportOrh', label: t('menu:file.exportOrh', 'Export ORH...') },
            { type: 'separator' },
            { type: 'action', id: 'file.exportSvg', label: t('menu:file.exportSvg', 'Export SVG...') },
            { type: 'action', id: 'file.exportPng', label: t('menu:file.exportPng', 'Export PNG...') },
          ],
        },
        { type: 'separator' },
        { type: 'action', id: 'file.settings', label: t('menu:file.settings', 'Settings'), shortcut: shortcut('file.settings', resolution) },
      ],
    },
    {
      label: t('menu:menubar.edit', 'Edit'),
      items: [
        { type: 'action', id: 'edit.undo', label: t('menu:edit.undo', 'Undo'), shortcut: shortcut('edit.undo', resolution) },
        { type: 'action', id: 'edit.redo', label: t('menu:edit.redo', 'Redo'), shortcut: shortcut('edit.redo', resolution) },
        { type: 'separator' },
        { type: 'action', id: 'edit.cut', label: t('menu:edit.cut', 'Cut'), shortcut: shortcut('edit.cut', resolution) },
        { type: 'action', id: 'edit.copy', label: t('menu:edit.copy', 'Copy'), shortcut: shortcut('edit.copy', resolution) },
        { type: 'action', id: 'edit.paste', label: t('menu:edit.paste', 'Paste'), shortcut: shortcut('edit.paste', resolution) },
        { type: 'separator' },
        { type: 'action', id: 'edit.delete', label: t('menu:edit.delete', 'Delete Selected'), shortcut: shortcut('edit.delete', resolution) },
        { type: 'separator' },
        {
          type: 'submenu',
          label: t('menu:edit.select', 'Select'),
          items: [
            { type: 'action', id: 'edit.selectAll', label: t('menu:edit.selectAll', 'Select All'), shortcut: shortcut('edit.selectAll', resolution) },
            { type: 'action', id: 'edit.deselectAll', label: t('menu:edit.deselectAll', 'Deselect All') },
            { type: 'action', id: 'edit.selectByIndex', label: t('menu:edit.selectByIndex', 'Select By Index...') },
            { type: 'action', id: 'edit.selectMovableParts', label: t('menu:edit.selectMovableParts', 'Select Movable Parts') },
            { type: 'action', id: 'edit.selectCorridorFacets', label: t('menu:edit.selectCorridorFacets', 'Select Corridor Facets') },
          ],
        },
        {
          type: 'submenu',
          label: t('menu:edit.node', 'Node'),
          items: [
            { type: 'action', id: 'edit.makeRoot', label: t('menu:edit.makeRoot', 'Make Root') },
            { type: 'action', id: 'edit.absorbNodes', label: t('menu:edit.absorbNodes', 'Absorb Nodes') },
            { type: 'action', id: 'edit.absorbRedundantNodes', label: t('menu:edit.absorbRedundantNodes', 'Absorb Redundant Nodes') },
            { type: 'separator' },
            { type: 'action', id: 'edit.perturbNodes', label: t('menu:edit.perturbNodes', 'Perturb Nodes') },
            { type: 'action', id: 'edit.perturbAllNodes', label: t('menu:edit.perturbAllNodes', 'Perturb All Nodes') },
          ],
        },
        {
          type: 'submenu',
          label: t('menu:edit.edge', 'Edge'),
          items: [
            { type: 'action', id: 'edit.splitEdge', label: t('menu:edit.splitEdge', 'Split Edge...') },
            { type: 'action', id: 'edit.setEdgeLength', label: t('menu:edit.setEdgeLength', 'Set Edge Length...') },
            { type: 'action', id: 'edit.scaleEdgeLengths', label: t('menu:edit.scaleEdgeLengths', 'Scale Edge Lengths...') },
            { type: 'separator' },
            { type: 'action', id: 'edit.renormalizeToEdge', label: t('menu:edit.renormalizeToEdge', 'Renormalize To Edge') },
            { type: 'action', id: 'edit.renormalizeToUnitScale', label: t('menu:edit.renormalizeToUnitScale', 'Renormalize To Unit Scale') },
            { type: 'action', id: 'edit.absorbEdges', label: t('menu:edit.absorbEdges', 'Absorb Edges') },
          ],
        },
        {
          type: 'submenu',
          label: t('menu:edit.strain', 'Strain'),
          items: [
            { type: 'action', id: 'edit.removeStrain', label: t('menu:edit.removeStrain', 'Remove Strain') },
            { type: 'action', id: 'edit.removeAllStrain', label: t('menu:edit.removeAllStrain', 'Remove All Strain') },
            { type: 'separator' },
            { type: 'action', id: 'edit.relieveStrain', label: t('menu:edit.relieveStrain', 'Relieve Strain') },
            { type: 'action', id: 'edit.relieveAllStrain', label: t('menu:edit.relieveAllStrain', 'Relieve All Strain') },
          ],
        },
        {
          type: 'submenu',
          label: t('menu:edit.stubs', 'Stubs'),
          items: [
            { type: 'action', id: 'edit.addLargestStubForNodes', label: t('menu:edit.addLargestStubForNodes', 'Add Largest Stub From Nodes') },
            { type: 'action', id: 'edit.addLargestStubForPoly', label: t('menu:edit.addLargestStubForPoly', 'Add Largest Stub From Poly') },
            { type: 'separator' },
            { type: 'action', id: 'edit.triangulateTree', label: t('menu:edit.triangulateTree', 'Triangulate Tree') },
          ],
        },
      ],
    },
    {
      label: t('menu:menubar.view', 'View'),
      items: [
        { type: 'action', id: 'view.design', label: t('menu:view.design', 'Design') },
        { type: 'action', id: 'view.edit', label: t('menu:view.edit', 'Edit') },
        { type: 'action', id: 'view.simulate', label: t('menu:view.simulate', 'Simulate') },
        { type: 'separator' },
        { type: 'action', id: 'view.resetLayout', label: t('menu:view.resetLayout', 'Reset Layout') },
      ],
    },
    {
      label: t('menu:menubar.design', 'Design'),
      items: [
        // BP-only, and the only visible items in a box-pleat design (every other
        // entry here is TreeMaker-tree authoring, which the BP mask hides).
        { type: 'action', id: 'bp.optimize.layout', label: t('menu:bp.optimizeLayout', 'Optimize Layout…') },
        { type: 'separator' },
        { type: 'action', id: 'bp.layout.subdivide', label: t('menu:bp.subdivide', 'Subdivide Grid') },
        { type: 'action', id: 'bp.layout.unsubdivide', label: t('menu:bp.unsubdivide', 'Un-subdivide Grid') },
        { type: 'action', id: 'bp.layout.rotateRight', label: t('menu:bp.rotateRight', 'Rotate Right') },
        { type: 'action', id: 'bp.layout.rotateLeft', label: t('menu:bp.rotateLeft', 'Rotate Left') },
        { type: 'action', id: 'bp.layout.flipHorizontal', label: t('menu:bp.flipHorizontal', 'Horizontal Flip') },
        { type: 'action', id: 'bp.layout.flipVertical', label: t('menu:bp.flipVertical', 'Vertical Flip') },
        { type: 'separator' },
        { type: 'action', id: 'optimize.scale', label: t('menu:optimize.scale', 'Optimize Scale'), shortcut: shortcut('optimize.scale', resolution) },
        { type: 'action', id: 'optimize.edges', label: t('menu:optimize.edges', 'Optimize Edges') },
        { type: 'action', id: 'optimize.strain', label: t('menu:optimize.strain', 'Optimize Strain') },
        { type: 'separator' },
        { type: 'action', id: 'cp.build', label: t('menu:cp.build', 'Build Crease Pattern'), shortcut: shortcut('cp.build', resolution) },
      ],
    },
    {
      label: t('menu:menubar.creasePattern', 'Crease Pattern'),
      items: [
        {
          type: 'submenu',
          label: t('menu:cp.selectedLines', 'Selected Lines'),
          items: [
            { type: 'action', id: 'cp.deleteSelectedLines', label: t('menu:cp.deleteSelectedLines', 'Delete Selected Lines') },
            { type: 'separator' },
            { type: 'action', id: 'cp.changeCreaseType', label: t('menu:cp.changeCreaseType', 'Change Crease Type') },
            { type: 'action', id: 'cp.advanceCreaseType', label: t('menu:cp.advanceCreaseType', 'Advance Crease Type') },
            { type: 'action', id: 'cp.toggleMountainValley', label: t('menu:cp.toggleMountainValley', 'Toggle Mountain/Valley') },
            { type: 'separator' },
            { type: 'action', id: 'cp.makeMountain', label: t('menu:cp.makeMountain', 'Make Mountain') },
            { type: 'action', id: 'cp.makeValley', label: t('menu:cp.makeValley', 'Make Valley') },
            { type: 'action', id: 'cp.makeEdge', label: t('menu:cp.makeEdge', 'Make Edge') },
            { type: 'action', id: 'cp.makeAuxiliary', label: t('menu:cp.makeAuxiliary', 'Make Auxiliary') },
            { type: 'separator' },
            { type: 'action', id: 'cp.replaceLineType', label: t('menu:cp.replaceLineType', 'Replace Selected Line Type...') },
            { type: 'action', id: 'cp.deleteLineType', label: t('menu:cp.deleteLineType', 'Delete Selected Line Type...') },
          ],
        },
        {
          type: 'submenu',
          label: t('menu:cp.transform', 'Transform Selection'),
          items: [
            { type: 'action', id: 'cp.transformFlipHorizontal', label: t('menu:cp.transformFlipHorizontal', 'Flip Horizontal') },
            { type: 'action', id: 'cp.transformFlipVertical', label: t('menu:cp.transformFlipVertical', 'Flip Vertical') },
            { type: 'separator' },
            { type: 'action', id: 'cp.transformRotateLeft', label: t('menu:cp.transformRotateLeft', 'Rotate Left 90') },
            { type: 'action', id: 'cp.transformRotateRight', label: t('menu:cp.transformRotateRight', 'Rotate Right 90') },
          ],
        },
        {
          type: 'submenu',
          label: t('menu:cp.diagnostics', 'Diagnostics'),
          items: [
            { type: 'action', id: 'cp.checkCamv', label: t('menu:cp.checkCamv', 'Check foldability'), shortcut: shortcut('cp.checkCamv', resolution) },
            { type: 'action', id: 'cp.check1', label: t('menu:cp.check1', 'Check Overlaps') },
            { type: 'action', id: 'cp.check2', label: t('menu:cp.check2', 'Check T-junctions') },
            { type: 'action', id: 'cp.check3', label: t('menu:cp.check3', 'Check Vertex Foldability') },
            { type: 'action', id: 'cp.check4', label: t('menu:cp.check4', 'Check Maekawa/BLB') },
          ],
        },
        {
          type: 'submenu',
          label: t('menu:cp.repair', 'Repair'),
          items: [
            { type: 'action', id: 'cp.fix1', label: t('menu:cp.fix1', 'Repair Overlaps') },
            { type: 'action', id: 'cp.fix2', label: t('menu:cp.fix2', 'Split T-junctions') },
            { type: 'action', id: 'cp.deleteExtraVertices', label: t('menu:cp.deleteExtraVertices', 'Delete Extra Vertices'), shortcut: shortcut('cp.deleteExtraVertices', resolution) },
            { type: 'action', id: 'cp.deleteExtraVerticesIgnoreColor', label: t('menu:cp.deleteExtraVerticesIgnoreColor', 'Delete Extra Vertices (Ignore Type)') },
            { type: 'action', id: 'cp.fixInaccurate', label: t('menu:cp.fixInaccurate', 'Fix Inaccurate Creases...') },
          ],
        },
        {
          type: 'submenu',
          label: t('menu:cp.annotations', 'Annotations'),
          items: [
            { type: 'action', id: 'cp.changeCircleColor', label: t('menu:cp.changeCircleColor', 'Change Circle Color...') },
            { type: 'action', id: 'cp.organizeCircles', label: t('menu:cp.organizeCircles', 'Organize Circles') },
          ],
        },
      ],
    },
    {
      label: t('menu:menubar.help', 'Help'),
      items: [
        // Only where the app can replace itself: the browser build updates by
        // reloading, and iOS updates through the App Store. Spread-gated the
        // same way as the other conditional entries in this file.
        ...(surfaceSupports('selfUpdate')
          ? ([
              {
                type: 'action',
                id: 'help.checkForUpdates',
                label: t('menu:help.checkForUpdates', 'Check for Updates…'),
              },
              { type: 'separator' },
            ] as const)
          : []),
        { type: 'action', id: 'help.about', label: t('menu:help.about', 'About Ori Studio') },
      ],
    },
  ];
}
