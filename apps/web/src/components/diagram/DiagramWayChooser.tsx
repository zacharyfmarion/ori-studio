import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ReferencesStepWayChoice } from '../../diagram/references/useReferencesStepWays';
import { SegmentedControl } from '../ui/SegmentedControl';
import { FieldRow, SegmentedRow } from '../ui/fieldRows';

/** Why a References step's ways cannot be offered: its plan is not to be had. */
function unavailableHint(t: TFunction): string {
  return t(
    'panels:diagram.pose.waysUnavailable',
    'Its plan isn’t in this file any more, or no longer fits its pattern. Replace from References… to choose again.'
  );
}

/** Each way's tooltip: which of how many, the first the planner's pick. */
function wayTitle(t: TFunction, index: number, count: number): string {
  return index === 0
    ? t('panels:diagram.pose.wayPick', 'Way 1 of {{count}}: the planner’s pick', { count })
    : t('panels:diagram.pose.wayOf', 'Way {{number}} of {{count}}', { number: index + 1, count });
}

/**
 * A References step's ways to fold its card (D23), in Pose's toolbar: one
 * segment a way, the planner's pick first. Nothing while its plan is read;
 * held, saying why, when its plan is not to be had.
 */
export function DiagramWayChooser({ choice, readOnly }: { choice: ReferencesStepWayChoice | null; readOnly: boolean }) {
  const { t } = useTranslation();
  if (!choice || choice.status === 'loading') return null;
  const label = t('panels:diagram.pose.way', 'Way');
  if (choice.status === 'unavailable') {
    return (
      // Refused rather than disabled: it stays where a finger or the keyboard can ask it why.
      <SegmentedControl<string>
        size="sm"
        aria-label={label}
        value={null}
        options={[{ value: 'way', label, tooltip: unavailableHint(t), disabled: true }]}
        onChange={() => {}}
      />
    );
  }
  const count = choice.ways.length;
  return (
    <SegmentedControl<string>
      size="sm"
      aria-label={label}
      value={String(choice.current)}
      disabled={readOnly}
      options={choice.ways.map((_, index) => ({
        value: String(index),
        label: String(index + 1),
        title: wayTitle(t, index, count),
      }))}
      onChange={(value) => choice.choose(Number(value))}
    />
  );
}

/** The same choice as a row of the Step pane's Pose section. */
export function DiagramWayRow({ choice, readOnly }: { choice: ReferencesStepWayChoice | null; readOnly: boolean }) {
  const { t } = useTranslation();
  if (!choice || choice.status === 'loading') return null;
  const label = t('panels:diagram.pose.way', 'Way');
  if (choice.status === 'unavailable') {
    return (
      <FieldRow label={label} kind="text" help={unavailableHint(t)}>
        {t('panels:diagram.pose.waysNotHere', 'Unavailable')}
      </FieldRow>
    );
  }
  return (
    <SegmentedRow
      label={label}
      value={String(choice.current)}
      disabled={readOnly}
      help={t('panels:diagram.pose.wayHelp', 'The ways References found to fold this crease. Way 1 is the planner’s pick.')}
      options={choice.ways.map((_, index) => ({ id: String(index), label: String(index + 1) }))}
      onChange={(value) => choice.choose(Number(value))}
    />
  );
}
