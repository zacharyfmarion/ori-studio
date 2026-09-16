import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import type { ReferencesLead as ReferencesLeadState } from './referencesMode';

/**
 * The one line under the toolbar where the filmstrip goes once there are
 * cards. The strip is not rendered until then — an empty strip with two
 * arrows reads as broken — so this stands in its place and says what the
 * reader can do: how to ask, in Find; that the sequence is being worked
 * out; or the button that works it out when nothing is running and nothing
 * is there to read.
 *
 * Presentation only.
 */
export interface ReferencesLeadProps {
  lead: ReferencesLeadState;
  /** Plan the sequence now: the button, when nothing is there to read. */
  onPlan: () => void;
  /**
   * Switch to the Precreasing sequence tab, from Find's hint. The first
   * thing anyone reads names both jobs, so the second is found without
   * noticing the tab — the tab stays as the switch, and the line teaches it.
   */
  onPlanSequence: () => void;
}

export const ReferencesLead = memo(function ReferencesLead({
  lead,
  onPlan,
  onPlanSequence,
}: ReferencesLeadProps) {
  const { t } = useTranslation();
  if (lead.kind === 'none') return null;
  return (
    <div className="references-lead" role="status">
      {lead.kind === 'hint-find' && (
        <p className="references-lead__text">
          {t(
            'panels:references.lead.find',
            'Tap a vertex or crease to see how to fold it from a blank sheet.'
          )}{' '}
          <button type="button" className="references-lead__link" onClick={onPlanSequence}>
            {t('panels:references.lead.findSequence', 'Or plan the whole precreasing sequence.')}
          </button>
        </p>
      )}
      {lead.kind === 'planning' && (
        <p className="references-lead__text">
          {t('panels:references.planning', 'Working out the precreasing sequence…')}
        </p>
      )}
      {lead.kind === 'plan' && (
        <>
          <p className="references-lead__text">
            {t(
              'panels:references.lead.plan',
              'Every precrease of the pattern, in the order to fold them.'
            )}
          </p>
          <Button variant="primary" size="sm" onClick={onPlan}>
            {t('panels:references.lead.planAction', 'Plan the precreasing sequence')}
          </Button>
        </>
      )}
    </div>
  );
});
