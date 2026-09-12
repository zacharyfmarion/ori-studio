import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import {
  ViewportToolbar,
  type ViewportToolbarGroupSpec,
} from '../../components/panels/ViewportToolbar';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
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
 * On the phone the bar also ends with Previous and Next step. The filmstrip
 * carries them everywhere else, but on a 375px strip two touch-sized buttons
 * either side of the cards left room for barely one card, so there the strip
 * is the cards alone and the stepping lives here, at the right-hand end where
 * a thumb is anyway.
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
  const phone = useIsPhoneLayout();
  const command = (id: ReferencesActionIcon) => commands.find((entry) => entry.id === id);
  const dispatch = (id: ReferencesActionIcon) => () => {
    const entry = command(id);
    if (entry) run(entry.shortcutId);
  };

  const step = (id: 'previous-step' | 'next-step', icon: ReactNode) => {
    const entry = command(id);
    if (!entry) return null;
    const chord = shortcutLabelForAction(entry.shortcutId, shortcuts);
    return {
      kind: 'action' as const,
      id,
      label: entry.label,
      title: chord ? `${entry.label} (${chord})` : entry.label,
      icon,
      disabled: entry.disabled,
      pinned: true,
      onSelect: dispatch(id),
    };
  };
  const steps: ViewportToolbarGroupSpec[] = phone
    ? [
        {
          id: 'steps',
          items: [
            step('previous-step', <ChevronLeft size={14} />),
            step('next-step', <ChevronRight size={14} />),
          ],
        },
      ]
    : [];

  const recompute = command('recompute');
  const recomputeChord = shortcutLabelForAction('references.recompute', shortcuts);
  const groups: ViewportToolbarGroupSpec[] = [
    ...(recompute
      ? [
          {
            id: 'recompute',
            items: [
              {
                kind: 'action' as const,
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
      : []),
    ...steps,
  ];

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
