import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsCoarsePointerSurface } from '../platform/pointerSurface';
import { isApplePlatform } from '../platform/runtime';
import type { SimulatorShortcutId } from '../keyboard/shortcuts';
import {
  simulatorToolButtons,
  simulatorToolMenuVerbs,
  simulatorToolWindow,
  type SimulatorToolButton,
  type SimulatorToolWindowModel,
} from './tools/actions';
import type { SimulatorTools } from './useSimulatorTools';

export interface SimulatorToolActions {
  rail: SimulatorToolButton[];
  /** The same tools for the phone's sheet, which reports its own source. */
  picker: SimulatorToolButton[];
  window: SimulatorToolWindowModel | null;
  /** The context menu's tool rows, as registry ids. */
  menu: SimulatorShortcutId[];
}

/**
 * The tools' descriptors for every surface that shows them, in this device's
 * terms — which modifier turns the model, and whether a finger is doing it.
 */
export function useSimulatorToolActions(tools: SimulatorTools): SimulatorToolActions {
  const { t } = useTranslation();
  const coarse = useIsCoarsePointerSurface();
  const { view, verbs } = tools;
  return useMemo(() => {
    const host = { apple: isApplePlatform(), coarse };
    return {
      rail: simulatorToolButtons(t, view, verbs, 'rail'),
      picker: simulatorToolButtons(t, view, verbs, 'picker'),
      window: simulatorToolWindow(t, view, verbs, host),
      menu: simulatorToolMenuVerbs(view),
    };
  }, [t, coarse, view, verbs]);
}
