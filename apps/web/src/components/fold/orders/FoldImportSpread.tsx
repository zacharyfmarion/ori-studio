import { useTranslation } from 'react-i18next';
import { spreadStartsAmong } from '../../../cp-workspace/folded/layerSpreadSettings';
import { useFoldImportOrderUi } from '../../../fold/orders/foldImportOrderUi';
import { foldStepSpreadControls, type FoldSpreadSitting } from '../../../fold/sequence/foldStepSpreadControls';
import { trackFoldSpreadChanged } from '../../../analytics/trackFold';
import { LayerSpreadRows } from '../../paper/LayerSpreadRows';
import { CollapsibleSection } from '../../ui/CollapsibleSection';

const sitting: { current: FoldSpreadSitting | null } = { current: null };

/** A first CP preview has no saved step to own spread settings yet. Sidebar only. */
export function FoldImportSpread({ atSheet }: { atSheet: boolean }) {
  const { t } = useTranslation();
  const { choosing, spread } = useFoldImportOrderUi();
  if (!atSheet || !choosing) return null;
  const controls = foldStepSpreadControls({
    effective: { spread, origin: 'default', from: null }, starts: spreadStartsAmong([]), hint: undefined,
  }, {
    t, sitting, newSession: () => 0,
    set: (setting) => { useFoldImportOrderUi.setState({ spread: setting === 'off' ? null : setting }); return true; },
    changed: (change, value) => trackFoldSpreadChanged(change, 'step_pane', value),
  });
  return <CollapsibleSection title={t('panels:fold.step.spread', 'Spread')}
    description={t('panels:fold.step.previewSpread', 'Inspect this preview. The saved step starts with spreading off.')}>
    <LayerSpreadRows toggle={controls.toggle} spread={controls.spread} />
  </CollapsibleSection>;
}
