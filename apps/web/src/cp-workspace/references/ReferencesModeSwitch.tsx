import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair, ListOrdered } from 'lucide-react';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import type { ReferencesMode } from './referencesMode';

/**
 * The switch between the workspace's two jobs, in the toolbar: find one
 * reference, or read the folding sequence.
 *
 * A control that stays, not a question asked once. A chooser dismissed on
 * arrival is a modal the reader cannot find again, and on a phone a
 * full-screen dead end; a segmented control costs one row and also tells the
 * reader which of the two things the canvas is currently showing.
 *
 * Presentation only: the mode and what a press does are props.
 */
export interface ReferencesModeSwitchProps {
  mode: ReferencesMode;
  onChange: (mode: ReferencesMode) => void;
  disabled?: boolean;
}

export const ReferencesModeSwitch = memo(function ReferencesModeSwitch({
  mode,
  onChange,
  disabled = false,
}: ReferencesModeSwitchProps) {
  const { t } = useTranslation();
  return (
    <div className="references-mode">
      <SegmentedControl<ReferencesMode>
        aria-label={t('panels:references.mode.label', 'What to show')}
        value={mode}
        onChange={onChange}
        disabled={disabled}
        options={[
          {
            value: 'find',
            label: t('panels:references.mode.find', 'Find a reference'),
            title: t(
              'panels:references.mode.findTitle',
              'Tap a vertex or crease to see how to fold it from a blank sheet'
            ),
            icon: <Crosshair size={13} aria-hidden="true" />,
          },
          {
            value: 'sequence',
            label: t('panels:references.mode.sequence', 'Folding sequence'),
            title: t(
              'panels:references.mode.sequenceTitle',
              'Every precrease of the pattern, in the order to fold them'
            ),
            icon: <ListOrdered size={13} aria-hidden="true" />,
          },
        ]}
      />
    </div>
  );
});
