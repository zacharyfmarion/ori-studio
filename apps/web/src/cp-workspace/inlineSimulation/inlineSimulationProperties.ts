import type { TFunction } from 'i18next';
import { simulatorColorModeLabel, simulatorCreaseStyleLabel } from '../../i18n/enumLabels';
import type { PropertySheet } from '../../lib/propertyDescriptors';
import {
  SIMULATOR_CREASE_STYLES,
  type SimulatorColorMode,
  type SimulatorColorSettingKey,
  type SimulatorCreaseStyle,
  type SimulatorSettings,
} from '../../lib/simulatorSettings';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';

export interface InlineSimulationPropertyDeps {
  t: TFunction;
  settings: SimulatorSettings;
  /** What an unset paper colour resolves to under the current theme, so the swatch shows the paper on screen. */
  styleDefaults: Record<SimulatorColorSettingKey, string>;
  setSetting<K extends keyof SimulatorSettings>(key: K, value: SimulatorSettings[K]): void;
}

const COLOR_MODES: readonly SimulatorColorMode[] = ['paper', 'strain'];

/**
 * The properties an inline simulation window shows: the simulator's render
 * settings. A window has no per-object property of its own today — its
 * descriptor is a box, a z and a camera nobody reads back — so this sheet is
 * the shared settings, said to be shared in the section's description. That
 * is the condition `InlineSimulationInspector` put on any surface showing
 * them: two places to set a value that disagree would be worse than one that
 * follows you.
 *
 * Preferences, not document edits: no `undoLabel`, and the continuous fields
 * open no bracket. Only the keys `resolveRenderSettings` consumes appear.
 * Transport, refresh, export and delete stay on the floating inspector.
 */
export function buildInlineSimulationProperties(
  target: TargetOf<'inline-simulation'>,
  deps: InlineSimulationPropertyDeps
): PropertySheet {
  const { t, settings, styleDefaults, setSetting } = deps;
  const paper = (key: 'paperFront' | 'paperBack', id: string, label: string) => ({
    id,
    kind: 'color' as const,
    label,
    support: 'supported' as const,
    protocol: 'continuous' as const,
    value: settings[key] ?? styleDefaults[key],
    begin: () => true,
    update: (value: string) => setSetting(key, value),
    end: () => {},
    held: false,
    // Offered only while overridden, so its absence says the paper is still
    // following the theme.
    ...(settings[key] === null ? {} : { reset: () => setSetting(key, null) }),
  });
  return {
    kind: 'inline-simulation',
    targetId: target.id,
    title: t('panels:cpProperties.inlineSimulation.title', 'Simulation window'),
    icon: 'inline-simulation',
    sections: [
      {
        id: 'simulator',
        title: t('panels:cpProperties.inlineSimulation.settings', 'Simulator settings'),
        description: t(
          'panels:cpProperties.inlineSimulation.sharedNote',
          'Shared with the Simulate workspace and every window'
        ),
        fields: [
          {
            id: 'colorMode',
            kind: 'select',
            label: t('panels:simulatorViewControls.colorMode', 'Colour'),
            support: 'supported',
            options: COLOR_MODES.map((mode) => ({
              id: mode,
              label: simulatorColorModeLabel(t, mode),
            })),
            protocol: 'discrete',
            value: settings.colorMode,
            commit: (next) => {
              if (next !== null) setSetting('colorMode', next as SimulatorColorMode);
            },
          },
          paper('paperFront', 'frontColor', t('panels:simulatorViewControls.paperFront', 'Front')),
          paper('paperBack', 'backColor', t('panels:simulatorViewControls.paperBack', 'Back')),
          {
            id: 'showEdges',
            kind: 'toggle',
            label: t('panels:simulatorViewControls.creaseLines', 'Crease lines'),
            support: 'supported',
            protocol: 'discrete',
            value: settings.showEdges,
            commit: (next) => setSetting('showEdges', next),
          },
          {
            id: 'creaseStyle',
            kind: 'select',
            label: t('panels:simulatorViewControls.creaseStyle', 'Style'),
            support: 'supported',
            options: SIMULATOR_CREASE_STYLES.map((style) => ({
              id: style,
              label: simulatorCreaseStyleLabel(t, style),
            })),
            protocol: 'discrete',
            value: settings.creaseStyle,
            commit: (next) => {
              if (next !== null) setSetting('creaseStyle', next as SimulatorCreaseStyle);
            },
          },
        ],
      },
    ],
  };
}
