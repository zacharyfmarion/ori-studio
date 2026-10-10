import { useTranslation } from 'react-i18next';
import { behindEnds, MAX_BEHIND_LAYERS } from '../../diagram/annotate/annotationModel';
import { isLineKind } from '../../diagram/annotate/lineTypes';
import type { KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { Notice } from '../ui/Notice';
import { NumberRow, SegmentedRow, ToggleRow } from '../ui/fieldRows';

/**
 * A selected mark's place in the folds (15e of the second Annotate plan):
 * each end of an arrow — its Tail and its Tip — or of a line — its Start and
 * its End — In Front or Behind a flap, a circle Behind or not, and with any
 * end behind, how many layers lie over it (Under), each one undo step. Only a
 * flat fold knows its flaps: on any other picture the rows are off and say
 * so, and a mark that is behind keeps it, drawn in front.
 */
export function DiagramBehindControls({
  annotation,
  editable,
  knowsFlaps,
  onEnd,
  onLayers,
}: {
  annotation: KnownDiagramAnnotation;
  editable: boolean;
  knowsFlaps: boolean;
  onEnd: (end: 'from' | 'to', behind: boolean) => void;
  onLayers: (layers: number) => void;
}) {
  const { t } = useTranslation();
  const ends = behindEnds(annotation.kind);
  if (ends.length === 0) return null;
  const enabled = editable && knowsFlaps;
  const behind = annotation.behind;
  const deep = behind?.from ?? behind?.to;
  const options = [
    { id: 'front', label: t('panels:diagram.annotations.inFront', 'In Front') },
    { id: 'behind', label: t('panels:diagram.annotations.behind', 'Behind') },
  ];
  const endName = (end: 'from' | 'to') =>
    isLineKind(annotation.kind)
      ? end === 'from'
        ? t('panels:diagram.annotations.lineStart', 'Start')
        : t('panels:diagram.annotations.lineEnd', 'End')
      : end === 'from'
        ? t('panels:diagram.annotations.arrowTail', 'Tail')
        : t('panels:diagram.annotations.arrowTip', 'Tip');
  return (
    <>
      {annotation.kind === 'circle' ? (
        <ToggleRow
          label={t('panels:diagram.annotations.behind', 'Behind')}
          checked={behind?.from !== undefined}
          disabled={!enabled}
          onChange={(value) => onEnd('from', value)}
        />
      ) : (
        ends.map((end) => (
          <SegmentedRow
            key={end}
            label={endName(end)}
            value={behind?.[end] !== undefined ? 'behind' : 'front'}
            disabled={!enabled}
            options={options}
            onChange={(value) => onEnd(end, value === 'behind')}
          />
        ))
      )}
      {deep !== undefined && (
        <NumberRow
          label={t('panels:diagram.annotations.under', 'Under')}
          title={t('panels:diagram.annotations.underHelp', 'How many layers lie over each end that is behind.')}
          value={deep}
          min={1}
          max={MAX_BEHIND_LAYERS}
          disabled={!enabled}
          normalize={(layers) => Math.min(MAX_BEHIND_LAYERS, Math.max(1, Math.round(layers)))}
          onCommit={onLayers}
        />
      )}
      {!knowsFlaps && (
        <Notice>{t('panels:diagram.annotations.behindNeedsFold', 'Only a folded picture knows its flaps.')}</Notice>
      )}
    </>
  );
}
