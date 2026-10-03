import type { TFunction } from 'i18next';
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

/** The bound calls a surface makes; `useSimulatorTools` supplies them. */
export interface SimulatorToolVerbs {
  selectTool: (id: SimulatorToolId) => void;
  clearPins: () => void;
  setOption: (id: SimulatorToolOptionId, value: boolean) => void;
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
   * pins, under Orbit. Without it pins would be invisible from the rail.
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
  /** Which window: the Pin tool's, or the pins' while another tool is active. */
  kind: 'pin' | 'pins';
  title: string;
  meta: string;
  instructions: readonly string[];
  toggles: readonly SimulatorToolToggle[];
  /** Clear, while there are pins. The count is the header's `meta`. */
  pins: { clearLabel: string; clear: () => void } | null;
  notices: readonly string[];
}

export function simulatorToolLabel(t: TFunction, id: SimulatorToolId): string {
  switch (id) {
    case 'orbit':
      return t('panels:simulator.tools.orbit.label', 'Orbit');
    case 'pin':
      return t('panels:simulator.tools.pin.label', 'Pin');
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
  }
}

export function simulatorToolButtons(
  t: TFunction,
  view: SimulatorToolsView,
  verbs: SimulatorToolVerbs
): SimulatorToolButton[] {
  return SIMULATOR_TOOLS.map((tool) => ({
    id: tool.id,
    icon: tool.icon,
    label: simulatorToolLabel(t, tool.id),
    description: simulatorToolDescription(t, tool.id),
    shortcut: tool.shortcut,
    active: view.activeToolId === tool.id,
    badge: tool.id === 'pin' && view.activeToolId !== 'pin' && view.pinnedCount > 0,
    select: () => verbs.selectTool(tool.id),
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
  const count = view.pinnedCount;
  return {
    kind: sections.kind,
    title:
      sections.kind === 'pin'
        ? simulatorToolLabel(t, 'pin')
        : t('panels:simulator.tools.pins.title', 'Pins'),
    meta:
      count > 0
        ? pinCountLabel(t, count)
        : t('panels:simulator.tools.instructions', 'Instructions'),
    instructions: sections.instructions ? pinInstructions(t, host) : [],
    toggles: sections.options.map((id) => ({
      id,
      label: optionLabel(t, id),
      checked: view.options[id],
      set: (value: boolean) => verbs.setOption(id, value),
    })),
    pins: sections.pins
      ? {
          clearLabel: t('panels:simulator.tools.pins.clear', 'Clear pins'),
          clear: verbs.clearPins,
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
  return view.pinnedCount > 0 ? ['simulator.pins.clear'] : [];
}
