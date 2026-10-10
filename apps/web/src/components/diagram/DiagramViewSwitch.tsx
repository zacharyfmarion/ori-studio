import { useTranslation } from 'react-i18next';
import { Files, LayoutGrid } from 'lucide-react';
import type { DiagramViewMode } from '../../store/workspaceStore/types';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
import { WorkspaceTab, WorkspaceTabStrip } from '../ui/WorkspaceTabStrip';

/**
 * The Diagram's two views as tabs in its header: the steps as cards, and the
 * pages as they will print. References' mode switch, drawn the same way —
 * embedded, peers, and sharing the width on a phone.
 */
export function DiagramViewSwitch({
  view,
  onChange,
  className,
}: {
  view: DiagramViewMode;
  onChange: (view: DiagramViewMode) => void;
  /** Placement by the header. */
  className?: string;
}) {
  const { t } = useTranslation();
  const phone = useIsPhoneLayout();
  return (
    <WorkspaceTabStrip
      className={className}
      value={view}
      onValueChange={(value) => onChange(value as DiagramViewMode)}
      label={t('panels:diagram.view.label', 'View')}
      embedded
      tone="peers"
      fill={phone}
    >
      <WorkspaceTab
        value="steps"
        icon={<LayoutGrid size={13} aria-hidden="true" />}
        title={t('panels:diagram.view.steps', 'Steps')}
        hint={t('panels:diagram.view.stepsHint', 'Every step as a card, to arrange and edit')}
      />
      <WorkspaceTab
        value="pages"
        icon={<Files size={13} aria-hidden="true" />}
        title={t('panels:diagram.view.pages', 'Pages')}
        hint={t('panels:diagram.view.pagesHint', 'The pages as they will print')}
      />
    </WorkspaceTabStrip>
  );
}
