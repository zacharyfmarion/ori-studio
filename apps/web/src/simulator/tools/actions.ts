import type { TFunction } from 'i18next';
import type {
  SimulatorPinsClearSource,
  SimulatorPoseReleaseSource,
  SimulatorToolOptionSource,
  SimulatorToolSelectSource,
} from '../../analytics/events';
import type { SimulatorShortcutId } from '../../keyboard/shortcuts';
import { SIMULATOR_TOOLS, simulatorTool } from './catalog';
import type {
  SimulatorToolIcon,
  SimulatorToolId,
  SimulatorToolNotice,
  SimulatorToolOptionId,
  SimulatorToolsView,
} from './types';

/**
 * The verbs the tools offer, as plain descriptors for every surface that shows
 * them: the rail, the phone's tool sheet, the tool window and the context menu.
 *
 * Gating, labels, ordering and the calls live here so those surfaces cannot
 * drift; each only renders. `cp-workspace/folded/foldedFigureActions.ts` is the
 * shape this copies. Free of React and of the store: it takes a view and bound
 * verbs and returns data.
 */

/**
 * The bound calls a surface makes; `useSimulatorTools` supplies them. Each says
 * where it was asked from, which is what its analytics event reports.
 */
export interface SimulatorToolVerbs {
  selectTool: (id: SimulatorToolId, source: SimulatorToolSelectSource) => void;
  clearPins: (source: SimulatorPinsClearSource) => void;
  setOption: (id: SimulatorToolOptionId, value: boolean, source: SimulatorToolOptionSource) => void;
  /** Let the pose a pull left go: the paper springs back to the fold. */
  springBack: (source: Exclude<SimulatorPoseReleaseSource, 'fold-control' | 'restart'>) => void;
}

/** What the instructions can promise on this device. */
export interface SimulatorToolHost {
  /** Cmd is the navigate modifier, and has a name worth printing. */
  apple: boolean;
  /** A finger: no Shift, no hover, and a tap toggles. */
  coarse: boolean;
}

export interface SimulatorToolButton {
  id: SimulatorToolId;
  icon: SimulatorToolIcon;
  label: string;
  /** One line on what it does, for the phone's tool sheet. */
  description: string;
  /** The verb that selects it, for the tooltip's key. */
  shortcut: SimulatorShortcutId;
  active: boolean;
  /**
   * Something this tool made is still in effect while another tool is in hand:
   * pins, or a pose. Without it they would be invisible from the rail.
   */
  badge: boolean;
  select: () => void;
}

export interface SimulatorToolToggle {
  id: SimulatorToolOptionId;
  label: string;
  checked: boolean;
  set: (value: boolean) => void;
}

export interface SimulatorToolWindowModel {
  /** Which window: the Pin or Pull tool's, or the pins' and pose's under another tool. */
  kind: 'pin' | 'pull' | 'pins';
  title: string;
  meta: string;
  instructions: readonly string[];
  toggles: readonly SimulatorToolToggle[];
  /** Clear, while there are pins. The count is the header's `meta`. */
  pins: { clearLabel: string; clear: () => void } | null;
  /** Spring back, while the paper holds a pose. */
  pose: { springBackLabel: string; springBack: () => void } | null;
  /** Pull with nothing pinned: pins come first, and the way to make some. */
  needsPins: { text: string; pinLabel: string; pin: () => void } | null;
  notices: readonly string[];
}

export function simulatorToolLabel(t: TFunction, id: SimulatorToolId): string {
  switch (id) {
    case 'orbit':
      return t('panels:simulator.tools.orbit.label', 'Orbit');
    case 'pin':
      return t('panels:simulator.tools.pin.label', 'Pin');
    case 'pull':
      return t('panels:simulator.tools.pull.label', 'Pull');
  }
}

export function simulatorToolDescription(t: TFunction, id: SimulatorToolId): string {
  switch (id) {
    case 'orbit':
      return t('panels:simulator.tools.orbit.description', 'Drag to turn the model.');
    case 'pin':
      return t(
        'panels:simulator.tools.pin.description',
        'Hold faces in place while the rest of the paper folds.'
      );
    case 'pull':
      return t(
        'panels:simulator.tools.pull.description',
        'Drag the paper open around its pins. It stays where you leave it.'
      );
  }
}

