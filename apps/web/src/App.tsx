import { useCallback, useEffect, useState } from 'react';
import { DockviewDefaultTab, DockviewReact } from 'dockview';
import type { DockviewReadyEvent, IDockviewPanelHeaderProps } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { Toaster } from 'sonner';
import {
  Download,
  Box,
  DraftingCompass,
  FilePlus,
  FolderOpen,
  CircleHelp,
  PenTool,
  Save,
  Settings,
  Sparkles,
  Play,
} from 'lucide-react';
import { MenuBar } from './components/MenuBar';
import { CommandDialogModal } from './components/CommandDialogModal';
import { CpDetectImportModal } from './components/CpDetectImportModal';
import { GlobalToasts } from './components/GlobalToasts';
import { HelpModal } from './components/HelpModal';
import { SelectByIndexModal } from './components/SelectByIndexModal';
import { SettingsModal } from './components/SettingsModal';
import { StartScreen } from './components/StartScreen';
import { TooltipProvider } from './components/ui/Tooltip';
import { IconButton } from './components/ui/IconButton';
import { Button } from './components/ui/Button';
import { panelComponents } from './components/panels/PanelComponents';
import { handleMenuAction } from './commands/menuActions';
import { registerStartScreenRequestHandler } from './commands/startScreenController';
import { useMacDownloadUrl } from './hooks/useMacDownloadUrl';
import { useTauriOpenedFiles } from './hooks/useTauriOpenedFiles';
import { installAppKeyboardListener } from './lib/appKeyboard';
import { cpSelectionSize } from './lib/creasePatternViewport';
import { useTauriMenuListener } from './menus/tauriMenuListener';
import { isFeatureVisible } from './platform/features';
import { createOpenedPathFileService } from './platform/fileService';
import { getRuntimeSurface } from './platform/runtime';
import { applyWindowTitle, formatWindowTitle } from './platform/windowTitle';
import { requestConfirmation } from './store/commandDialogStore';
import { applyDefaultLayout, useLayoutStore } from './store/layoutStore';
import { useSettingsStore } from './store/settingsStore';
import { useShortcutStore } from './store/shortcutStore';
import { useThemeStore } from './store/themeStore';
import { useWorkspaceStore } from './store/workspaceStore';
import { useWorkspaceCapabilities } from './store/workspaceStore/useWorkspaceCapabilities';
import {
  WORKSPACE_DEFINITIONS,
  workspaceForPanelId,
  type WorkspaceId,
} from './workspaces/workspaces';
import './styles/sonner.css';

const workspaceIcons: Record<WorkspaceId, typeof DraftingCompass> = {
  design: DraftingCompass,
  edit: PenTool,
  simulate: Box,
};

function WorkspaceRail() {
  const activeWorkspace = useLayoutStore((state) => state.activeWorkspace);

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
              onClick={() => void handleMenuAction(workspace.commandId)}
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
            title={buildCp.reason}
            onClick={() => void handleMenuAction('cp.build')}
          >
            <Play size={14} />
            {buildCp.label}
          </Button>
        )}
        {(optimizeScale.visible || buildCp.visible) && <span className="toolbar__separator" />}
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

