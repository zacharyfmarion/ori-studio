import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LayerSide } from '../../layer-order/engine/layerOrderEngine';
import type { LayerPanesView } from '../../layer-order/panes/layerPaneMarks';
import { Button } from '../ui/Button';
import { SegmentedControl } from '../ui/SegmentedControl';
import styles from './LayerOrderViewTools.module.css';

export interface LayerOrderViewToolsProps {
  readonly view: LayerPanesView;
  readonly onChange: (view: LayerPanesView) => void;
  /** Nothing to look at yet, or nothing to look at at all: the tools are inert (Round4-States). */
  readonly disabled: boolean;
}

/**
 * The title row's view tools (A3, Round3:345-356; `Round4-Phone`): which side
 * of the folded figure shows, X-ray, and Undecided, which tints the spots
 * whose face on top isn't decided yet. A lens on the panes: none of them
 * changes what is saved (spec §5). The frame places them (`ModalFrame`'s
 * tools, on a row of their own on a phone). Memoised: a pane hover changes
 * none of its props.
 */
export const LayerOrderViewTools = memo(function LayerOrderViewTools({ view, onChange, disabled }: LayerOrderViewToolsProps) {
  const { t } = useTranslation();
  const sideLabel = t('dialogs:layerOrder.view.side', 'Side');
  return (
    <div className={styles.tools}>
      <div className={styles.side}>
        <span className={styles.label} aria-hidden="true">
          {sideLabel}
        </span>
        <SegmentedControl<LayerSide>
          size="sm"
          aria-label={sideLabel}
          value={view.side}
          disabled={disabled}
          onChange={(side) => onChange({ ...view, side })}
          options={[
            { value: 'front', label: t('dialogs:layerOrder.view.front', 'Front') },
            { value: 'back', label: t('dialogs:layerOrder.view.back', 'Back') },
          ]}
        />
      </div>
      <Button
        size="sm"
        variant="secondary"
        aria-pressed={view.xray}
        isActive={view.xray}
        disabled={disabled}
        title={t('dialogs:layerOrder.view.xrayTitle', 'Show every layer of the folded figure faintly')}
        onClick={() => onChange({ ...view, xray: !view.xray })}
      >
        {t('dialogs:layerOrder.view.xray', 'X-ray')}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        aria-pressed={view.undecided}
        isActive={view.undecided}
        disabled={disabled}
        title={t('dialogs:layerOrder.view.undecidedTitle', 'Tint where the face on top isn’t decided yet')}
        onClick={() => onChange({ ...view, undecided: !view.undecided })}
      >
        {t('dialogs:layerOrder.view.undecided', 'Undecided')}
      </Button>
    </div>
  );
});