/** What the canvas says it does under each tool: its accessible name, and its hover title. */
export function simulatorCanvasLabels(t: TFunction, id: SimulatorToolId): { ariaLabel: string; title: string } {
  switch (id) {
    case 'pin':
      return {
        ariaLabel: t(
          'panels:simulator.canvasAriaLabelPin',
          'Origami folded-base simulator. Drag a box or click a face to pin it, scroll to zoom.'
        ),
        title: t('panels:simulator.canvasTitlePin', 'Drag a box or click a face to pin it, scroll to zoom'),
      };
    case 'pull':
      return {
        ariaLabel: t(
          'panels:simulator.canvasAriaLabelPull',
          'Origami folded-base simulator. Drag the paper to pull it around its pins, scroll to zoom.'
        ),
        title: t('panels:simulator.canvasTitlePull', 'Drag the paper to pull it, scroll to zoom'),
      };
    case 'orbit':
      return {
        ariaLabel: t(
          'panels:simulator.canvasAriaLabel',
          'Origami folded-base simulator. Drag to rotate, scroll to zoom, double-click to reset view.'
        ),
        title: t('panels:simulator.canvasTitle', 'Drag to rotate, scroll to zoom, double-click to reset view'),
      };
  }
}

/** The tools as buttons, for the rail or the phone's tool sheet. */
export function simulatorToolButtons(
  t: TFunction,
  view: SimulatorToolsView,
  verbs: SimulatorToolVerbs,
  surface: Extract<SimulatorToolSelectSource, 'rail' | 'picker'>
): SimulatorToolButton[] {
  return SIMULATOR_TOOLS.map((tool) => ({
    id: tool.id,
    icon: tool.icon,
    label: simulatorToolLabel(t, tool.id),
    description: simulatorToolDescription(t, tool.id),
    shortcut: tool.shortcut,
    active: view.activeToolId === tool.id,
    badge:
      view.activeToolId !== tool.id &&
      ((tool.id === 'pin' && view.pinnedCount > 0) || (tool.id === 'pull' && view.posed)),
    select: () => verbs.selectTool(tool.id, surface),
  }));
}

function pinCountLabel(t: TFunction, count: number): string {
  return t('panels:simulator.tools.pins.count', {
    count,
    defaultValue_one: '1 face pinned',
    defaultValue_other: '{{count}} faces pinned',
  });
}

function pinInstructions(t: TFunction, host: SimulatorToolHost): string[] {
  if (host.coarse) {
    return [
      t('panels:simulator.tools.pin.touchBox', 'Drag a box to pin the faces inside it.'),
      t('panels:simulator.tools.pin.touchTap', 'Tap a face to pin or unpin it.'),
      t('panels:simulator.tools.pin.touchOrbit', 'Switch to Orbit to turn the model.'),
    ];
  }
  return [
    t('panels:simulator.tools.pin.box', 'Drag a box to pin the faces inside it, or click one face.'),
    t(
      'panels:simulator.tools.pin.shift',
      'Shift-drag adds to the pins. Shift-click pins or unpins one face.'
    ),
    host.apple
      ? t('panels:simulator.tools.pin.orbitApple', 'Cmd-drag turns the model.')
      : t('panels:simulator.tools.pin.orbitMiddle', 'Drag with the middle button to turn the model.'),
  ];
}

function pullInstructions(t: TFunction, host: SimulatorToolHost): string[] {
  const lines = [
    t('panels:simulator.tools.pull.drag', 'Drag the paper to pull it. Pinned faces hold still.'),
    t(
      'panels:simulator.tools.pull.keep',
      'Let go and it stays. Play or scrub the fold to let it spring back.'
    ),
  ];
  if (host.coarse) {
    return [...lines, t('panels:simulator.tools.pin.touchOrbit', 'Switch to Orbit to turn the model.')];
  }
  return [
    ...lines,
    t('panels:simulator.tools.pull.cancel', 'Esc while dragging puts it back.'),
    host.apple
      ? t('panels:simulator.tools.pin.orbitApple', 'Cmd-drag turns the model.')
      : t('panels:simulator.tools.pin.orbitMiddle', 'Drag with the middle button to turn the model.'),
  ];
}

