import { BoxSelect, CircleDashed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Button } from '../ui/Button';
import { BpPackingPanel } from './BpPackingPanel';

export function BpEditorPanel() {
  const { t } = useTranslation();
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
          <span className="panel-title">{t('panels:bpEditor.title', 'BP Editor')}</span>
        </div>
        <div className="panel-body document-mode-empty">
          <div className="document-mode-empty__icon" aria-hidden="true">
            <BoxSelect size={24} />
          </div>
          <span className="document-mode-empty__message">
            {t('panels:bpEditor.emptyProject', 'Open a Box Pleat project to edit flaps and rivers.')}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void createOristudioBpProject()}
          >
            {t('panels:bpEditor.newBoxPleat', 'New Box Pleat')}
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
          <span className="panel-title">{t('panels:bpEditor.title', 'BP Editor')}</span>
        </div>
        <div className="panel-body document-mode-empty">
          <div className="document-mode-empty__icon" aria-hidden="true">
            <CircleDashed size={24} />
          </div>
          <span className="document-mode-empty__message">
            {t('panels:bpEditor.emptyPacking', 'Run Optimize Layout or materialize a packing before manual BP editing.')}
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
