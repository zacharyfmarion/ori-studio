import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownToDot,
  ArrowUpToLine,
  Axis3d,
  ChevronLeft,
  ChevronRight,
  Layers,
  RotateCcw,
  RotateCw,
  RotateCcwSquare,
  ScanSearch,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import {
  SHOW_AS_ACTION,
  type DiagramLinkedPoseAction,
  type DiagramLinkedPoseActionId,
} from '../../diagram/actions/diagramLinkedPoseActions';
import { DIAGRAM_SHOW_AS, type DiagramShowAs } from '../../diagram/document/diagramDocument';
import type { ZoomAction } from '../../diagram/zoom/zoomActions';
import { IconButton } from '../ui/IconButton';
import { SegmentedControl } from '../ui/SegmentedControl';
import styles from './DiagramLinkedPoseControls.module.css';

/** A linked pose verb's icon. */
const LINKED_POSE_ICONS: Partial<Record<DiagramLinkedPoseActionId, LucideIcon>> = {
  'rotate-left': RotateCcw,
  'rotate-right': RotateCw,
  // Stood on its mirror axis: the axis up to the top.
  upright: ArrowUpToLine,
  // As Edit's folded figures flip (`foldedFigureActionIcons`): the paper turned over, not mirrored.
  'turn-over': RotateCcwSquare,
  'previous-solution': ChevronLeft,
  'next-solution': ChevronRight,
  'view-top': ArrowDownToDot,
  // As Edit's 3D window and Simulate set it (`foldedFigureActionIcons`).
  'set-upright': Axis3d,
  'spread-layers': Layers,
  reset: Undo2,
};

/**
 * A linked step's Pose verbs, for the step detail's toolbar: how the step
 * shows its pattern — Crease pattern, Folded or Simulated — then what can be
 * done to that, with `children` (the simulator's transport) between the two.
 * `keep` runs a verb and keeps focus in the toolbar, as the upload's pose
 * buttons do. A verb that cannot act — waiting for a capture, or at the end of
 * the layer orders — refuses rather than disables, so the one pressed keeps
 * the focus through the capture it started and whatever it leaves.
 *
 * `enlarged`, Pose's Enlarged (Revision 2), is a toggle as Spread Layers is,
 * before Reset Pose; on a step that is not linked it is the only verb here,
 * after the upload's own.
 */
export function DiagramLinkedPoseControls({
  actions,
  layerOrder = null,
  enlarged = null,
  keep,
  children,
}: {
  actions: readonly DiagramLinkedPoseAction[];
  /** A flat fold's place among its layer orders, shown between ‹ and › (`layerOrderLabel`). */
  layerOrder?: string | null;
  /** Pose's Enlarged toggle (`zoomActions.ts`); null where it is not offered. */
  enlarged?: ZoomAction | null;
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
  const enlargedButton = enlarged && (
    <IconButton
      key="enlarged"
      size="sm"
      title={`${enlarged.label} - ${enlarged.hint}`}
      aria-label={enlarged.label}
      aria-disabled={enlarged.disabled || enlarged.waiting || undefined}
      aria-pressed={enlarged.pressed}
      className={styles.toggle}
      data-zoom-action={enlarged.id}
      onClick={() => keep(enlarged.run)}
    >
      <ScanSearch size={15} />
    </IconButton>
  );
  const resetAt = verbs.findIndex((action) => action.id === 'reset');
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
      {verbs.map((action, index) => {
        const Icon = LINKED_POSE_ICONS[action.id]!;
        const button = (
          <IconButton
            key={action.id}
            size="sm"
            title={(action.disabled || action.waiting) && action.hint ? action.hint : action.label}
            aria-label={action.label}
            // Refused, but still holding the focus: its run does nothing now.
            aria-disabled={action.disabled || action.waiting || undefined}
            // A toggle (Spread Layers) shows and says whether it is on.
            aria-pressed={action.pressed}
            className={action.pressed === undefined ? undefined : styles.toggle}
            onClick={() => keep(action.run)}
          >
            <Icon size={15} />
          </IconButton>
        );
        // Enlarged, before Reset Pose.
        if (index === resetAt && enlargedButton) return [enlargedButton, button];
        // The layer order pager: ‹ where it stands ›.
        if (action.id !== 'previous-solution' || !layerOrder) return button;
        return [
          button,
          <span key="layer-order" className={styles.layerOrder} aria-live="polite">
            {layerOrder}
          </span>,
        ];
      })}
      {resetAt < 0 && enlargedButton}
    </>
  );
}
