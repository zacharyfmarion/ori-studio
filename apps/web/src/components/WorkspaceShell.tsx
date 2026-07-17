import { useCallback, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { DockviewDefaultTab, DockviewReact } from 'dockview';
import type { DockviewReadyEvent, IDockviewPanelHeaderProps } from 'dockview';
import {
  Box,
  CircleHelp,
  DraftingCompass,
  Download,
  FilePlus,
  FolderOpen,
  Loader2,
  PenTool,
  Save,
  ScanLine,
  Settings,
  Sparkles,
} from 'lucide-react';
import { MenuBar } from './MenuBar';
import { panelComponents } from './panels/PanelComponents';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { handleMenuAction } from '../commands/menuActions';
import { useMacDownloadUrl } from '../hooks/useMacDownloadUrl';
import { isFeatureVisible } from '../platform/features';
import { getRuntimeSurface } from '../platform/runtime';
import { applyDefaultLayout, useLayoutStore } from '../store/layoutStore';
import { useSettingsStore } from '../store/settingsStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { deriveDesignVariant } from '../store/workspaceStore/designVariant';
import { useWorkspaceCapabilities } from '../store/workspaceStore/useWorkspaceCapabilities';
import { workspacePath } from '../routing/paths';
import { WORKSPACE_DEFINITIONS, type WorkspaceId } from '../workspaces/workspaces';

const workspaceIcons: Record<WorkspaceId, typeof DraftingCompass> = {
  design: DraftingCompass,
  edit: PenTool,
  simulate: Box,
};

/**
 * Path a rail button navigates to. Design targets its active variant sub-route
 * (so an in-progress design isn't bounced back to the method chooser); other
 * workspaces have a single path.
 */
function railPath(workspace: WorkspaceId): string {
  if (workspace === 'design') {
    return workspacePath('design', deriveDesignVariant(useWorkspaceStore.getState()));
  }
  return workspacePath(workspace);
}

function WorkspaceRail() {
  const activeWorkspace = useLayoutStore((state) => state.activeWorkspace);
  const navigate = useNavigate();

  return (
    <aside className="workspace-rail" aria-label="Workspaces">
      <div className="workspace-rail__items">
        {WORKSPACE_DEFINITIONS.map((workspace) => {
          const Icon = workspaceIcons[workspace.id];
          return (
            <IconButton
              key={workspace.id}
              size="lg"
              variant="toolbar"
              className="workspace-rail__button"
              isActive={activeWorkspace === workspace.id}
              title={workspace.tooltip}
              tooltipSide="right"
              aria-label={workspace.tooltip}
              onClick={() => navigate(railPath(workspace.id))}
            >
              <Icon size={19} />
            </IconButton>
          );
        })}
      </div>
    </aside>
  );
}

function Toolbar() {
  const openSettings = useSettingsStore((state) => state.openSettings);
  const capabilities = useWorkspaceCapabilities();
  const runtimeSurface = getRuntimeSurface();
  const isDesktop = runtimeSurface === 'desktop';
  const showDownloadCta = isFeatureVisible('macDownloadCta', runtimeSurface);
  const downloadUrl = useMacDownloadUrl();
  const optimizeScale = capabilities['optimize.scale'];
  const buildCp = capabilities['cp.build'];
  const activeContext = useWorkspaceStore((state) => state.activeEditingContext);
  const sendBpToEdit = useWorkspaceStore((state) => state.sendOristudioBpToEdit);
  const sendTreeToEdit = useWorkspaceStore((state) => state.sendTreeCreasePatternToEdit);
  const hasBpDocument = useWorkspaceStore((state) => state.oristudioBpDocument !== null);
  const bpBusy = useWorkspaceStore((state) => state.oristudioBpBusy);
  // In a BP design the top action sends the design's crease pattern to the Edit
  // canvas (Import(Add) merge), in place of TreeMaker's Optimize/Build.
  const isBpContext = activeContext === 'bp-tree' || activeContext === 'bp-packing';

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        {isDesktop ? <span className="toolbar__title">Ori Studio</span> : <MenuBar />}
      </div>
      <div className="toolbar__actions">
        <IconButton
          size="sm"
          title="New"
          tooltipSide="bottom"
          disabled={!capabilities['file.new'].enabled}
          onClick={() => void handleMenuAction('file.new')}
        >
          <FilePlus size={15} />
        </IconButton>
        <IconButton
          size="sm"
          title="Open"
          tooltipSide="bottom"
          disabled={!capabilities['file.open'].enabled}
          onClick={() => void handleMenuAction('file.open')}
        >
          <FolderOpen size={15} />
        </IconButton>
        <IconButton
          size="sm"
          title="Save"
          tooltipSide="bottom"
          disabled={!capabilities['file.save'].enabled}
          onClick={() => void handleMenuAction('file.save')}
        >
          <Save size={15} />
        </IconButton>
        <span className="toolbar__separator" />
        {optimizeScale.visible && (
          <Button
            size="sm"
            variant={buildCp.enabled ? 'secondary' : 'primary'}
            disabled={!optimizeScale.enabled}
            title={optimizeScale.reason}
            onClick={() => void handleMenuAction('optimize.scale')}
          >
            <Sparkles size={14} />
            Optimize Scale
          </Button>
        )}
        {buildCp.visible && (
          <Button
            size="sm"
            variant={buildCp.enabled ? 'primary' : 'secondary'}
            disabled={!buildCp.enabled}
            title={
              buildCp.enabled
                ? "Send this design's crease pattern to the Edit canvas"
                : buildCp.reason
            }
            onClick={() => void sendTreeToEdit()}
          >
            <ScanLine size={14} />
            Send to Edit
          </Button>
        )}
        {isBpContext && (
          <Button
            size="sm"
            variant="primary"
            disabled={!hasBpDocument || bpBusy}
            title="Send this design's crease pattern to the Edit canvas"
            onClick={() => void sendBpToEdit()}
          >
            <ScanLine size={14} />
            Send to Edit
          </Button>
        )}
        {(optimizeScale.visible || buildCp.visible || isBpContext) && (
          <span className="toolbar__separator" />
        )}
        {showDownloadCta && (
          <IconButton
            size="sm"
            title="Download Ori Studio for Mac"
            tooltipSide="bottom"
            onClick={() => window.open(downloadUrl, '_blank', 'noreferrer')}
          >
            <Download size={15} />
          </IconButton>
        )}
        <IconButton
          size="sm"
          title="Help"
          tooltipSide="bottom"
          onClick={() => void handleMenuAction('help.documentation')}
        >
          <CircleHelp size={15} />
        </IconButton>
        <IconButton size="sm" title="Settings" tooltipSide="bottom" onClick={() => openSettings()}>
          <Settings size={15} />
        </IconButton>
      </div>
    </header>
  );
}

