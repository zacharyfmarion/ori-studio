import { useTranslation } from 'react-i18next';
import type { EqualOpeningUpdate } from '../../diagram/capture/useEqualOpeningUpdate';
import { spacingUpdateText } from '../../layer-spread/spreadUpdate';
import { Notice } from '../ui/Notice';

/** An explicit scale upgrade for the currently displayed picture. */
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
      {spacingUpdateText(t, update.capped === true)}
    </Notice>
  );
}
