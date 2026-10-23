import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, PenLine } from 'lucide-react';
import type { LayerSpreadToggle } from '../../../cp-workspace/folded/layerSpreadControls';
import type { FoldPaneDisplay } from '../../../fold/canvas/foldPaneScenes';
import { ViewportToolbar, type ViewportToolbarGroupSpec } from '../../panels/ViewportToolbar';
import { FoldFlatCreasesIcon } from './FoldFlatCreasesIcon';

/**
 * The floating bar along the bottom of the Fold canvas (plan D14, the
 * design's): the shared zoom cluster and Fit, for both panes at once, the
 * panes' two display switches — the step's own creases drawn as its
 * instruction (a pen), and the flat creases (a creased sheet,
 * `FoldFlatCreasesIcon`) — beside them the step's Spread Layers (the
 * Diagram's layers icon)
 * (`spread`, the Step pane's switch: a setting of the step, not of the view),
 * and a slot for Send to Edit, which the panel supplies.
 *
 * A phone's bar leads with the canvas's own controls (`phoneGroups`: the
 * starred tools and the pane switch); the display switches and Fit are in its
 * `⋯` menu, the zoom left to a pinch.
 */
export function FoldViewportToolbar({
  zoomPercent,
  camera,
  display,
  onDisplay,
  spread = null,
  phoneGroups = [],
  sendToEdit,
}: {
  zoomPercent: number;
  camera: {
    zoomIn: () => void;
    zoomOut: () => void;
    fit: () => void;
    setZoomPercent: (percent: number) => void;
  };
  display: FoldPaneDisplay;
  onDisplay: (display: FoldPaneDisplay) => void;
  /** The step on screen's Spread Layers (`useFoldStepSpread`); null at the flat sheet, which has none. */
  spread?: LayerSpreadToggle | null;
  /** A phone's: the starred tools and the pane switch (`useFoldPhoneBarGroups`), at the head of the bar. */
  phoneGroups?: readonly ViewportToolbarGroupSpec[];
  sendToEdit?: ReactNode;
}) {
  const { t } = useTranslation();
  const groups: ViewportToolbarGroupSpec[] = [
    ...phoneGroups,
    {
      id: 'display',
      items: [
        {
          kind: 'action',
          id: 'step-creases',
          label: t('panels:fold.canvas.stepCreases', 'Step creases'),
          title: t(
            'panels:fold.canvas.stepCreasesTitle',
            'Draw the creases the step on show made in bold, as its instruction'
          ),
          icon: <PenLine size={14} />,
          checked: display.stepCreases,
          pinned: true,
          // A phone's bar is the tools': this goes to its menu.
          onPhone: 'collapse',
          onSelect: () => onDisplay({ ...display, stepCreases: !display.stepCreases }),
        },
        {
          kind: 'action',
          id: 'precreases',
          label: t('panels:fold.canvas.flatCreases', 'Flat creases'),
          title: t(
            'panels:fold.canvas.flatCreasesTitle',
            'Draw the flat creases on the paper: precreases, and folds unfolded again'
          ),
          icon: <FoldFlatCreasesIcon size={14} />,
          checked: display.precreases,
          pinned: true,
          onPhone: 'collapse',
          onSelect: () => onDisplay({ ...display, precreases: !display.precreases }),
        },
        {
          kind: 'action',
          id: 'spread-layers',
          label: t('panels:fold.canvas.spreadLayers', 'Spread layers'),
          title:
            spread?.disabled && spread.hint
              ? spread.hint
              : t(
                  'panels:fold.canvas.spreadLayersTitle',
                  'Spread the folded layers apart, as a diagram draws them, on this step and the ones after it'
                ),
          // The Diagram's Spread Layers icon: one verb, one icon.
          icon: <Layers size={14} />,
          checked: spread?.pressed ?? false,
          // The flat sheet has no step to set it on, and no layers to spread.
          disabled: !spread || spread.disabled,
          pinned: true,
          onPhone: 'collapse',
          onSelect: () => spread?.run(),
        },
      ],
    },
    { id: 'send', items: [sendToEdit ? { kind: 'node', id: 'send-to-edit', node: sendToEdit } : null] },
  ];
  return (
    <ViewportToolbar
      ariaLabel={t('panels:fold.canvas.toolbar', 'Fold view')}
      zoomPercent={zoomPercent}
      zoomIn={camera.zoomIn}
      zoomOut={camera.zoomOut}
      fitToView={camera.fit}
      setZoomLevel={(scale) => camera.setZoomPercent(scale * 100)}
      groups={groups}
      // A phone's bar is the canvas's tools, with
      // the zoom buttons left to a pinch, and Fit and the display switches in
      // the overflow menu. Inline, they wrapped the bar onto a second row.
      phoneViewControls="collapsed"
    />
  );
}
