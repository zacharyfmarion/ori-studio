import { BoxSelect, CircleDashed } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Button } from '../ui/Button';
import { BpPackingPanel } from './BpPackingPanel';

export function BpEditorPanel() {
  const workflowTarget = useWorkspaceStore((state) => state.workflowTarget);
  const document = useWorkspaceStore((state) => state.oristudioBpDocument);
  const createOristudioBpProject = useWorkspaceStore((state) => state.createOristudioBpProject);
  const setOristudioBpActiveSurface = useWorkspaceStore(
    (state) => state.setOristudioBpActiveSurface
  );

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

  return <BpPackingPanel document={document} />;
}
