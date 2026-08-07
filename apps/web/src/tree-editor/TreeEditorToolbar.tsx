import { FlipHorizontal2, Tag, Unlink } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import {
  ViewportLayerMenu,
  ViewportToolbar,
  ViewportToolbarSeparator,
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
  return (
    <ViewportToolbar
      ariaLabel={copy.viewportControls}
      zoomPercent={zoomPercent}
      zoomIn={zoomIn}
      zoomOut={zoomOut}
      fitToView={fitToView}
      setZoomLevel={setZoomLevel}
    >
      {symmetry && (
        <>
          <ViewportToolbarSeparator />
          <Button
            size="sm"
            variant="secondary"
            className="tree-editor__symmetry-toggle"
            title={symmetry.enabled ? copy.mirrorDrawOn : copy.mirrorDraw}
            aria-pressed={symmetry.enabled}
            isActive={symmetry.enabled}
            onClick={symmetry.toggle}
          >
            <FlipHorizontal2 size={14} />
            {copy.symmetry}
          </Button>
          {canUnpair && (
            <IconButton size="sm" variant="toolbar" title={copy.unpair} onClick={onUnpair}>
              <Unlink size={14} />
            </IconButton>
          )}
        </>
      )}
      <ViewportToolbarSeparator />
      <ViewportLayerMenu
        title={copy.layers}
        options={[{ key: 'labels', icon: <Tag size={13} />, label: copy.layerLabels }]}
        visible={layers}
        onChange={onLayerChange}
      />
    </ViewportToolbar>
  );
}
