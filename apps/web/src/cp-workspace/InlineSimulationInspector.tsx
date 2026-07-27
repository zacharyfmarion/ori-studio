import { useTranslation } from 'react-i18next';
import { Pause, Play, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { FloatingToolbar } from '../components/ui/FloatingToolbar';
import { IconButton } from '../components/ui/IconButton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/Select';
import { useCanvasObjectAnchor } from './canvasObjects/useCanvasObjectAnchor';
import type { InlineSimulation } from './inlineSimulation/inlineSimulation';
import type { SimulatorSettings } from '../lib/simulatorSettings';

/**
 * Floating controls for the focused inline simulation: play/pause, scrub, reset
 * view, refresh when out of date, and delete.
 *
 * Hovers above the window via {@link FloatingToolbar}, sharing the pattern with
 * {@link CpImageInspector} — including subscribing to the camera here rather
 * than in the panel, so the toolbar tracks the window per frame while the panel
 * does not re-render.
 */
export function InlineSimulationInspector({
  simulation,
  container,
  playing,
  stale,
  colorMode,
  onTogglePlay,
  onScrub,
  onColorMode,
  onResetView,
  onRefresh,
  onDelete,
}: {
  simulation: InlineSimulation;
  /** Element the canvas is positioned against — see {@link useCanvasObjectAnchor}. */
  container: HTMLElement | null;
  playing: boolean;
  stale: boolean;
  /**
   * How the paper is coloured. Shared with the Simulate workspace rather than
   * per-window: it is a way of looking at the same paper, and two places to set
   * it that disagree would be worse than one that follows you.
   */
  colorMode: SimulatorSettings['colorMode'];
  onTogglePlay: () => void;
  onScrub: (percent: number) => void;
  onColorMode: (mode: SimulatorSettings['colorMode']) => void;
  onResetView: () => void;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const anchorRect = useCanvasObjectAnchor(simulation.box, 'model', container);

  return (
    <FloatingToolbar
      anchorRect={anchorRect}
      className="cp-inline-simulation-inspector"
      ariaLabel={t(
        'panels:creasePattern.inlineSimulation.controls',
        'Inline simulation controls'
      )}
    >
      <IconButton
        size="sm"
        variant="toolbar"
        title={
          playing
            ? t('panels:creasePattern.inlineSimulation.pause', 'Pause')
            : t('panels:creasePattern.inlineSimulation.play', 'Play')
        }
        onClick={onTogglePlay}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </IconButton>
      <input
        className="cp-inline-simulation-inspector__scrub"
        type="range"
        min={0}
        max={100}
        step={1}
        value={simulation.foldPercent}
        aria-label={t('panels:creasePattern.inlineSimulation.fold', 'Fold')}
        onChange={(event) => onScrub(Number(event.target.value))}
      />
      <span className="cp-inline-simulation-inspector__readout">
        {Math.round(simulation.foldPercent)}%
      </span>
      <Select value={colorMode} onValueChange={(value) => onColorMode(value as SimulatorSettings['colorMode'])}>
        <SelectTrigger
          aria-label={t('panels:simulatorViewControls.colorMode', 'Colour')}
          className="cp-inline-simulation-inspector__select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="paper">
            {t('panels:simulatorViewControls.colorPaper', 'Paper')}
          </SelectItem>
          <SelectItem value="strain">
            {t('panels:simulatorViewControls.colorStrain', 'Strain')}
          </SelectItem>
        </SelectContent>
      </Select>
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:creasePattern.inlineSimulation.resetView', 'Reset view')}
        onClick={onResetView}
      >
        <RotateCcw size={14} />
      </IconButton>
      {stale && (
        <IconButton
          size="sm"
          variant="toolbar"
          title={t(
            'panels:creasePattern.inlineSimulation.refresh',
            'Rebuild from the current creases'
          )}
          onClick={onRefresh}
        >
          <RefreshCw size={14} />
        </IconButton>
      )}
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:creasePattern.inlineSimulation.delete', 'Delete')}
        onClick={onDelete}
      >
        <Trash2 size={14} />
      </IconButton>
    </FloatingToolbar>
  );
}
