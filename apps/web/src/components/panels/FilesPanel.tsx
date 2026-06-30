import { Download, FileText, FolderOpen, Save } from 'lucide-react';
import { EXAMPLE_PROJECTS } from '../../examples/catalog';
import { handleMenuAction } from '../../commands/menuActions';
import { Button } from '../ui/Button';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useWorkspaceCapabilities } from '../../store/workspaceStore/useWorkspaceCapabilities';

export function FilesPanel() {
  const loadExampleProject = useWorkspaceStore((state) => state.loadExampleProject);
  const loadRecentProject = useWorkspaceStore((state) => state.loadRecentProject);
  const recentProjects = useWorkspaceStore((state) => state.recentProjects);
  const currentFileName = useWorkspaceStore((state) => state.currentFileName);
  const documentMode = useWorkspaceStore((state) => state.documentMode);
  const dirty = useWorkspaceStore((state) => state.dirty);
  const capabilities = useWorkspaceCapabilities();

  return (
    <section className="panel-shell files-panel">
      <div className="panel-toolbar">
        <span className="panel-title">Files</span>
      </div>
      <div className="panel-body files-panel__body">
        <div className="file-actions">
          <Button
            size="sm"
            variant="secondary"
            disabled={!capabilities['file.new'].enabled}
            title={capabilities['file.new'].reason}
            onClick={() => void handleMenuAction('file.new')}
          >
            <FileText size={14} />
            New
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!capabilities['file.open'].enabled}
            title={capabilities['file.open'].reason}
            onClick={() => void handleMenuAction('file.open')}
          >
            <FolderOpen size={14} />
            Open
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!capabilities['file.save'].enabled}
            title={capabilities['file.save'].reason}
            onClick={() => void handleMenuAction('file.save')}
          >
            <Save size={14} />
            Save
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!capabilities['file.saveAs'].enabled}
            title={capabilities['file.saveAs'].reason}
            onClick={() => void handleMenuAction('file.saveAs')}
          >
            <Save size={14} />
            Save As
          </Button>
        </div>

        <div className="file-summary">
          <span>{currentFileName}</span>
          <span>
            {dirty
              ? 'Unsaved changes'
              : documentMode === 'crease-pattern'
                ? 'Editable CP project'
                : 'Saved'}
          </span>
        </div>

        <div className="file-actions file-actions--exports">
          <Button
            size="sm"
            variant="secondary"
            disabled={!capabilities['file.exportV5'].enabled}
            title={capabilities['file.exportV5'].reason}
            onClick={() => void handleMenuAction('file.exportV5')}
          >
            <Download size={14} />
            TMD5
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!capabilities['file.exportV4'].enabled}
            title={capabilities['file.exportV4'].reason}
            onClick={() => void handleMenuAction('file.exportV4')}
          >
            <Download size={14} />
            V4
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!capabilities['file.exportCp'].enabled}
            title={capabilities['file.exportCp'].reason}
            onClick={() => void handleMenuAction('file.exportCp')}
          >
            <Download size={14} />
            CP
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!capabilities['file.exportFold'].enabled}
            title={capabilities['file.exportFold'].reason}
            onClick={() => void handleMenuAction('file.exportFold')}
          >
            <Download size={14} />
            FOLD
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!capabilities['file.exportOri'].enabled}
            title={capabilities['file.exportOri'].reason}
            onClick={() => void handleMenuAction('file.exportOri')}
          >
            <Download size={14} />
            ORI
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!capabilities['file.exportSvg'].enabled}
            title={capabilities['file.exportSvg'].reason}
            onClick={() => void handleMenuAction('file.exportSvg')}
          >
            <Download size={14} />
            SVG
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!capabilities['file.exportPng'].enabled}
            title={capabilities['file.exportPng'].reason}
            onClick={() => void handleMenuAction('file.exportPng')}
          >
            <Download size={14} />
            PNG
          </Button>
        </div>

        <SectionTitle>Examples</SectionTitle>
        <div className="example-list">
          {EXAMPLE_PROJECTS.map((example) => (
            <button
              key={example.id}
              type="button"
              className="example-item"
              onClick={() => void loadExampleProject(example.id)}
            >
              <span className="example-item__title">{example.title}</span>
              <span className="example-item__meta">{example.meta}</span>
            </button>
          ))}
        </div>

        {recentProjects.length > 0 && (
          <>
            <SectionTitle>Recent</SectionTitle>
            <div className="example-list">
              {recentProjects.map((recent) => (
                <button
                  key={`${recent.id}-${recent.savedAt}`}
                  type="button"
                  className="example-item"
                  onClick={() => void loadRecentProject(recent.id)}
                >
                  <span className="example-item__title">{recent.title}</span>
                  <span className="example-item__meta">
                    {recent.filename} | {new Date(recent.savedAt).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <div className="files-panel__section-title">{children}</div>;
}
