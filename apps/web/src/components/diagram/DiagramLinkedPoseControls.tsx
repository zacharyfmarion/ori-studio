import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownToDot,
  Box,
  Eye,
  Layers,
  RotateCcw,
  RotateCw,
  RotateCcwSquare,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import {
  SHOW_AS_ACTION,
  type DiagramLinkedPoseAction,
  type DiagramLinkedPoseActionId,
} from '../../diagram/actions/diagramLinkedPoseActions';
import { DIAGRAM_SHOW_AS, type DiagramShowAs } from '../../diagram/document/diagramDocument';
import { IconButton } from '../ui/IconButton';
import { SegmentedControl } from '../ui/SegmentedControl';


/** A linked pose verb's icon. */
const LINKED_POSE_ICONS: Partial<Record<DiagramLinkedPoseActionId, LucideIcon>> = {
  'rotate-left': RotateCcw,
  'rotate-right': RotateCw,
  // As Edit's folded figures flip (`foldedFigureActionIcons`): the paper turned over, not mirrored.
  'turn-over': RotateCcwSquare,
  'next-solution': Layers,
  'view-top': ArrowDownToDot,
  'view-front': Eye,
  'view-iso': Box,
  reset: Undo2,
};

/**
 * A linked step's Pose verbs, for the step detail's toolbar: how the step
 * shows its pattern — Crease pattern, Folded or Simulated — then what can be
 * done to that, with `children` (the simulator's transport) between the two.
 * `keep` runs a verb and keeps focus in the toolbar, as the upload's pose
 * buttons do; while a capture runs the verbs wait rather than disable, so the
 * one pressed keeps the focus through it.
 */
export function DiagramLinkedPoseControls({
  actions,
  keep,
  children,
}: {
  actions: readonly DiagramLinkedPoseAction[];
  keep: (run: () => void) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const modes = DIAGRAM_SHOW_AS.map((mode) => ({
    mode,
    action: actions.find((action) => action.id === SHOW_AS_ACTION[mode]),
  })).filter(
    (entry): entry is { mode: DiagramShowAs; action: DiagramLinkedPoseAction } => entry.action !== undefined
  );
  const verbs = actions.filter((action) => LINKED_POSE_ICONS[action.id]);
  return (
    <>
      {modes.length > 0 && (
        <SegmentedControl<DiagramShowAs>
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
      {children}
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
