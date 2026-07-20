import { BoxSelect, CircleDashed } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Button } from '../ui/Button';
import { SurfaceLoading } from '../ui/SurfaceLoading';
import { BpPackingPanel } from './BpPackingPanel';

export function BpEditorPanel() {
  const workflowTarget = useWorkspaceStore((state) => state.workflowTarget);
  const document = useWorkspaceStore((state) => state.oristudioBpDocument);
  const oristudioBpError = useWorkspaceStore((state) => state.oristudioBpError);
  const createOristudioBpProject = useWorkspaceStore((state) => state.createOristudioBpProject);
  const setOristudioBpActiveSurface = useWorkspaceStore(
    (state) => state.setOristudioBpActiveSurface
  );

  // Box-pleat chosen but the BP worker hasn't produced the document yet: show a
  // loading state (gated on the BP worker) rather than the "open a project"
  // affordance, which only applies once we know there's no project incoming.
  if (workflowTarget === 'box-pleat' && !document && !oristudioBpError) {
    return (
      <section className="panel-shell bp-editor-panel">
        <div className="panel-toolbar">
          <span className="panel-title">BP Editor</span>
        </div>
        <SurfaceLoading label="Preparing the box-pleat editor…" />
      </section>
    );
  }

  if (workflowTarget !== 'box-pleat' || !document) {
    return (
      <section className="panel-shell bp-editor-panel">
        <div className="panel-toolbar">
          <span className="panel-title">BP Editor</span>
        </div>
        <div className="panel-body document-mode-empty">
          <div className="document-mode-empty__icon" aria-hidden="true">
            <BoxSelect size={24} />
          </div>
          <span className="document-mode-empty__message">
            Open a Box Pleat project to edit flaps and rivers.
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void createOristudioBpProject()}
          >
            New Box Pleat
          </Button>
        </div>
      </section>
    );
  }

  const flapCount = document.snapshot.packing.flaps.length;
  if (flapCount === 0) {
    return (
      <section
        className="panel-shell bp-editor-panel"
        onPointerDown={() => setOristudioBpActiveSurface('packing')}
      >
        <div className="panel-toolbar">
          <span className="panel-title">BP Editor</span>
        </div>
        <div className="panel-body document-mode-empty">
          <div className="document-mode-empty__icon" aria-hidden="true">
            <CircleDashed size={24} />
          </div>
          <span className="document-mode-empty__message">
            Run Optimize Layout or materialize a packing before manual BP editing.
          </span>
        </div>
      </section>
    );
  }

  // Wrap in a panel-shell so the packing body (flex: 1) fills the pane height,
  // matching the empty states above and the design (tree) pane.
  return (
    <section className="panel-shell bp-editor-panel">
      <BpPackingPanel document={document} />
    </section>
  );
}
