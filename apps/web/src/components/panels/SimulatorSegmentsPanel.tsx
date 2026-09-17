import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Shapes } from 'lucide-react';
import { segmentSheetThumbnail } from '../../cp-workspace/sheets/segmentSheet';
import { SheetGrid, type SheetGridItem } from '../../cp-workspace/sheets/SheetGrid';
import type { FoldDocument } from '../../engine/types';
import type { CpSegment } from '../../lib/creasePatternSegmentation';

/**
 * Fixed, non-draggable sidebar rendered inside the simulator panel. Lists the
 * document's crease-pattern segments as the shared sheet cards and reports
 * which one was pressed.
 *
 * The same rail the References workspace has (`ReferencesSheetsSidebar`), for
 * the same reason: a document can hold several disjoint patterns and only one
 * of them is being folded right now. On a phone it is the whole screen rather
 * than a rail — the list the reader picks a pattern from, with the simulator
 * behind a press (`useSimulatorPhoneFlow`) — and the stylesheet's phone block
 * is what stretches it and grows the cards (`theme.css`, `.segments-sidebar`
 * and `.sheet-grid`).
 *
 * Presentation only: the segments, which one is active, and a press reports
 * back. What a press *means* is the panel's — a selection beside the canvas
 * on a desktop, and on a phone the detail screen too.
 */
export interface SimulatorSegmentsSidebarProps {
  /**
   * The fold the segments were cut from — the real (untriangulated) crease
   * fold, not the simulation mesh, so the cards show the actual pattern.
   */
  fold: FoldDocument;
  segments: readonly CpSegment[];
  selected: number | null;
  onSelect: (id: number) => void;
}

export const SimulatorSegmentsSidebar = memo(function SimulatorSegmentsSidebar({
  fold,
  segments,
  selected,
  onSelect,
}: SimulatorSegmentsSidebarProps) {
  const { t } = useTranslation();
  // Sized in faces, not creases: the fold's edges are split at every crossing,
  // so a count of them is not the count of drawn lines the References rail
  // gives the same pattern.
  const items = useMemo<SheetGridItem[]>(
    () =>
      segments.map((segment) => ({
        id: segment.id,
        thumbnail: segmentSheetThumbnail(fold, segment),
        size: t('panels:simulatorSegments.faces', {
          defaultValue_one: '{{count}} face',
          defaultValue_other: '{{count}} faces',
          count: segment.faceIndices.length,
        }),
      })),
    [fold, segments, t]
  );

  return (
    <aside
      className="segments-sidebar"
      aria-label={t('panels:simulatorSegments.creasePatterns', 'Crease patterns')}
    >
      <div className="segments-sidebar__header">
        <Shapes size={14} />
        <span className="panel-title">{t('panels:simulatorSegments.patterns', 'Patterns')}</span>
        <span className="segments-sidebar__count">{segments.length}</span>
      </div>
      <SheetGrid
        sheets={items}
        selected={selected}
        onSelect={onSelect}
        className="segments-sidebar__sheets"
      />
    </aside>
  );
});
