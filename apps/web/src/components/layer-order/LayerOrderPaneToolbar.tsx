import { Maximize2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { Toolbar, ToolbarGroup, ToolbarSeparator } from '../ui/Toolbar';
import styles from './LayerOrderPaneToolbar.module.css';

/** The folded pane's Rotate Left and Right: what they are called, and what a press does. */
export interface LayerOrderPaneRotate {
  readonly leftLabel: string;
  readonly rightLabel: string;
  /** 15° anticlockwise (`left`) or clockwise (`right`), as the pane shows the paper. */
  readonly onTurn: (direction: 'left' | 'right') => void;
}

/** What one pane's bar says and does: its own zoom, and Fit, which frames both panes. */
export interface LayerOrderPaneToolbarProps {
  /** The bar's name ("Crease pattern view"). */
  readonly label: string;
  readonly zoomOutLabel: string;
  readonly zoomInLabel: string;
  /** The percentage's name: what pressing it does ("Reset the crease pattern zoom"). */
  readonly resetLabel: string;
  readonly fitLabel: string;
  readonly zoomPercent: number;
  readonly onZoomOut: () => void;
  readonly onZoomIn: () => void;
  /** Back to actual size: 100%. */
  readonly onReset: () => void;
  /** Fit both panes. */
  readonly onFit: () => void;
  /** The folded pane's Rotate Left and Right, after Fit; left out on the crease pattern, which never turns. */
  readonly rotate?: LayerOrderPaneRotate;
}

/**
 * A Layer order pane's own zoom bar (A3, Round3:384-425): zoom out, the
 * percentage (pressing it is back to 100%), zoom in, and Fit, which frames
 * both panes; on the folded pane, Rotate Left and Right after it, which turn
 * the folded figure for the host to take with Apply. Each pane has one,
 * floating along its bottom edge, so each zooms on its own; a phone's panes
 * have none (D6), and are pinched and double-tapped instead.
 *
 * A `Toolbar` of the app's icon buttons, as the viewport bar is; not that bar
 * itself, which is the workspaces' (`components/panels/`), whose readout is a
 * preset menu where this one resets. Rotate's icons and words are the
 * Diagram's Pose controls' (`DiagramLinkedPoseControls`).
 */
export function LayerOrderPaneToolbar({
  label,
  zoomOutLabel,
  zoomInLabel,
  resetLabel,
  fitLabel,
  zoomPercent,
  onZoomOut,
  onZoomIn,
  onReset,
  onFit,
  rotate,
}: LayerOrderPaneToolbarProps) {
  return (
    <Toolbar aria-label={label} className={styles.placement}>
      <ToolbarGroup>
        <IconButton size="sm" variant="toolbar" aria-label={zoomOutLabel} onClick={onZoomOut}>
          <ZoomOut size={14} />
        </IconButton>
        <button type="button" className={styles.percent} aria-label={resetLabel} title={resetLabel} onClick={onReset}>
          {Math.round(zoomPercent)}%
        </button>
        <IconButton size="sm" variant="toolbar" aria-label={zoomInLabel} onClick={onZoomIn}>
          <ZoomIn size={14} />
        </IconButton>
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <IconButton size="sm" variant="toolbar" aria-label={fitLabel} onClick={onFit}>
          <Maximize2 size={14} />
        </IconButton>
      </ToolbarGroup>
      {rotate && (
        <>
          <ToolbarSeparator />
          <ToolbarGroup>
            <IconButton size="sm" variant="toolbar" aria-label={rotate.leftLabel} onClick={() => rotate.onTurn('left')}>
              <RotateCcw size={14} />
            </IconButton>
            <IconButton size="sm" variant="toolbar" aria-label={rotate.rightLabel} onClick={() => rotate.onTurn('right')}>
              <RotateCw size={14} />
            </IconButton>
          </ToolbarGroup>
        </>
      )}
    </Toolbar>
  );
}