function windowTitle(t: TFunction, kind: SimulatorToolWindowModel['kind'], pinnedCount: number): string {
  switch (kind) {
    case 'pin':
      return simulatorToolLabel(t, 'pin');
    case 'pull':
      return simulatorToolLabel(t, 'pull');
    case 'pins':
      return pinnedCount > 0
        ? t('panels:simulator.tools.pins.title', 'Pins')
        : t('panels:simulator.tools.pose.title', 'Pose');
  }
}

function windowMeta(t: TFunction, view: SimulatorToolsView): string {
  if (view.pinnedCount > 0) return pinCountLabel(t, view.pinnedCount);
  if (view.posed) return t('panels:simulator.tools.pose.meta', 'Posed');
  return t('panels:simulator.tools.instructions', 'Instructions');
}

function optionLabel(t: TFunction, id: SimulatorToolOptionId): string {
  switch (id) {
    case 'pinThroughLayers':
      return t('panels:simulator.tools.pin.throughLayers', 'Select through all layers');
  }
}

function noticeText(t: TFunction, notice: SimulatorToolNotice): string {
  switch (notice) {
    case 'recovered':
      return t(
        'panels:simulator.tools.notice.recovered',
        'The simulation became unstable and restarted from flat. Pins now hold the flat sheet.'
      );
    case 'strained':
      return t(
        'panels:simulator.tools.notice.strained',
        'Pinned faces are pulling against each other.'
      );
  }
}

/** The tool window for the tool in hand, or null when it has nothing to show. */
export function simulatorToolWindow(
  t: TFunction,
  view: SimulatorToolsView,
  verbs: SimulatorToolVerbs,
  host: SimulatorToolHost
): SimulatorToolWindowModel | null {
  const sections = simulatorTool(view.activeToolId).window(view);
  if (!sections) return null;
  return {
    kind: sections.kind,
    title: windowTitle(t, sections.kind, view.pinnedCount),
    meta: windowMeta(t, view),
    instructions: !sections.instructions
      ? []
      : sections.kind === 'pull'
        ? pullInstructions(t, host)
        : pinInstructions(t, host),
    toggles: sections.options.map((id) => ({
      id,
      label: optionLabel(t, id),
      checked: view.options[id],
      set: (value: boolean) => verbs.setOption(id, value, 'tool-window'),
    })),
    pins: sections.pins
      ? {
          clearLabel: t('panels:simulator.tools.pins.clear', 'Clear pins'),
          clear: () => verbs.clearPins('tool-window'),
        }
      : null,
    pose: sections.pose
      ? {
          springBackLabel: t('panels:simulator.tools.pose.springBack', 'Spring back'),
          springBack: () => verbs.springBack('tool-window'),
        }
      : null,
    needsPins: sections.needsPins
      ? {
          text: t(
            'panels:simulator.tools.pull.needsPins',
            'Pin the faces that should hold still, then pull.'
          ),
          pinLabel: t('panels:simulator.tools.pull.pinFaces', 'Pin faces'),
          pin: () => verbs.selectTool('pin', 'tool-window'),
        }
      : null,
    notices: view.notices.map((notice) => noticeText(t, notice)),
  };
}

/**
 * The tool verbs the context menu offers, as registry ids so each row carries
 * its own label and key. Only while there is something to act on.
 */
export function simulatorToolMenuVerbs(view: SimulatorToolsView): SimulatorShortcutId[] {
  const verbs: SimulatorShortcutId[] = [];
  if (view.pinnedCount > 0) verbs.push('simulator.pins.clear');
  if (view.posed) verbs.push('simulator.pull.springBack');
  return verbs;
}
