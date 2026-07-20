import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Shapes } from 'lucide-react';
import {
  segmentFoldDocument,
  segmentThumbnailSvg,
  type CpSegment,
} from '../../lib/creasePatternSegmentation';
import { useWorkspaceStore } from '../../store/workspaceStore';

/**
 * Fixed, non-draggable sidebar rendered inside the simulator panel. Lists the
 * document's crease-pattern segments as flat 2D thumbnails and drives the
 * selected segment.
 */
export function SimulatorSegmentsSidebar() {
  const { t } = useTranslation();
  const foldArtifacts = useWorkspaceStore((state) => state.foldArtifacts);
  const selectedSegmentId = useWorkspaceStore((state) => state.selectedSegmentId);
  const setSelectedSegment = useWorkspaceStore((state) => state.setSelectedSegment);

  // Thumbnails use the real (untriangulated) crease fold, not the simulation
  // mesh, so they show the actual crease pattern. Segment ids match the
  // simulator's (both segment the same topology deterministically), so
  // selection still drives the simulator correctly.
  const fold = foldArtifacts?.fold ?? null;
  const segments = useMemo(() => (fold ? segmentFoldDocument(fold) : []), [fold]);
  const activeId = segments.some((segment) => segment.id === selectedSegmentId)
    ? selectedSegmentId
    : (segments[0]?.id ?? null);

  const thumbnails = useMemo(() => {
    if (!fold) return new Map<number, string>();
    const entries = new Map<number, string>();
    for (const segment of segments) {
      entries.set(segment.id, segmentThumbnailSvg(fold, segment, { size: 96 }));
    }
    return entries;
  }, [fold, segments]);

  // A single pattern needs no picker; hide the sidebar to reclaim the space.
  if (segments.length <= 1) return null;

  return (
    <aside className="segments-sidebar" aria-label={t('panels:simulatorSegments.creasePatterns', 'Crease patterns')}>
      <div className="segments-sidebar__header">
        <Shapes size={14} />
        <span className="panel-title">{t('panels:simulatorSegments.patterns', 'Patterns')}</span>
        <span className="segments-sidebar__count">{segments.length}</span>
      </div>
      <ul
        className="segments-list"
        role="listbox"
        aria-label={t('panels:simulatorSegments.creasePatterns', 'Crease patterns')}
      >
        {segments.map((segment, index) => (
          <SegmentThumbnail
            key={segment.id}
            segment={segment}
            index={index}
            svg={thumbnails.get(segment.id) ?? ''}
            selected={segment.id === activeId}
            onSelect={() => setSelectedSegment(segment.id)}
          />
        ))}
      </ul>
    </aside>
  );
}

interface SegmentThumbnailProps {
  segment: CpSegment;
  index: number;
  svg: string;
  selected: boolean;
  onSelect: () => void;
}

function SegmentThumbnail({ segment, index, svg, selected, onSelect }: SegmentThumbnailProps) {
  const { t } = useTranslation();
  return (
    <li className="segments-list__item">
      <button
        type="button"
        role="option"
        aria-selected={selected}
        aria-label={t('panels:simulatorSegments.patternLabel', 'Pattern {{n}}', { n: index + 1 })}
        className={`segment-card${selected ? ' segment-card--selected' : ''}`}
        onClick={onSelect}
        title={t('panels:simulatorSegments.patternTitle', 'Pattern {{n}} — {{count}} faces', {
          n: index + 1,
          count: segment.faceIndices.length,
        })}
      >
        {/* Trusted, locally generated SVG string. */}
        <span
          className="segment-card__thumb"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <span className="segment-card__badge" aria-hidden="true">
          {index + 1}
        </span>
      </button>
    </li>
  );
}
