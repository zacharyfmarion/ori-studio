import type { ReactElement } from 'react';
import type { DiagramLineType } from '../../diagram/annotate/lineTypes';

/**
 * Each type's dash, in widths of the stroke: the diagram's valley, its
 * dash-dot mountain, a hidden line's dots, and none for a solid line (17a),
 * a plain stroke round at its ends.
 */
const DASH: Readonly<Record<DiagramLineType, string | undefined>> = {
  valley: '4 2.4',
  mountain: '6 2 1.2 2',
  hidden: '1.2 2',
  solid: undefined,
};

/**
 * A line type as a short stroke in its own dash (15a, decision 5): the icon of
 * each option in the rail's Line Type and the Step pane's Type. A diagram's
 * lines differ by their dash, not their colour, so the dash is the name; the
 * option's label says it to a screen reader and its tooltip.
 */
export function DiagramLineTypeMark({ type }: { type: DiagramLineType }): ReactElement {
  return (
    <svg width={28} height={10} viewBox="0 0 28 10" aria-hidden="true">
      <path
        d="M2 5 H26"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeDasharray={DASH[type]}
        strokeLinecap={type === 'solid' ? 'round' : 'butt'}
      />
    </svg>
  );
}
