import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronLeft, ChevronRight, Download, Pause, Play, RefreshCw, Rewind } from 'lucide-react';
import {
  ViewportToolbar,
  type ViewportToolbarGroupSpec,
} from '../../components/panels/ViewportToolbar';
import { MenuIconButton } from '../../components/ui/MenuIconButton';
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
 * Play comes before Recompute: it is the sequence's own verb, and the one a
 * reader presses most while reading. Its glyph follows the transport — Play
 * from flat, Pause while it moves, a rewind from folded — because the
 * catalog says so; the bar only draws the icon it is handed.
 *
 * On the phone the bar also ends with Previous and Next step. The filmstrip
 * carries them everywhere else, but on a 375px strip two touch-sized buttons
 * either side of the cards left room for barely one card, so there the strip
 * is the cards alone and the stepping lives here, at the right-hand end where
 * a thumb is anyway.
 *
 * Export is one button opening the two formats, as the simulator's is: two
 * inline buttons with the same glyph would say nothing about which is which,
 * and a menu row per format reads. A node rather than two actions, so it is
 * the same control on every pointer; the rows are the catalog's export
 * commands and dispatch like every other press here.
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

  const play = command('play-fold');
  const playChord = shortcutLabelForAction('references.playFold', shortcuts);
  const playIcon =
    play?.icon === 'pause-fold' ? (
      <Pause size={14} />
    ) : play?.icon === 'unfold' ? (
      <Rewind size={14} />
    ) : (
      <Play size={14} />
    );
  const recompute = command('recompute');
  const recomputeChord = shortcutLabelForAction('references.recompute', shortcuts);
  const exports = commands.filter(
    (entry) => entry.id === 'export-step-svg' || entry.id === 'export-step-png'
  );
  const groups: ViewportToolbarGroupSpec[] = [
    ...(play
      ? [
          {
            id: 'fold',
            items: [
              {
                kind: 'action' as const,
                id: 'play-fold',
                label: play.label,
                title: playChord ? `${play.label} (${playChord})` : play.label,
                icon: playIcon,
                disabled: play.disabled,
                pinned: true,
                onSelect: dispatch('play-fold'),
              },
            ],
          },
        ]
      : []),
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
    ...(exports.length > 0
      ? [
          {
            id: 'export',
            items: [
              {
                kind: 'node' as const,
                id: 'export-step',
                node: (
                  <ReferencesExportMenu
                    label={t('panels:references.exportStep', 'Export step')}
                    commands={exports}
                    run={run}
                    shortcuts={shortcuts}
                  />
                ),
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

/** The export button and its two rows, one per format. */
function ReferencesExportMenu({
  label,
  commands,
  run,
  shortcuts,
}: {
  label: string;
  commands: readonly ReferencesCommand[];
  run: (id: ReferencesShortcutId) => void;
  shortcuts?: ShortcutResolutionInput;
}) {
  return (
    <DropdownMenu.Root>
      <MenuIconButton
        label={label}
        icon={<Download size={14} />}
        disabled={commands.every((entry) => entry.disabled)}
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="context-menu"
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          loop
        >
          {commands.map((entry) => {
            const chord = shortcutLabelForAction(entry.shortcutId, shortcuts);
            return (
              <DropdownMenu.Item
                key={entry.id}
                className="context-menu__item"
                disabled={entry.disabled}
                title={entry.hint}
                onSelect={() => run(entry.shortcutId)}
              >
                <span className="context-menu__label">{entry.label}</span>
                {chord != null && <span className="context-menu__shortcut">{chord}</span>}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
