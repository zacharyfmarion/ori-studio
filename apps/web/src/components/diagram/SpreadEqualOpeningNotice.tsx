import { useTranslation } from 'react-i18next';
import type { EqualOpeningUpdate } from '../../diagram/capture/useEqualOpeningUpdate';
import { Notice } from '../ui/Notice';

/**
 * Under Presentation, for a Default spread saved in Perspective 3D before
 * models' Amount opened alike (`implementation-plans/spread-equal-opening.md`):
 * that it is drawn the older way, and Update, which keeps how it looks unless
 * the older way opened it past the new 100%, where it comes down to 100%.
 */
export function SpreadEqualOpeningNotice({ update }: { update: EqualOpeningUpdate }) {
  const { t } = useTranslation();
  return (
    <Notice
      actions={[
        {
          id: 'update',
          label: t('panels:diagram.spread.equalOpeningUpdate', 'Update'),
          disabled: update.disabled,
          run: update.run,
        },
      ]}
    >
      {t(
        'panels:diagram.spread.equalOpeningNotice',
        'This picture uses the older Amount scale, which opens simple models far more than complex ones. Updating keeps how it looks, unless it opens past the new 100%.'
      )}
    </Notice>
  );
}
