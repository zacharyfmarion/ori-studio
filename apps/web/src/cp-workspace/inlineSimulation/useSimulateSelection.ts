import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { resolveSelectedSegment } from '../../lib/creasePatternSelectionSegment';
import {
  ensureCpSegmentationArtifacts,
  peekCpSegmentationArtifacts,
} from '../cpSegmentationArtifacts';
import { MAX_CONCURRENT_SIMULATIONS } from '../../simulator/simulatorLimits';

/**
 * Open a simulation window for whatever the crease-pattern selection names, and
 * say why when that is not possible.
 *
 * Shared by the selection toolbar and the keyboard, rather than each resolving
 * the selection its own way. The toolbar only offers the action when a region
 * already matched, so for it the failure paths are unreachable; the shortcut can
 * be pressed at any time, which is exactly why it needs them.
 */
export function useSimulateSelection(): () => Promise<void> {
  const { t } = useTranslation();
  const addInlineSimulation = useWorkspaceStore(
    (state) => state.addOristudioCpInlineSimulation
  );

  return useCallback(async () => {
    const state = useWorkspaceStore.getState();
    const document = state.oristudioCpDocument?.document ?? null;
    if (!document) {
      toast.error(
        t('toasts:creasePattern.simulateNoRegion', 'Select a closed region to simulate.')
      );
      return;
    }

    // Segmenting a large pattern takes about a second, so the toolbar keeps a
    // cache and only ever peeks. From the keyboard there may be nothing cached
    // yet — the toolbar is not necessarily mounted — so wait for it rather than
    // reporting "no region" for work that has not happened.
    const artifacts =
      peekCpSegmentationArtifacts(document) ?? (await ensureCpSegmentationArtifacts(document));
    const match = resolveSelectedSegment(document, state.oristudioCpSelection, artifacts);
    if (!match) {
      toast.error(
        t('toasts:creasePattern.simulateNoRegion', 'Select a closed region to simulate.')
      );
      return;
    }

    // The region itself, not its id: ids are positional per segmentation, and
    // the store segments separately. See `InlineSimulationRegion`.
    const result = await addInlineSimulation({
      segment: match.segment,
      cpLineIds: match.cpLineIds,
    });
    if (result === 'at-capacity') {
      // `max`, not `count`: i18next reads `count` as a plural selector and would
      // fan this out into every locale's plural categories, for a constant.
      toast.message(
        t('toasts:creasePattern.inlineSimulationCap', {
          defaultValue:
            'Up to {{max}} simulation windows at once. Close one to open another.',
          max: MAX_CONCURRENT_SIMULATIONS,
        })
      );
      return;
    }
    if (result === 'unavailable') {
      toast.error(
        t('toasts:creasePattern.simulateFailed', 'That region could not be simulated.')
      );
    }
  }, [addInlineSimulation, t]);
}
