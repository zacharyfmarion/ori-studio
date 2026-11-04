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
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import {
  SHOW_AS_ACTION,
  type DiagramLinkedPoseAction,
  type DiagramLinkedPoseActionId,
} from '../../diagram/actions/diagramLinkedPoseActions';
import type { DiagramStepLayerOrderEntry } from '../../diagram/actions/diagramStepLayerOrderActions';
import { DIAGRAM_SHOW_AS, type DiagramShowAs } from '../../diagram/document/diagramDocument';
import { Button } from '../ui/Button';
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

/** The verbs Edit order… comes before: the spread's and the reset, which end the bar. */
const AFTER_LAYER_ORDER: ReadonlySet<DiagramLinkedPoseActionId> = new Set(['spread-layers', 'reset']);

/**
 * A linked step's Pose verbs, for the step detail's toolbar: how the step
 * shows its pattern — Crease pattern, Folded or Simulated — then what can be
 * done to that, with `children` (the simulator's transport) between the two.
 * `keep` runs a verb and keeps focus in the toolbar, as the upload's pose
 * buttons do. A verb that cannot act — waiting for a capture, or at the end of
 * the layer orders — refuses rather than disables, so the one pressed keeps
 * the focus through the capture it started and whatever it leaves.
 *
 * A flat fold's ‹ › step through its layer orders with no readout, which the
 * Step pane keeps (Round 4's Pose toolbar, H8); `layerOrder`, Edit order…,
 * follows them as a word, as no icon says "layer order", ghost like the
 * bar's other verbs. On a 3D fold it stands where the pager would end, held
 * with its reason.
 *
 * Enlarged is not here: Annotate's Step pane turns it on (Zach's review of
 * #436, 2026-10-08).
 */
export function DiagramLinkedPoseControls({
  actions,
  layerOrder = null,
  keep,
  children,
}: {
  actions: readonly DiagramLinkedPoseAction[];
  /** The way into the Layer order dialog (`buildDiagramPoseLayerOrderEntry`); null for none. */
  layerOrder?: DiagramStepLayerOrderEntry | null;
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
  // Before the spread and the reset, or last when the bar has neither.
  const editAt = layerOrder ? verbs.findIndex((action) => AFTER_LAYER_ORDER.has(action.id)) : -1;
  const edit = layerOrder && <LayerOrderEdit key="layer-order" entry={layerOrder} />;
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
        return index === editAt ? [edit, button] : button;
      })}
      {editAt === -1 && edit}
    </>
  );
}

/**
 * Edit order…: refused rather than disabled, so it keeps the focus a press
 * gave it — which the dialog hands back to it as it closes — and says why on
 * hover; the Step pane's Edit… under the toolbar's word. Its name is the word
 * it shows (WCAG 2.5.3, label in name); its tooltip names it in full.
 */
function LayerOrderEdit({ entry }: { entry: DiagramStepLayerOrderEntry }) {
  const held = entry.disabled || entry.waiting;
  return (
    <Button
      size="sm"
      variant="ghost"
      title={held && entry.hint ? entry.hint : entry.name}
      aria-disabled={held || undefined}
      onClick={entry.run}
    >
      {entry.label}
    </Button>
  );
}
