import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ANALYTICS_EVENTS, track } from '../../analytics';
import type { PaperStyleField, PaperStyleValue } from '../../lib/paper/paperStyle';
import type { PropertySheet } from '../../lib/propertyDescriptors';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import { usePaneGesture } from '../canvasObjects/usePaneGesture';
import {
  setInlineSimulationAppearances,
  useInheritedPaperStyle,
  useObjectPaperStyle,
  type PaperStyleOverrideEdit,
} from '../paper/objectPaperStyle';
import { inlineSimulationGesture } from './inlineSimulationGesture';
import {
  buildInlineSimulationProperties,
  type InlineSimulationPropertyDeps,
} from './inlineSimulationProperties';

/**
 * The inline simulation window's sheet, bound to the app-wide simulator
 * settings — the same store fields `SimulatorViewControlsPanel` edits — and to
 * the window's own pins on the paper style through the override verbs and the
 * layer's bracket. Continuous colour and weight edits open the bracket under
 * the pane's owner and write the raw store action per move; one entry per
 * gesture, exactly as the folded figure's sheet does.
 *
 * Every pin is counted (`paper style overridden`) once per field per
 * adjustment, never per pointer move: a continuous run counts a field on its
 * first write and stays quiet until the gesture ends.
 */
export function useInlineSimulationProperties(
  target: TargetOf<'inline-simulation'>
): PropertySheet {
  const { t } = useTranslation();
  const settings = useWorkspaceStore((state) => state.simulatorSettings);
  const setSetting = useWorkspaceStore((state) => state.setSimulatorSetting);
  const style = useObjectPaperStyle(target.simulation);
  const inherited = useInheritedPaperStyle();
  const overrides = target.simulation.appearance;
  const id = target.id;
  const gesture = usePaneGesture(inlineSimulationGesture);
  // The fields counted in the gesture under way. A set held for the hook's
  // lifetime, mutated per write, never read in render.
  const [counted] = useState(() => new Set<PaperStyleField>());

  const writeOverride = useCallback(
    <F extends PaperStyleField>(field: F, value: PaperStyleValue<F>) => {
      // Aborted underneath (an undo from the menu bar): a write now would land
      // a change no entry covers. The next move begins a fresh gesture.
      if (!gesture.isOpen()) return;
      if (!counted.has(field)) {
        counted.add(field);
        track(ANALYTICS_EVENTS.paperStyleOverridden, {
          surface: 'inline-simulation',
          field,
          reset: false,
        });
      }
      useWorkspaceStore.getState().setOristudioCpInlineSimulationAppearance(id, field, value);
    },
    [counted, gesture, id]
  );
  const end = useCallback(
    (label: string) => {
      counted.clear();
      gesture.end(label);
    },
    [counted, gesture]
  );
  const commitOverrides = useCallback(
    (edits: readonly PaperStyleOverrideEdit[]) => {
      for (const edit of edits) {
        track(ANALYTICS_EVENTS.paperStyleOverridden, {
          surface: 'inline-simulation',
          field: edit.field,
          reset: edit.value === undefined,
        });
      }
      void setInlineSimulationAppearances(id, edits);
    },
    [id]
  );

  const deps = useMemo<InlineSimulationPropertyDeps>(
    () => ({
      t,
      settings,
      setSetting,
      style,
      inherited,
      overrides,
      held: gesture.held,
      begin: gesture.begin,
      end,
      writeOverride,
      commitOverrides,
    }),
    [
      t,
      settings,
      setSetting,
      style,
      inherited,
      overrides,
      gesture.held,
      gesture.begin,
      end,
      writeOverride,
      commitOverrides,
    ]
  );
  return useMemo(() => buildInlineSimulationProperties(target, deps), [target, deps]);
}
