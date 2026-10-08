import { useTranslation } from 'react-i18next';
import {
  DIVISIONS_OFFSET_MM,
  DIVISIONS_PARTS,
  divisionsOffsetOf,
  divisionsOffsetWithin,
  divisionsParts,
  divisionsPartsOf,
} from '../../diagram/annotate/annotationModel';
import { useDivisionsCrowded } from '../../diagram/annotate/useDivisionsCrowded';
import { useFieldFocusRequest } from '../../diagram/annotate/useFieldFocusRequest';
import type { DiagramStep, DiagramTicks, KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { NumberRow, ToggleRow } from '../ui/fieldRows';
import { Notice } from '../ui/Notice';
import { DiagramTicksRow } from './DiagramTicksRow';
import styles from './DiagramDivisionsControls.module.css';

/**
 * Equal divisions' own rows in the Layers pane (Revision 2): Parts — which
 * takes the focus for a mark just laid, so its count is typed and Enter gives
 * the canvas its keys back (ED5) — with a warning when its parts are too short
 * for their ticks at the size the step prints (ED10); Offset, in mm as it
 * prints (ED3); Ticks (ED7); Number, whether the count prints beside the
 * line (ED6); and Short Dividers, whether the dividers between the ends are
 * short strokes across the line (Revision 3, R3-1 A). Each change is one
 * undo step.
 */
export function DiagramDivisionsControls({
  step,
  annotation,
  editable,
  onParts,
  onOffset,
  onTicks,
  onNumbered,
  onShortDividers,
}: {
  step: DiagramStep;
  annotation: KnownDiagramAnnotation;
  editable: boolean;
  onParts: (parts: number) => void;
  onOffset: (offset: number) => void;
  onTicks: (ticks: DiagramTicks) => void;
  onNumbered: (numbered: boolean) => void;
  onShortDividers: (short: boolean) => void;
}) {
  const { t } = useTranslation();
  const parts = useFieldFocusRequest<HTMLInputElement>(annotation.id, 'parts');
  const crowded = useDivisionsCrowded(step, annotation);
  return (
    <>
      <NumberRow
        label={t('panels:diagram.annotations.parts', 'Parts')}
        value={divisionsPartsOf(annotation)}
        min={DIVISIONS_PARTS.min}
        max={DIVISIONS_PARTS.max}
        disabled={!editable}
        normalize={divisionsParts}
        fieldRef={parts}
        onCommit={onParts}
      />
      {crowded && (
        <div className={styles.notice}>
          <Notice tone="warning">
            {t('panels:diagram.annotations.partsCrowded', 'Too many parts to print clearly at this size.')}
          </Notice>
        </div>
      )}
      <NumberRow
        label={t('panels:diagram.annotations.offset', 'Offset')}
        value={divisionsOffsetOf(annotation)}
        min={DIVISIONS_OFFSET_MM.min}
        max={DIVISIONS_OFFSET_MM.max}
        step={DIVISIONS_OFFSET_MM.step}
        suffix="mm"
        disabled={!editable}
        normalize={divisionsOffsetWithin}
        onCommit={onOffset}
      />
      <DiagramTicksRow value={annotation.ticks} disabled={!editable} onChange={onTicks} />
      <ToggleRow
        label={t('panels:diagram.annotations.number', 'Number')}
        help={t('panels:diagram.annotations.numberHelp', 'Print the count beside the line.')}
        checked={annotation.numbered === true}
        disabled={!editable}
        onChange={onNumbered}
      />
      <ToggleRow
        label={t('panels:diagram.annotations.shortDividers', 'Short Dividers')}
        help={t('panels:diagram.annotations.shortDividersHelp', 'Draw the dividers between the ends as short strokes across the line.')}
        checked={annotation.shortDividers === true}
        disabled={!editable}
        onChange={onShortDividers}
      />
    </>
  );
}
