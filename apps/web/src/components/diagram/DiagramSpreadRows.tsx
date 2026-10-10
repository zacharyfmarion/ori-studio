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
  Info,
  type LucideIcon,
} from 'lucide-react';
import type { SpreadDirection } from '../../cp-workspace/folded/foldedLayerSpread';
import type { DiagramLinkedPoseAction, DiagramSpreadChoice } from '../../diagram/actions/diagramLinkedPoseActions';
import type { DiagramLinkedSpread } from '../../diagram/capture/useDiagramLinkedPose';
import { SPREAD_AMOUNT_RANGE, SPREAD_AXIS_RANGE } from '../../diagram/document/diagramDocument';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip';
import { IconButton } from '../ui/IconButton';
import { FieldRow, SegmentedRow, SliderRow, ToggleRow } from '../ui/fieldRows';
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

/** The amount slider moves in half percents, as the readout says them. */
const AMOUNT_STEP_PERCENT = 0.5;

/**
 * A flat fold's layers spread apart (Phase 13), in the Step pane's Pose
 * section: Spread Layers on or off, and while on, how — by depth or affine
 * (13g). By depth: how far the deepest layer steps, a slider whose drag
 * previews the picture and commits once, and which way, eight buttons round a
 * centre. Affine: how far points move back toward the sheet, which layer
 * holds still, and the skew and its axis, sliders as the amount is. The verbs
 * are the open step's pose controller's (`useDiagramLinkedPose`); this only
 * lays them out.
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
  const degrees = (value: number) =>
    t('panels:diagram.pose.spreadAxisDegrees', '{{degrees}}°', {
      degrees: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(value),
    });
  const shown = spread?.spread;
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
      {spread && shown && (
        <>
          <FieldRow label={t('panels:diagram.pose.spreadKind', 'Spread by')} kind="segmented" title={spread.hint}>
            <span className={styles.kind}>
              <SegmentedControl
                size="sm"
                aria-label={t('panels:diagram.pose.spreadKind', 'Spread by')}
                value={shown.kind}
                options={spread.kinds.map(({ value, label }) => ({ value, label }))}
                disabled={spread.disabled}
                onChange={(value) => choose(spread.kinds, value)}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    className={styles.credit}
                    href="https://kei-morisue.github.io/step-folder/"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t('panels:diagram.pose.affineCredit', 'Affine distortion by Kei Morisue — visit DEFOX')}
                  >
                    <Info size={13} aria-hidden="true" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>
                  {t('panels:diagram.pose.affineCredit', 'Affine distortion by Kei Morisue — visit DEFOX')}
                </TooltipContent>
              </Tooltip>
            </span>
          </FieldRow>
          <SliderRow
            label={t('panels:diagram.pose.spreadAmount', 'Amount')}
            ariaLabel={t('panels:diagram.pose.spreadAmountName', 'Spread amount')}
            value={shown.amount * 100}
            min={SPREAD_AMOUNT_RANGE[shown.kind].min * 100}
            max={SPREAD_AMOUNT_RANGE[shown.kind].max * 100}
            step={AMOUNT_STEP_PERCENT}
            format={percent}
            valueText={(value) =>
              shown.kind === 'depth'
                ? t('panels:diagram.pose.spreadAmountValue', '{{percent}} of the model', { percent: percent(value) })
                : t('panels:diagram.pose.spreadAffineAmountValue', '{{percent}} of the way back to the sheet along the axis', {
                    percent: percent(value),
                  })
            }
            disabled={spread.disabled}
            title={spread.hint}
            onChange={(value) => spread.preview('amount', value / 100)}
            onGestureStart={spread.start}
            onGestureCommit={spread.commit}
          />
          {shown.kind === 'depth' ? (
            <FieldRow label={t('panels:diagram.pose.spreadDirection', 'Direction')} kind="segmented" title={spread.hint}>
              <div
                className={styles.compass}
                role="group"
                aria-label={t('panels:diagram.pose.spreadDirectionName', 'Spread direction')}
              >
                {spread.directions.map((direction) => {
                  const Icon = ARROWS[direction.value];
                  const held = direction.disabled || direction.waiting;
                  return (
                    <IconButton
                      key={direction.value}
                      size="sm"
                      className={styles.direction}
                      data-toward={direction.value}
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
          ) : (
            <>
              <SegmentedRow
                label={t('panels:diagram.pose.spreadKeep', 'Keep still')}
                value={shown.keep}
                options={spread.keeps.map(({ value, label }) => ({ id: value, label }))}
                disabled={spread.disabled}
                title={spread.hint}
                help={t(
                  'panels:diagram.pose.spreadKeepHelp',
                  'The layer that does not move: the one on top, or the one at the bottom, as the front shows them.'
                )}
                onChange={(value) => choose(spread.keeps, value)}
              />
              <SliderRow
                label={t('panels:diagram.pose.spreadSkew', 'Skew')}
                ariaLabel={t('panels:diagram.pose.spreadSkewName', 'Spread skew')}
                value={shown.skew * 100}
                min={0}
                max={100}
                step={1}
                format={percent}
                valueText={(value) =>
                  t('panels:diagram.pose.spreadSkewValue', '{{percent}} skewed about the axis', { percent: percent(value) })
                }
                disabled={spread.disabled}
                title={spread.hint}
                onChange={(value) => spread.preview('skew', value / 100)}
                onGestureStart={spread.start}
                onGestureCommit={spread.commit}
              />
              <SliderRow
                label={t('panels:diagram.pose.spreadAxis', 'Axis')}
                ariaLabel={t('panels:diagram.pose.spreadAxisName', 'Spread axis')}
                value={shown.axisDeg}
                min={SPREAD_AXIS_RANGE.min}
                max={SPREAD_AXIS_RANGE.max}
                step={1}
                format={degrees}
                valueText={(value) =>
                  t('panels:diagram.pose.spreadAxisValue', 'Axis at {{degrees}} on the sheet', {
                    degrees: degrees(value),
                  })
                }
                disabled={spread.disabled}
                title={spread.hint}
                onChange={(value) => spread.preview('axis', value)}
                onGestureStart={spread.start}
                onGestureCommit={spread.commit}
              />
            </>
          )}
        </>
      )}
    </>
  );
}

/** The choice a segmented row picked: run, which refuses while a capture runs. */
function choose<T extends string>(choices: readonly DiagramSpreadChoice<T>[], value: string): void {
  choices.find((choice) => choice.value === value)?.run();
}
