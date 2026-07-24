import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { FileDown, ImageDown, Origami, Play } from 'lucide-react';
import { FloatingToolbar } from '../components/ui/FloatingToolbar';
import { IconButton } from '../components/ui/IconButton';
import { useCanvasObjectAnchor } from './canvasObjects/useCanvasObjectAnchor';
import type { AnnotationBox } from './annotations/annotationTransform';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { cpLineSelectionBounds, selectedCpLineSegments } from '../lib/creasePatternClipboard';
import { resolveSelectedSegment } from '../lib/creasePatternSelectionSegment';
import { SEGMENT_EXPORT_FORMATS, type SegmentExportFormat } from '../lib/creaseSegmentExport';

// Delay before pulling fold artifacts for a fresh selection. Segmentation needs a
// CP→FOLD export + triangulation, so it must stay off the edit hot path; a short
// settle keeps it from firing on every keystroke of a marquee drag.
const ENSURE_ARTIFACTS_DELAY_MS = 200;

// Literal keys so the i18n extractor can see them (see apps/web/CLAUDE.md).
function exportFormatLabel(format: SegmentExportFormat, t: TFunction): string {
  switch (format) {
    case 'cp':
      return t('panels:creasePattern.selectionToolbar.exportCp', 'CP');
    case 'fold':
      return t('panels:creasePattern.selectionToolbar.exportFold', 'FOLD');
    case 'ori':
      return t('panels:creasePattern.selectionToolbar.exportOri', 'ORI');
    case 'orh':
      return t('panels:creasePattern.selectionToolbar.exportOrh', 'ORH');
    case 'svg':
      return t('panels:creasePattern.selectionToolbar.exportSvg', 'SVG image');
    case 'png':
      return t('panels:creasePattern.selectionToolbar.exportPng', 'PNG image');
  }
}

function ExportMenu({
  onExport,
  label,
}: {
  onExport: (format: SegmentExportFormat) => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {/* No `title`: an IconButton with a title wraps itself in a Tooltip
            trigger, which cannot also be a Radix `asChild` trigger. */}
        <IconButton size="sm" variant="toolbar" aria-label={label}>
          <FileDown size={14} />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="context-menu"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          loop
        >
          {SEGMENT_EXPORT_FORMATS.map((meta) => (
            <DropdownMenu.Item
              key={meta.format}
              className="context-menu__item"
              onSelect={() => onExport(meta.format)}
            >
              <span className="context-menu__label">{exportFormatLabel(meta.format, t)}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Floating actions for a crease selection that forms one complete, border-enclosed
 * sub-pattern: fold, export (all per-region formats), save-to-image, and simulate.
 * Hovers above the selection via {@link FloatingToolbar}, mirroring
 * {@link CpImageInspector}. Renders nothing unless the current selection resolves
 * to exactly one segment (see {@link resolveSelectedSegment}).
 */
export function CpSelectionToolbar({ container }: { container: HTMLElement | null }) {
  const { t } = useTranslation();
  const selection = useWorkspaceStore((s) => s.oristudioCpSelection);
  const cpDocument = useWorkspaceStore((s) => s.oristudioCpDocument?.document ?? null);
  const foldArtifacts = useWorkspaceStore((s) => s.foldArtifacts);
  const ensureFoldArtifacts = useWorkspaceStore((s) => s.ensureFoldArtifacts);
  const foldOristudioCpDocument = useWorkspaceStore((s) => s.foldOristudioCpDocument);
  const exportSegment = useWorkspaceStore((s) => s.exportOristudioCpSegment);
  const simulateSegment = useWorkspaceStore((s) => s.simulateOristudioCpSegment);

  // Only a line selection can form a segment. Ensure artifacts lazily (debounced)
  // when one exists and none are cached — never forcing a recompute.
  const hasLineSelection = selection.lines.length > 0;
  useEffect(() => {
    if (!hasLineSelection || foldArtifacts) return undefined;
    const timer = window.setTimeout(() => {
      void ensureFoldArtifacts();
    }, ENSURE_ARTIFACTS_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hasLineSelection, foldArtifacts, ensureFoldArtifacts]);

  const match = useMemo(
    () => resolveSelectedSegment(cpDocument, selection, foldArtifacts),
    [cpDocument, selection, foldArtifacts]
  );

  const box: AnnotationBox | null = useMemo(() => {
    if (!match) return null;
    const bounds = cpLineSelectionBounds(selectedCpLineSegments(cpDocument, selection));
    if (!bounds) return null;
    return { center: bounds.center, width: bounds.width, height: bounds.height, rotation: 0 };
  }, [match, cpDocument, selection]);

  // Subscribed in this small component (not the panel) so the toolbar tracks the
  // camera live; see useCanvasObjectAnchor.
  const anchorRect = useCanvasObjectAnchor(box, 'model', container);
  if (!match) return null;

  return (
    <FloatingToolbar
      anchorRect={anchorRect}
      className="cp-selection-toolbar"
      ariaLabel={t('panels:creasePattern.selectionToolbar.label', 'Crease pattern actions')}
    >
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:creasePattern.selectionToolbar.fold', 'Fold')}
        onClick={() => void foldOristudioCpDocument({ lineIds: match.cpLineIds })}
      >
        <Origami size={14} />
      </IconButton>
      <ExportMenu
        label={t('panels:creasePattern.selectionToolbar.export', 'Export…')}
        onExport={(format) => void exportSegment(format, match.segmentId)}
      />
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:creasePattern.selectionToolbar.saveImage', 'Save to image')}
        onClick={() => void exportSegment('png', match.segmentId)}
      >
        <ImageDown size={14} />
      </IconButton>
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:creasePattern.selectionToolbar.simulate', 'Simulate')}
        onClick={() => simulateSegment(match.segmentId)}
      >
        <Play size={14} />
      </IconButton>
    </FloatingToolbar>
  );
}
