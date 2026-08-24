import { Tag, Unlink } from 'lucide-react';
import {
  ViewportToolbar,
  viewportLayerItems,
  viewportSymmetryItems,
  type ViewportToolbarGroupSpec,
} from '../components/panels/ViewportToolbar';
import type { TreeEditorCopy, TreeSymmetryHost, TreeViewLayers } from './host';

/**
 * Zoom, mirror draw, and layers for a tree canvas.
 *
 * The mirror controls disappear entirely when the surface has no symmetry host,
 * rather than rendering disabled: a surface without a mirror has no "off" state
 * to show.
 */
export function TreeEditorToolbar({
  copy,
  zoomPercent,
  layers,
  onLayerChange,
  symmetry,
  canUnpair,
  onUnpair,
  zoomIn,
  zoomOut,
  fitToView,
  setZoomLevel,
}: {
  copy: TreeEditorCopy;
  zoomPercent: number;
  layers: TreeViewLayers;
  onLayerChange: (layer: keyof TreeViewLayers, visible: boolean) => void;
  symmetry: TreeSymmetryHost | null;
  canUnpair: boolean;
  onUnpair: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;
  setZoomLevel: (scale: number) => void;
}) {
  const groups: ViewportToolbarGroupSpec[] = [
    ...(symmetry
      ? [
          {
            id: 'symmetry',
            items: [
              ...viewportSymmetryItems({
                enabled: symmetry.enabled,
                label: copy.symmetry,
                title: symmetry.enabled ? copy.mirrorDrawOn : copy.mirrorDraw,
                onToggle: symmetry.toggle,
              }),
              canUnpair && {
                kind: 'action' as const,
                id: 'unpair',
                label: copy.unpair,
                icon: <Unlink size={14} />,
                onSelect: onUnpair,
              },
            ],
          },
        ]
      : []),
    {
      id: 'layers',
      items: viewportLayerItems({
        title: copy.layers,
        options: [{ key: 'labels' as const, icon: <Tag size={13} />, label: copy.layerLabels }],
        visible: layers,
        onChange: onLayerChange,
      }),
    },
  ];

  return (
    <ViewportToolbar
      ariaLabel={copy.viewportControls}
      zoomPercent={zoomPercent}
      zoomIn={zoomIn}
      zoomOut={zoomOut}
      fitToView={fitToView}
      setZoomLevel={setZoomLevel}
      groups={groups}
    />
  );
}
