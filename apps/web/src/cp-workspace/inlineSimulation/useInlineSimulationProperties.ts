import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PropertySheet } from '../../lib/propertyDescriptors';
import { simulatorStyleDefaults } from '../../simulator/simulatorPalette';
import { useThemeStore } from '../../store/themeStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import {
  buildInlineSimulationProperties,
  type InlineSimulationPropertyDeps,
} from './inlineSimulationProperties';

/**
 * The inline simulation window's sheet, bound to the app-wide simulator
 * settings — the same store fields `SimulatorViewControlsPanel` edits, which
 * is the point: one value, two places to reach it, never two values.
 */
export function useInlineSimulationProperties(
  target: TargetOf<'inline-simulation'>
): PropertySheet {
  const { t } = useTranslation();
  const settings = useWorkspaceStore((state) => state.simulatorSettings);
  const setSetting = useWorkspaceStore((state) => state.setSimulatorSetting);
  // What an unset colour resolves to, keyed on the theme because that is what
  // moves it — the Simulate pane reads it the same way.
  const theme = useThemeStore((state) => state.currentTheme);
  const styleDefaults = useMemo(
    () =>
      simulatorStyleDefaults(
        typeof document === 'undefined' ? null : getComputedStyle(document.documentElement)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme]
  );
  const deps = useMemo<InlineSimulationPropertyDeps>(
    () => ({ t, settings, styleDefaults, setSetting }),
    [t, settings, styleDefaults, setSetting]
  );
  return useMemo(() => buildInlineSimulationProperties(target, deps), [target, deps]);
}
