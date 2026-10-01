import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair, ListOrdered } from 'lucide-react';
import { WorkspaceTab, WorkspaceTabStrip } from '../../components/ui/WorkspaceTabStrip';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
import type { ReferencesMode } from './referencesMode';

/**
 * The switch between the workspace's two jobs — find one reference, or read
 * the precreasing sequence — as the tabs the Design workspace draws its designs
 * with: the same component (`WorkspaceTabStrip`), so the two strips cannot
 * drift apart and the keyboard reaches them the same way. Embedded in the panel
 * toolbar, as peers rather than documents, and sharing the width on a phone.
 *
 * A control that stays, not a question asked once. A chooser dismissed on
 * arrival is a modal the reader cannot find again, and on a phone a
 * full-screen dead end; a strip of two tabs is the header, and also tells the
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
  const phone = useIsPhoneLayout();
  const options: {
    value: ReferencesMode;
    label: string;
    title: string;
    icon: React.ReactNode;
  }[] = [
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
      label: t('panels:references.mode.sequence', 'Precreasing sequence'),
      title: t(
        'panels:references.mode.sequenceTitle',
        'Every precrease of the pattern, in the order to fold them'
      ),
      icon: <ListOrdered size={13} aria-hidden="true" />,
    },
  ];
  return (
    <WorkspaceTabStrip
      className="references-mode"
      value={mode}
      onValueChange={(value) => onChange(value as ReferencesMode)}
      label={t('panels:references.mode.label', 'What to show')}
      embedded
      tone="peers"
      fill={phone}
    >
      {options.map((option) => (
        <WorkspaceTab
          key={option.value}
          value={option.value}
          data-references-mode={option.value}
          hint={option.title}
          disabled={disabled}
          icon={option.icon}
          title={option.label}
        />
      ))}
    </WorkspaceTabStrip>
  );
});
