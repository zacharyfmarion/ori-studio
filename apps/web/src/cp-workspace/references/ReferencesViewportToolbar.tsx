import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import {
  ViewportToolbar,
  type ViewportToolbarGroupSpec,
} from '../../components/panels/ViewportToolbar';
import {
  shortcutLabelForAction,
  type ReferencesShortcutId,
  type ShortcutResolutionInput,
} from '../../keyboard/shortcuts';
import type { ReferencesActionIcon, ReferencesCommand } from './referencesActions';

export interface ReferencesViewportToolbarProps {
  zoomPercent: number;
  /** The camera's own verb, for the readout's presets; not a shortcut. */
  setZoomPercent: (percent: number) => void;
  /** The action catalog, so a verb's label and gating are decided once. */
  commands: readonly ReferencesCommand[];
  /** The panel's executor, so a button and its key are one path. */
  run: (id: ReferencesShortcutId) => void;
  /** The user's chords, for the tooltip that names one. */
  shortcuts?: ShortcutResolutionInput;
}

/**
 * The floating pill of controls over the References canvas — the Edit
 * workspace's bar, declared for this surface.
 *
 * The shared half is the zoom cluster and Fit; what this surface adds is
 * Recompute, which is not a view verb but is the one verb the workspace has
 * that no gesture and no other visible control replaces once the header is
 * only a title. It sits where Fold sits on the Edit bar and for the same
 * reason. Pinned, so on touch the bar is the whole set and there is no `⋯` to
 * open for one row.
 *
 * Every press dispatches the verb's registry id through the panel's executor,
 * as the header buttons did before the bar: the chord, the context-menu row
 * and the button cannot disagree about what a verb does.
 */
export function ReferencesViewportToolbar({
  zoomPercent,
  setZoomPercent,
  commands,
  run,
  shortcuts,
}: ReferencesViewportToolbarProps) {
  const { t } = useTranslation();
  const command = (id: ReferencesActionIcon) => commands.find((entry) => entry.id === id);
  const dispatch = (id: ReferencesActionIcon) => () => {
    const entry = command(id);
    if (entry) run(entry.shortcutId);
  };

  const recompute = command('recompute');
  const recomputeChord = shortcutLabelForAction('references.recompute', shortcuts);
  const groups: ViewportToolbarGroupSpec[] = recompute
    ? [
        {
          id: 'recompute',
          items: [
            {
              kind: 'action',
              id: 'recompute',
              label: recompute.label,
              title: recomputeChord ? `${recompute.label} (${recomputeChord})` : recompute.label,
              icon: <RefreshCw size={14} />,
              disabled: recompute.disabled,
              pinned: true,
              onSelect: dispatch('recompute'),
            },
          ],
        },
      ]
    : [];

  return (
    <ViewportToolbar
      ariaLabel={t('panels:references.viewportControls', 'References viewport controls')}
      zoomPercent={zoomPercent}
      zoomIn={dispatch('zoom-in')}
      zoomOut={dispatch('zoom-out')}
      fitToView={dispatch('reset-view')}
      // The preset list passes a scale; the camera takes a percent.
      setZoomLevel={(scale) => setZoomPercent(scale * 100)}
      groups={groups}
    />
  );
}
