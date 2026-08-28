import type { TFunction } from 'i18next';
import type { ContextMenuItem } from '../components/ui/contextMenuTypes';
import { shortcutActionLabel } from '../i18n/shortcutLabels';
import {
  getShortcutDefinition,
  shortcutLabelForAction,
  type ShortcutResolutionInput,
  type SimulatorShortcutId,
} from '../keyboard/shortcuts';

/**
 * The simulator viewport's context menu, as content.
 *
 * Every row is an existing `SimulatorShortcutId`, and that is the whole reason
 * this menu earns its place: the simulator's verbs are *only* keys. Space folds,
 * R replays, F/C/H/L toggle the four render settings — and none of that is
 * written anywhere in the UI except the Settings shortcut list. A right-click
 * menu built from the same registry is the first surface that says out loud what
 * the viewport can do, with each row's own chord beside it.
 *
 * Because the rows are registry entries, they inherit the localized label
 * (`shortcutActionLabel`) and the *user's* binding rather than the default —
 * so a rebound key is shown rebound.
 *
 * **Pointer-only, deliberately.** The other four canvases answer the
 * `viewport.contextMenu` chord; this one does not, and adding it would mean a
 * second registry id (`simulator` scope is pushed ahead of `viewport` while a
 * simulation holds the keyboard, so the viewport one never arrives here). It is
 * not worth it: every row below already *is* a key binding, so a keyboard user
 * has the whole menu without opening it. The value here is the reverse
 * direction — telling a mouse user those keys exist.
 *
 * Free of React and of the store.
 */

export interface SimulatorContextMenuDeps {
  t: TFunction;
  shortcuts?: ShortcutResolutionInput;
  /** Run a verb. The panel's own executor, so the menu and the keys are one path. */
  run: (id: SimulatorShortcutId) => void;
  /** Whether the fold is currently animating, for the Play/Pause row's wording. */
  playing: boolean;
  /**
   * Current render settings, so the four toggles render checked. Absent for a
   * surface with no options pane — an inline simulation window — which drops
   * those rows rather than showing four toggles that report nothing.
   */
  settings: {
    showFaces: boolean;
    showEdges: boolean;
    showHiddenLines: boolean;
    lighting: boolean;
  } | null;
}

/** One registry entry as a row. */
function shortcutItem(
  id: SimulatorShortcutId,
  deps: SimulatorContextMenuDeps,
  overrides: Partial<Extract<ContextMenuItem, { kind: 'action' }>> = {}
): ContextMenuItem | null {
  const definition = getShortcutDefinition(id);
  if (!definition) return null;
  return {
    kind: 'action',
    id,
    label: shortcutActionLabel(deps.t, definition),
    shortcut: shortcutLabelForAction(id, deps.shortcuts),
    onSelect: () => deps.run(id),
    ...overrides,
  };
}

/** One render setting as a checked row. */
function settingItem(
  id: SimulatorShortcutId,
  checked: boolean,
  deps: SimulatorContextMenuDeps
): ContextMenuItem | null {
  const definition = getShortcutDefinition(id);
  if (!definition) return null;
  return {
    kind: 'radio',
    id,
    label: shortcutActionLabel(deps.t, definition),
    checked,
    onSelect: () => deps.run(id),
  };
}

export function simulatorMenuItems(deps: SimulatorContextMenuDeps): ContextMenuItem[] {
  const { t } = deps;
  const items: (ContextMenuItem | null)[] = [
    // The one row whose label is not the registry's: "Play / Pause Fold" is
    // right for a key list, which has to name both halves of a toggle, and
    // wrong for a menu, which knows which half this press will do.
    shortcutItem('simulator.playPause', deps, {
      label: deps.playing
        ? t('panels:simulator.contextMenu.pause', 'Pause')
        : t('panels:simulator.contextMenu.play', 'Play'),
    }),
    shortcutItem('simulator.foldBackward', deps),
    shortcutItem('simulator.foldForward', deps),
    shortcutItem('simulator.foldStart', deps),
    shortcutItem('simulator.foldEnd', deps),
    { kind: 'separator' },
    shortcutItem('simulator.replay', deps),
    { kind: 'separator' },
    shortcutItem('simulator.resetView', deps),
  ];

  if (deps.settings) {
    items.push(
      { kind: 'separator' },
      {
        kind: 'submenu',
        id: 'simulator-view',
        label: t('panels:simulator.contextMenu.view', 'View'),
        items: [
          settingItem('simulator.toggleFaces', deps.settings.showFaces, deps),
          settingItem('simulator.toggleCreases', deps.settings.showEdges, deps),
          settingItem('simulator.toggleHiddenLines', deps.settings.showHiddenLines, deps),
          settingItem('simulator.toggleLighting', deps.settings.lighting, deps),
        ].filter((item): item is ContextMenuItem => item !== null),
      }
    );
  }

  return items.filter((item): item is ContextMenuItem => item !== null);
}