function FixedDockTab(props: IDockviewPanelHeaderProps) {
  return <DockviewDefaultTab {...props} hideClose />;
}

/**
 * The workspace chrome: toolbar, workspace rail, and the shared Dockview canvas.
 * Mounted for every workspace route (`/design`, `/edit`, `/simulate`) and their
 * sub-paths, so the Dockview instance persists across workspace switches. The
 * active workspace route renders into the `<Outlet />` (an invisible sync
 * element) and drives which layout Dockview shows via `activeWorkspace`.
 */
export function WorkspaceShell() {
  const setDockviewApi = useLayoutStore((state) => state.setDockviewApi);
  const loadLayout = useLayoutStore((state) => state.loadLayout);
  const saveLayout = useLayoutStore((state) => state.saveLayout);
  const engineReady = useWorkspaceStore((state) => state.engineReady);

  // Drop the disposed Dockview API when the shell unmounts (e.g. navigating to
  // /welcome) so a later remount doesn't operate on a dead handle.
  useEffect(() => () => setDockviewApi(null), [setDockviewApi]);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const { api } = event;
      setDockviewApi(api);

      const activeWorkspace = useLayoutStore.getState().activeWorkspace;
      let loaded = false;
      const saved = loadLayout(activeWorkspace);
      if (saved) {
        try {
          api.fromJSON(saved);
          loaded = true;
        } catch (error) {
          console.warn('Failed to restore layout', error);
          localStorage.removeItem(`treemaker-web-layout:${activeWorkspace}`);
          localStorage.removeItem(`treemaker-web-layout-version:${activeWorkspace}`);
        }
      }

      if (!loaded) {
        applyDefaultLayout(api, activeWorkspace);
      }

      // The active panel drives the active editing context (menus, history,
      // shortcuts). Seed it and keep it in sync as the user focuses panels.
      const setActivePanelId = useWorkspaceStore.getState().setActivePanelId;
      setActivePanelId(api.activePanel?.id ?? null);
      api.onDidActivePanelChange((panel) => {
        setActivePanelId(panel?.id ?? null);
      });

      let timer: ReturnType<typeof setTimeout> | null = null;
      api.onDidLayoutChange(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => saveLayout(), 250);
      });
    },
    [loadLayout, saveLayout, setDockviewApi]
  );

  return (
    <div className="app-layout">
      <Toolbar />
      <div className="workspace-shell">
        <WorkspaceRail />
        <DockviewReact
          components={panelComponents}
          defaultTabComponent={FixedDockTab}
          onReady={onReady}
          className="dockview-theme-treemaker workspace-shell__dockview"
          disableFloatingGroups
        />
      </div>
      {!engineReady && (
        <div className="workspace-shell__loading" role="status" aria-live="polite">
          <Loader2 size={26} className="workspace-shell__loading-spinner" />
          <span>Preparing the editor…</span>
        </div>
      )}
      <Outlet />
    </div>
  );
}
