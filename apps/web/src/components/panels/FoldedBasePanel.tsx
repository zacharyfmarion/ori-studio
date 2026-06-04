import { useEffect, useState } from 'react';
import { Eye, GitBranch, Layers3 } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { FoldedSurfaceSvg, type FoldedSurfaceViewOptions } from '../folded/FoldedSurfaceSvg';
import { IconButton } from '../ui/IconButton';
import { NextDocumentAction } from './NextDocumentAction';

export function FoldedBasePanel() {
  const creaseCount = useWorkspaceStore((state) => state.project.creases.length);
  const status = useWorkspaceStore((state) => state.status);
  const documentMode = useWorkspaceStore((state) => state.documentMode);
  const editableCpDocument = useWorkspaceStore((state) => state.oristudioCpDocument?.document ?? null);
  const foldArtifacts = useWorkspaceStore((state) => state.foldArtifacts);
  const foldArtifactError = useWorkspaceStore((state) => state.foldArtifactError);
  const foldArtifactStatus = useWorkspaceStore((state) => state.foldArtifactStatus);
  const ensureFoldArtifacts = useWorkspaceStore((state) => state.ensureFoldArtifacts);
  const [viewOptions, setViewOptions] = useState<FoldedSurfaceViewOptions>({
    wireframe: false,
    translucent: false,
  });

  const foldedBase = foldArtifacts?.folded_base ?? null;
  const foldedBaseError = foldArtifacts?.folded_base_error ?? foldArtifactError;

  useEffect(() => {
    const needsTreeArtifacts = documentMode === 'tree' && creaseCount > 0;
    const needsEditableCpArtifacts =
      documentMode === 'crease-pattern' && editableCpDocument !== null;
    if (!needsTreeArtifacts && !needsEditableCpArtifacts) return;
    if (foldArtifactStatus !== 'idle' && foldArtifactStatus !== 'stale') return;
    void ensureFoldArtifacts();
  }, [
    creaseCount,
    documentMode,
    editableCpDocument,
    ensureFoldArtifacts,
    foldArtifactStatus,
  ]);

  const emptyStatus =
    documentMode === 'tree' && creaseCount === 0
      ? status === 'building_crease_pattern'
        ? 'Building crease pattern'
        : 'No crease pattern'
      : foldArtifactStatus === 'loading'
        ? 'Updating folded base'
        : foldedBase
          ? `${foldedBase.vertices.length} vertices | ${foldedBase.facets.length} facets`
          : shortStatus(foldedBaseError ?? 'Folded base unavailable');

  return (
    <section className="panel-shell folded-base-panel">
      <div className="panel-toolbar">
        <div className="panel-toolbar__group">
          <Layers3 size={14} />
          <span className="panel-title">Folded Base</span>
        </div>
        {foldedBase && (
          <div className="panel-toolbar__group">
            <div className="folded-base-view-controls" aria-label="Folded base view options">
              <IconButton
                size="sm"
                variant="toolbar"
                title="Wireframe"
                tooltipSide="bottom"
                isActive={viewOptions.wireframe}
                onClick={() =>
                  setViewOptions((current) => ({
                    ...current,
                    wireframe: !current.wireframe,
                  }))
                }
              >
                <GitBranch size={14} />
              </IconButton>
              <IconButton
                size="sm"
                variant="toolbar"
                title="Translucent Layers"
                tooltipSide="bottom"
                isActive={viewOptions.translucent}
                onClick={() =>
                  setViewOptions((current) => ({
                    ...current,
                    translucent: !current.translucent,
                  }))
                }
              >
                <Eye size={14} />
              </IconButton>
            </div>
          </div>
        )}
      </div>
      <div className="panel-body folded-base-panel__body">
        {foldedBase ? (
          <FoldedSurfaceSvg
            snapshot={foldedBase}
            viewOptions={viewOptions}
            ariaLabel="Folded base"
          />
        ) : (
          <div className="folded-base-panel__empty">
            <span title={foldedBaseError ?? undefined}>{emptyStatus}</span>
            {documentMode === 'tree' && creaseCount === 0 && <NextDocumentAction />}
          </div>
        )}
      </div>
    </section>
  );
}

function shortStatus(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return 'Folded base unavailable';
  const sentence = trimmed.split(/[.;]\s+/u)[0] ?? trimmed;
  return sentence.length > 54 ? `${sentence.slice(0, 51)}...` : sentence;
}