export default function App() {
  const initEngine = useWorkspaceStore((state) => state.initEngine);
  const createNewCreasePattern = useWorkspaceStore((state) => state.createNewCreasePattern);
  const openProject = useWorkspaceStore((state) => state.openProject);
  const selectNone = useWorkspaceStore((state) => state.selectNone);
  const project = useWorkspaceStore((state) => state.project);
  const dirty = useWorkspaceStore((state) => state.dirty);
  const status = useWorkspaceStore((state) => state.status);
  const engineReady = useWorkspaceStore((state) => state.engineReady);
  const error = useWorkspaceStore((state) => state.error);
  const toasterTheme = useThemeStore((state) => state.currentTheme.type);
  const setDockviewApi = useLayoutStore((state) => state.setDockviewApi);
  const activeWorkspace = useLayoutStore((state) => state.activeWorkspace);
  const loadLayout = useLayoutStore((state) => state.loadLayout);
  const saveLayout = useLayoutStore((state) => state.saveLayout);
  const [workspaceStarted, setWorkspaceStarted] = useState(false);
  const [workspaceInitialPanel, setWorkspaceInitialPanel] = useState<string | null>(null);

  const showStartScreen = useCallback(async () => {
    const state = useWorkspaceStore.getState();
    if (state.dirty) {
      const confirmed = await requestConfirmation({
        title: 'Discard unsaved changes?',
        message: 'Your current project has unsaved changes. Return to the start screen and discard them?',
        confirmLabel: 'Discard',
        tone: 'danger',
      });
      if (!confirmed) return false;
    }

    useWorkspaceStore.setState({
      dirty: false,
      error: null,
      projectMessage: null,
      status: state.engineReady ? 'ready' : 'loading_engine',
    });
    useLayoutStore.getState().setActiveWorkspace('design');
    setWorkspaceInitialPanel(null);
    setWorkspaceStarted(false);
    return true;
  }, []);

  useEffect(() => registerStartScreenRequestHandler(showStartScreen), [showStartScreen]);

  useTauriMenuListener();

  useEffect(() => {
    void initEngine();
  }, [initEngine]);

  useEffect(() => {
    const title = formatWindowTitle({ projectTitle: project.title, dirty });
    void applyWindowTitle(title);
  }, [dirty, project.title]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!useWorkspaceStore.getState().dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    if (getRuntimeSurface() !== 'desktop') return undefined;
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        return appWindow.onCloseRequested((event) => {
          if (!useWorkspaceStore.getState().dirty) return;
          event.preventDefault();
          void requestConfirmation({
            title: 'Discard unsaved changes?',
            message: 'Your current project has unsaved changes. Close Ori Studio and discard them?',
            confirmLabel: 'Discard',
            tone: 'danger',
          }).then((confirmed) => {
            if (confirmed) void appWindow.destroy();
          });
        });
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch((error) => {
        console.warn('Failed to register Tauri close guard', error);
      });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    return installAppKeyboardListener(
      {
        getDocumentMode: () => useWorkspaceStore.getState().documentMode,
        getActiveEditingSurface: () => useWorkspaceStore.getState().activeEditingSurface,
        getCpSelectionSize: () =>
          cpSelectionSize(useWorkspaceStore.getState().oristudioCpSelection),
        getSelection: () => useWorkspaceStore.getState().selection,
        handleMenuAction,
        selectNone,
        getShortcutOverrides: () => useShortcutStore.getState().overrides,
      },
      document
    );
  }, [selectNone]);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const { api } = event;
      setDockviewApi(api);

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

      if (workspaceInitialPanel) {
        requestAnimationFrame(() => {
          api.getPanel(workspaceInitialPanel)?.api.setActive();
        });
        setWorkspaceInitialPanel(null);
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
    [activeWorkspace, loadLayout, saveLayout, setDockviewApi, workspaceInitialPanel]
  );

  const enterWorkspace = useCallback((panelId: string) => {
    useLayoutStore.getState().setActiveWorkspace(workspaceForPanelId(panelId) ?? 'design');
    setWorkspaceInitialPanel(panelId);
    setWorkspaceStarted(true);
  }, []);

  const handleOpenedFilePath = useCallback(
    async (path: string) => {
      const opened = await openProject(createOpenedPathFileService(path));
      if (!opened) return;
      enterWorkspace(
        useWorkspaceStore.getState().documentMode === 'crease-pattern'
          ? 'crease-pattern'
          : 'design'
      );
    },
    [enterWorkspace, openProject]
  );

  useTauriOpenedFiles(engineReady, handleOpenedFilePath);

  const handleCreateCreasePattern = useCallback(async () => {
    await createNewCreasePattern();
    if (useWorkspaceStore.getState().status !== 'error') {
      enterWorkspace('crease-pattern');
    }
  }, [createNewCreasePattern, enterWorkspace]);

  const handleCreateDesign = useCallback(() => {
    // Enter the Design workspace on the method chooser (Circle-packed vs
    // Box-pleated) instead of creating a blank tree up front.
    useWorkspaceStore.getState().startNewDesign();
    enterWorkspace('design');
  }, [enterWorkspace]);

  const handleOpenFile = useCallback(async () => {
    const opened = await openProject();
    if (!opened) return;
    enterWorkspace(
      useWorkspaceStore.getState().documentMode === 'crease-pattern' ? 'crease-pattern' : 'design'
    );
  }, [enterWorkspace, openProject]);

  return (
    <TooltipProvider>
      <div className={workspaceStarted ? 'app-layout' : 'app-layout app-layout--start'}>
        {workspaceStarted ? (
          <>
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
          </>
        ) : (
          <StartScreen
            status={status}
            errorMessage={error?.message ?? null}
            onCreateCreasePattern={() => void handleCreateCreasePattern()}
            onCreateDesign={() => void handleCreateDesign()}
            onOpenFile={() => void handleOpenFile()}
          />
        )}
      </div>
      <HelpModal />
      <SelectByIndexModal />
      <CpDetectImportModal />
      <SettingsModal />
      <CommandDialogModal />
      <GlobalToasts />
      <Toaster
        theme={toasterTheme}
        position="bottom-right"
        closeButton
        richColors
        visibleToasts={5}
        toastOptions={{ duration: 4000 }}
      />
    </TooltipProvider>
  );
}
