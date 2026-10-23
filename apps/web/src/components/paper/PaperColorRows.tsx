import { useTranslation } from 'react-i18next';
import type { PaperDisplayStyleBinding } from '../../lib/paper/usePaperDisplayStyle';
import { ColorField } from '../ui/ColorField';

/**
 * The paper's Front and Back colours as two option-pane rows over the app's
 * display style — Simulate's Paper section, and Fold's Paper tab. It takes
 * the pane's binding rather than binding again, so its rows share the pane's
 * analytics source and adjustment run: a switch elsewhere in the pane ends a
 * colour drag here, as it would one of the pane's own rows.
 *
 * The labels are Simulate's catalog keys, where the rows were first written;
 * the words are the same wherever the rows are shown.
 */
export function PaperColorRows({
  paper,
}: {
  paper: Pick<PaperDisplayStyleBinding, 'style' | 'setPaperColor' | 'endAdjustment'>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <ColorField
        label={t('panels:simulatorViewControls.paperFront', 'Front')}
        layout="row"
        value={paper.style.paper.front}
        onChange={(value) => paper.setPaperColor('paper.front', value)}
        onCommit={paper.endAdjustment}
      />
      {/* The last of a group: the section ends it, so no rule of its own. */}
      <ColorField
        label={t('panels:simulatorViewControls.paperBack', 'Back')}
        layout="row"
        divider={false}
        value={paper.style.paper.back}
        onChange={(value) => paper.setPaperColor('paper.back', value)}
        onCommit={paper.endAdjustment}
      />
    </>
  );
}
