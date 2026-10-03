import { useTranslation } from 'react-i18next';
import {
  ArrowDownToDot,
  Box,
  Eye,
  FlipHorizontal2,
  Layers,
  RotateCcw,
  RotateCw,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import type {
  DiagramLinkedPoseAction,
  DiagramLinkedPoseActionId,
} from '../../diagram/actions/diagramLinkedPoseActions';
import { IconButton } from '../ui/IconButton';
import { SegmentedControl } from '../ui/SegmentedControl';

type ShowMode = 'crease-pattern' | 'folded' | 'simulated';

/** The ways to show the pattern, by the verb that shows it each way. */
const SHOW_MODES: readonly (readonly [ShowMode, DiagramLinkedPoseActionId])[] = [
  ['crease-pattern', 'show-crease-pattern'],
  ['folded', 'show-folded'],
  ['simulated', 'show-simulated'],
];

/** A linked pose verb's icon, wherever it is offered: here and in the Step pane. */
export const LINKED_POSE_ICONS: Partial<Record<DiagramLinkedPoseActionId, LucideIcon>> = {
  'rotate-left': RotateCcw,
  'rotate-right': RotateCw,
  'turn-over': FlipHorizontal2,
  'next-solution': Layers,
  'view-top': ArrowDownToDot,
  'view-front': Eye,
  'view-iso': Box,
  reset: Undo2,
};

/**
 * A linked step's Pose verbs, for the step detail's toolbar: how the step
 * shows its pattern — Crease pattern or Folded — then what can be done to
 * that. `keep` runs a verb and keeps focus in the toolbar, as the upload's
 * pose buttons do; while a capture runs the verbs wait rather than disable,
 * so the one pressed keeps the focus through it.
 */
export function DiagramLinkedPoseControls({
  actions,
  keep,
}: {
  actions: readonly DiagramLinkedPoseAction[];
  keep: (run: () => void) => void;
}) {
  const { t } = useTranslation();
  const modes = SHOW_MODES.map(([mode, id]) => ({ mode, action: actions.find((action) => action.id === id) })).filter(
    (entry): entry is { mode: ShowMode; action: DiagramLinkedPoseAction } => entry.action !== undefined
  );
  const verbs = actions.filter((action) => LINKED_POSE_ICONS[action.id]);
  return (
    <>
      {modes.length > 0 && (
        <SegmentedControl<ShowMode>
          size="sm"
          aria-label={t('panels:diagram.pose.show', 'Show')}
          value={modes.find(({ action }) => action.pressed)?.mode ?? null}
          disabled={modes[0]!.action.disabled}
          options={modes.map(({ mode, action }) => ({
            value: mode,
            label: action.label,
            title: action.hint,
            // Waiting, an option refuses but keeps the focus (`aria-disabled`).
            disabled: action.waiting,
          }))}
          onChange={(mode) => {
            const chosen = modes.find((entry) => entry.mode === mode);
            if (chosen) keep(chosen.action.run);
          }}
        />
      )}
      {verbs.map((action) => {
        const Icon = LINKED_POSE_ICONS[action.id]!;
        return (
          <IconButton
            key={action.id}
            size="sm"
            title={(action.disabled || action.waiting) && action.hint ? action.hint : action.label}
            aria-label={action.label}
            disabled={action.disabled}
            // Waiting for a capture: refused, but still holding the focus.
            aria-disabled={action.waiting || undefined}
            onClick={() => keep(action.run)}
          >
            <Icon size={15} />
          </IconButton>
        );
      })}
    </>
  );
}
