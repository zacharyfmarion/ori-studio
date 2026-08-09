import { useTranslation } from 'react-i18next';
import type { OristudioBpRiver, OristudioBpTreeEdge } from '../../engine/oristudioBpTypes';
import { TreeEdgeLengthEditor } from '../../tree-editor/TreeEdgeLengthEditor';
import { SNAPPED_LENGTHS } from '../../tree-editor/lengths';

/**
 * Contextual editor for a single selected river, shown as the top-center pill
 * in the packing pane — the same spot and the same shape as the flap editor.
 *
 * A river's width *is* its dual tree edge's length, which is why this is the
 * tree pane's edge-length pill with different words on it. Box Pleating Studio
 * does the same: its river panel is one number field bound straight to
 * `Edge.length`, labelled "Width"
 * (`third_party/box-pleating-studio/src/app/vue/panel/river.vue`).
 *
 * Whole grid units, at least one, capped by the edge's `maxLength` — the same
 * `SNAPPED_LENGTHS` rule the BP tree pane edits lengths under, so a river steps
 * identically from either pane. The cap is applied but never shown; see
 * {@link TreeEdgeLengthEditor}.
 */
export function BpRiverEditor({
  river,
  edge,
  onSetWidth,
  onEscape,
}: {
  river: OristudioBpRiver;
  edge: OristudioBpTreeEdge;
  onSetWidth: (width: number) => void;
  onEscape?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <TreeEdgeLengthEditor
      edge={edge}
      rule={SNAPPED_LENGTHS}
      title={t('panels:bpPacking.riverTitle', 'River {{id}}', { id: river.id })}
      label={t('panels:bpPacking.riverWidth', 'Width')}
      groupLabel={t('panels:bpPacking.riverWidthGroup', 'River {{id}} width', { id: river.id })}
      increaseLabel={t('panels:bpPacking.riverWidthIncrease', 'Increase river width')}
      decreaseLabel={t('panels:bpPacking.riverWidthDecrease', 'Decrease river width')}
      onSetLength={onSetWidth}
      onEscape={onEscape}
    />
  );
}
