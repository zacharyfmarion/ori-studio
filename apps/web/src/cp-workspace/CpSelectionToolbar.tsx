import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { FileDown, ImageDown, Link2, Origami, Play, PictureInPicture2 } from 'lucide-react';
import { FloatingToolbar } from '../components/ui/FloatingToolbar';
import { resolveCpViewportCanvas } from './cpViewportCanvas';
import { IconButton } from '../components/ui/IconButton';
import { MenuIconButton } from '../components/ui/MenuIconButton';
import { useCanvasObjectAnchor } from './canvasObjects/useCanvasObjectAnchor';
import { useSimulateSelection } from './inlineSimulation/useSimulateSelection';
import type { AnnotationBox } from './annotations/annotationTransform';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { cpLineSelectionBounds, selectedCpLineSegments } from '../lib/creasePatternClipboard';
import { resolveSelectedSegment } from '../lib/creasePatternSelectionSegment';
import { SEGMENT_EXPORT_FORMATS, type SegmentExportFormat } from '../lib/creaseSegmentExport';
import {
  ensureCpSegmentationArtifacts,
  peekCpSegmentationArtifacts,
} from './cpSegmentationArtifacts';
// Registers `__cpToolbarDebug()` in dev builds; no-op in production.
import { toolbarRenderProbe } from './cpSelectionToolbarDebug';
import { isShareEnabled } from './share/cpShareService';
import { getRuntimeSurface } from '../platform/runtime';

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
      <MenuIconButton label={label} icon={<FileDown size={14} />} />
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
  const foldOristudioCpDocument = useWorkspaceStore((s) => s.foldOristudioCpDocument);
  const exportSegment = useWorkspaceStore((s) => s.exportOristudioCpSegment);
  const simulateSegment = useWorkspaceStore((s) => s.simulateOristudioCpSegment);
  const shareSegment = useWorkspaceStore((s) => s.shareOristudioCpSegment);
  // Web-only, and off in dev unless opted in: a dev build points at the production share
  // API unless VITE_SHARE_API_URL says otherwise, and Tauri has no address bar for a
  // link to land in.
  const shareEnabled = isShareEnabled(getRuntimeSurface() === 'desktop');
  const clearSelection = useWorkspaceStore((s) => s.clearOristudioCpSelection);
  const simulateSelectionInline = useSimulateSelection();

  // Segments-only artifacts (no simulation mesh — see ensureCpSegmentationArtifacts).
  // Read from the module cache rather than held in state: segmentation takes ~1s on
  // a large document, and this component is unmounted and remounted as tools change,
  // so state-held results were discarded and refetched indefinitely. The cache is
  // keyed by a fingerprint of the crease geometry, so it survives both remounts and
  // the snapshot/revision churn that a deselect produces.
  const [, bumpSegmentationVersion] = useState(0);
  const segmentation = peekCpSegmentationArtifacts(cpDocument);
  const hasLineSelection = selection.lines.length > 0;
  useEffect(() => {
    if (!hasLineSelection || !cpDocument || segmentation) return undefined;
    let alive = true;
    // Even if this render is torn down first, the resolved value lands in the
    // cache, so the next render picks it up synchronously.
    void ensureCpSegmentationArtifacts(cpDocument).then(() => {
      if (alive) bumpSegmentationVersion((version) => version + 1);
    });
    return () => {
      alive = false;
    };
  }, [hasLineSelection, cpDocument, segmentation]);

  const match = useMemo(
    () => resolveSelectedSegment(cpDocument, selection, segmentation),
    [cpDocument, selection, segmentation],
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

  useEffect(() => {
    toolbarRenderProbe.renders += 1;
    toolbarRenderProbe.hasMatch = match !== null;
    toolbarRenderProbe.hasContainer = container !== null;
    toolbarRenderProbe.hasBox = box !== null;
    toolbarRenderProbe.hasAnchorRect = anchorRect !== null;
    toolbarRenderProbe.hasSegmentation = segmentation !== null;
  });

  if (!match) return null;

  // Every action dismisses the toolbar by clearing the selection: acting on a
  // selection is the end of that selection, and the pill otherwise lingers over
  // the surface with nothing left to do. (It used to *have* to go — at
  // `--z-portaled-popover` it drew over the export modal it had just opened.
  // That is fixed at the tier now, so this is behaviour, not a workaround.)
  // Actions capture their segment id / line ids up front, so clearing the live
  // selection cannot affect the operation in flight.
  const { segmentId, cpLineIds } = match;
  const runAndDismiss = (action: () => void) => {
    action();
    clearSelection();
  };

  return (
    <FloatingToolbar
      anchorRect={anchorRect}
      boundary={container}
      wheelTarget={resolveCpViewportCanvas}
      className="cp-selection-toolbar"
      ariaLabel={t('panels:creasePattern.selectionToolbar.label', 'Crease pattern actions')}
    >
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:creasePattern.selectionToolbar.fold', 'Fold')}
        onClick={() => runAndDismiss(() => void foldOristudioCpDocument({ lineIds: cpLineIds }))}
      >
        <Origami size={14} />
      </IconButton>
      <ExportMenu
        label={t('panels:creasePattern.selectionToolbar.export', 'Export…')}
        onExport={(format) => runAndDismiss(() => void exportSegment(format, segmentId))}
      />
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:creasePattern.selectionToolbar.saveImage', 'Save to image')}
        onClick={() => runAndDismiss(() => void exportSegment('png', segmentId))}
      >
        <ImageDown size={14} />
      </IconButton>
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:creasePattern.selectionToolbar.simulateInline', 'Simulate inline')}
        onClick={() => runAndDismiss(() => void simulateSelectionInline())}
      >
        <PictureInPicture2 size={14} />
      </IconButton>
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:creasePattern.selectionToolbar.simulate', 'Simulate')}
        onClick={() => runAndDismiss(() => void simulateSegment(segmentId))}
      >
        <Play size={14} />
      </IconButton>
      {shareEnabled && (
        <IconButton
          size="sm"
          variant="toolbar"
          title={t('panels:creasePattern.selectionToolbar.share', 'Create shareable link')}
          onClick={() => runAndDismiss(() => void shareSegment(segmentId))}
        >
          <Link2 size={14} />
        </IconButton>
      )}
    </FloatingToolbar>
  );
}
