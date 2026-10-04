import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Layers,
  type LucideIcon,
} from 'lucide-react';
import type { SpreadDirection } from '../../cp-workspace/folded/foldedLayerSpread';
import type { DiagramLinkedPoseAction } from '../../diagram/actions/diagramLinkedPoseActions';
import type { DiagramLinkedSpread } from '../../diagram/capture/useDiagramLinkedPose';
import { SPREAD_AMOUNT_RANGE } from '../../diagram/document/diagramDocument';
import { IconButton } from '../ui/IconButton';
import { FieldRow, SliderRow, ToggleRow } from '../ui/fieldRows';
import styles from './DiagramSpreadRows.module.css';

const ARROWS: Record<SpreadDirection, LucideIcon> = {
  'up-left': ArrowUpLeft,
  up: ArrowUp,
  'up-right': ArrowUpRight,
  right: ArrowRight,
  'down-right': ArrowDownRight,
  down: ArrowDown,
  'down-left': ArrowDownLeft,
  left: ArrowLeft,
};

/** The slider moves in half percents, as the readout says them. */
const AMOUNT_STEP_PERCENT = 0.5;

/**
 * A flat fold's layers spread apart by depth (Phase 13), in the Step pane's
 * Pose section: Spread Layers on or off, and while on, how far the deepest
 * layer steps — a slider whose drag previews the picture and commits once —
 * and which way, eight buttons round a centre. The verbs are the open step's
 * pose controller's (`useDiagramLinkedPose`); this only lays them out.
 */
export function DiagramSpreadRows({
  toggle,
  spread,
}: {
  /** Spread Layers, the pose verb; absent where the picture has no layers to offer it for. */
  toggle: DiagramLinkedPoseAction | undefined;
  /** The spread while it is on; null while off. */
  spread: DiagramLinkedSpread | null;
}) {
  const { t, i18n } = useTranslation();
  if (!toggle) return null;
  const percent = (value: number) =>
    new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 1 }).format(value / 100);
  return (
    <>
      <ToggleRow
        label={t('panels:diagram.pose.spreadLayersRow', 'Spread layers')}
        checked={toggle.pressed ?? false}
        disabled={toggle.disabled}
        title={toggle.disabled ? toggle.hint : undefined}
        // Waiting for a capture, the switch refuses, as the verb does.
        onChange={() => toggle.run()}
      />
      {spread && (
        <>
          <SliderRow
            label={t('panels:diagram.pose.spreadAmount', 'Amount')}
            ariaLabel={t('panels:diagram.pose.spreadAmountName', 'Spread amount')}
            value={spread.spread.amount * 100}
            min={SPREAD_AMOUNT_RANGE.min * 100}
            max={SPREAD_AMOUNT_RANGE.max * 100}
            step={AMOUNT_STEP_PERCENT}
            format={percent}
            valueText={(value) =>
              t('panels:diagram.pose.spreadAmountValue', '{{percent}} of the model', { percent: percent(value) })
            }
            disabled={spread.disabled}
            title={spread.hint}
            onChange={(value) => spread.previewAmount(value / 100)}
            onGestureStart={spread.startAmount}
            onGestureCommit={spread.commitAmount}
          />
          <FieldRow label={t('panels:diagram.pose.spreadDirection', 'Direction')} kind="segmented" title={spread.hint}>
            <div
              className={styles.compass}
              role="group"
              aria-label={t('panels:diagram.pose.spreadDirectionName', 'Spread direction')}
            >
              {spread.directions.map((direction) => {
                const Icon = ARROWS[direction.toward];
                const held = direction.disabled || direction.waiting;
                return (
                  <IconButton
                    key={direction.toward}
                    size="sm"
                    className={styles.direction}
                    data-toward={direction.toward}
                    aria-label={direction.label}
                    title={held && direction.hint ? direction.hint : direction.label}
                    aria-pressed={direction.pressed}
                    // Refused, but still holding the focus, as Pose's verbs are.
                    aria-disabled={held || undefined}
                    onClick={direction.run}
                  >
                    <Icon size={14} />
                  </IconButton>
                );
              })}
              <Layers className={styles.centre} size={14} aria-hidden="true" />
            </div>
          </FieldRow>
        </>
      )}
    </>
  );
}
