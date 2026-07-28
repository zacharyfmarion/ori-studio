import { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Palette, Pause, Play, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { FloatingToolbar } from '../components/ui/FloatingToolbar';
import { IconButton } from '../components/ui/IconButton';
import { Slider } from '../components/ui/Slider';
import { useCanvasObjectAnchor } from './canvasObjects/useCanvasObjectAnchor';
import {
  getInlineSimulationFoldPercent,
  subscribeInlineSimulationFold,
} from './inlineSimulation/inlineSimulationRuntime';
import type { InlineSimulation } from './inlineSimulation/inlineSimulation';
import type { SimulatorSettings } from '../lib/simulatorSettings';

type ColorMode = SimulatorSettings['colorMode'];

// Literal keys so the i18n extractor can see them (see apps/web/CLAUDE.md).
function colorModeLabel(mode: ColorMode, t: TFunction): string {
  return mode === 'strain'
    ? t('panels:simulatorViewControls.colorStrain', 'Strain')
    : t('panels:simulatorViewControls.colorPaper', 'Paper');
}

/**
 * Colour mode as an icon button that opens a menu, matching the export control
 * beside it rather than introducing a second kind of dropdown to a bar this
 * small.
 */
function ColorModeMenu({
  colorMode,
  onColorMode,
}: {
  colorMode: ColorMode;
  onColorMode: (mode: ColorMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {/* No `title`: an IconButton with one wraps itself in a Tooltip trigger,
            which cannot also be a Radix `asChild` trigger. */}
        <IconButton
          size="sm"
          variant="toolbar"
          aria-label={t('panels:simulatorViewControls.colorMode', 'Colour')}
        >
          <Palette size={14} />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="context-menu"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          loop
        >
          {(['paper', 'strain'] as const).map((mode) => (
            <DropdownMenu.Item
              key={mode}
              className="context-menu__item"
              data-active={mode === colorMode || undefined}
              onSelect={() => onColorMode(mode)}
            >
              <span className="context-menu__label">{colorModeLabel(mode, t)}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Floating controls for the focused inline simulation: play/pause, scrub, colour
 * mode, reset to flat, refresh when out of date, and delete.
 *
 * `RotateCcw` means "back to flat" here because that is what it means in the
 * Simulate workspace's transport. The camera reset lives on the keyboard (0 or
 * Home) rather than taking a second slot in a bar this narrow.
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
  onReplay,
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
  colorMode: ColorMode;
  onTogglePlay: () => void;
  onScrub: (percent: number) => void;
  onColorMode: (mode: ColorMode) => void;
  /** Return the fold to flat, as the Simulate workspace's Reset does. */
  onReplay: () => void;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const anchorRect = useCanvasObjectAnchor(simulation.box, 'model', container);
  // The fold lives outside React state — it moves ~15 times a second, and the
  // descriptor it used to live on is what half the crease-pattern panel is keyed
  // on. Subscribing here means this bar is the only thing that re-renders for it.
  const foldPercent = useSyncExternalStore(
    subscribeInlineSimulationFold,
    useCallback(() => getInlineSimulationFoldPercent(simulation.id), [simulation.id])
  );

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
      <Slider
        className="cp-inline-simulation-inspector__scrub"
        min={0}
        max={100}
        step={1}
        value={foldPercent}
        aria-label={t('panels:creasePattern.inlineSimulation.fold', 'Fold')}
        onChange={onScrub}
      />
      <span className="cp-inline-simulation-inspector__readout">
        {Math.round(foldPercent)}%
      </span>
      <ColorModeMenu colorMode={colorMode} onColorMode={onColorMode} />
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:creasePattern.inlineSimulation.replay', 'Reset to flat')}
        onClick={onReplay}
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
