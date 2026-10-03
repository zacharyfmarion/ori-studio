import { useTranslation } from 'react-i18next';
import {
  ArrowDownToDot,
  Box,
  Eye,
  FlipHorizontal2,
  Layers,
  RotateCcw,
  RotateCw,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import type {
  DiagramLinkedPoseAction,
  DiagramLinkedPoseActionId,
} from '../../diagram/actions/diagramLinkedPoseActions';
import { IconButton } from '../ui/IconButton';
import { SegmentedControl } from '../ui/SegmentedControl';

type ShowMode = 'crease-pattern' | 'folded';

const ICONS: Partial<Record<DiagramLinkedPoseActionId, LucideIcon>> = {
  'rotate-left': RotateCcw,
  'rotate-right': RotateCw,
  'turn-over': FlipHorizontal2,
  'next-solution': Layers,
  'view-top': ArrowDownToDot,
  'view-front': Eye,
  'view-iso': Box,
  reset: Undo2,
};

/**
 * A linked step's Pose verbs, for the step detail's toolbar: how the step
 * shows its pattern — Crease pattern or Folded — then what can be done to
 * that. `keep` runs a verb and keeps focus in the toolbar, as the upload's
 * pose buttons do.
 */
export function DiagramLinkedPoseControls({
  actions,
  keep,
}: {
  actions: readonly DiagramLinkedPoseAction[];
  keep: (run: () => void) => void;
}) {
  const { t } = useTranslation();
  const crease = actions.find((action) => action.id === 'show-crease-pattern');
  const folded = actions.find((action) => action.id === 'show-folded');
  const verbs = actions.filter((action) => ICONS[action.id]);
  return (
    <>
      {crease && folded && (
        <SegmentedControl<ShowMode>
          size="sm"
          aria-label={t('panels:diagram.pose.show', 'Show')}
          value={folded.pressed ? 'folded' : 'crease-pattern'}
          disabled={crease.disabled}
          options={[
            { value: 'crease-pattern', label: crease.label, title: crease.hint },
            { value: 'folded', label: folded.label, title: folded.hint },
          ]}
          onChange={(mode) => keep(mode === 'folded' ? folded.run : crease.run)}
        />
      )}
      {verbs.map((action) => {
        const Icon = ICONS[action.id]!;
        return (
          <IconButton
            key={action.id}
            size="sm"
            title={action.disabled && action.hint ? action.hint : action.label}
            aria-label={action.label}
            disabled={action.disabled}
            onClick={() => keep(action.run)}
          >
            <Icon size={15} />
          </IconButton>
        );
      })}
    </>
  );
}
