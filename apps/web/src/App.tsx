import { useCallback, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';
import { CommandDialogModal } from './components/CommandDialogModal';
import { CpDetectImportModal } from './components/CpDetectImportModal';
import { GlobalToasts } from './components/GlobalToasts';
import { HelpModal } from './components/HelpModal';
import { SelectByIndexModal } from './components/SelectByIndexModal';
import { SettingsModal } from './components/SettingsModal';
import { TooltipProvider } from './components/ui/Tooltip';
import { handleMenuAction } from './commands/menuActions';
import { registerStartScreenRequestHandler } from './commands/startScreenController';
import { useTauriOpenedFiles } from './hooks/useTauriOpenedFiles';
import { installAppKeyboardListener } from './lib/appKeyboard';
import { cpSelectionSize } from './lib/creasePatternViewport';
import { useTauriMenuListener } from './menus/tauriMenuListener';
import { createOpenedPathFileService } from './platform/fileService';
import { getRuntimeSurface } from './platform/runtime';
import { applyWindowTitle, formatWindowTitle } from './platform/windowTitle';
import { navigateTo } from './routing/appRouter';
import { openedProjectPath } from './routing/landing';
import { WELCOME_PATH } from './routing/paths';
import { startWorkspaceUrlSync } from './routing/workspaceUrlSync';
import { requestConfirmation } from './store/commandDialogStore';
import { useLayoutStore } from './store/layoutStore';
import { useShortcutStore } from './store/shortcutStore';
import { useThemeStore } from './store/themeStore';
import { useWorkspaceStore } from './store/workspaceStore';
import './styles/sonner.css';

/**
 * Root layout route. Owns app-wide lifecycle (engine init, window title, close
 * guards, global keyboard, workspace↔URL sync) and the always-mounted overlays,
 * and renders the active route (`/welcome` or a workspace) into the outlet.
 */
export default function App() {
  const initEngine = useWorkspaceStore((state) => state.initEngine);
  const openProject = useWorkspaceStore((state) => state.openProject);
  const selectNone = useWorkspaceStore((state) => state.selectNone);
  const project = useWorkspaceStore((state) => state.project);
  const dirty = useWorkspaceStore((state) => state.dirty);
  const engineReady = useWorkspaceStore((state) => state.engineReady);
  const toasterTheme = useThemeStore((state) => state.currentTheme.type);

  const showStartScreen = useCallback(async () => {
    const state = useWorkspaceStore.getState();
    if (state.dirty) {
      const confirmed = await requestConfirmation({
        title: 'Discard unsaved changes?',
        message:
          'Your current project has unsaved changes. Return to the start screen and discard them?',
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
    navigateTo(WELCOME_PATH);
    return true;
  }, []);

  useEffect(() => registerStartScreenRequestHandler(showStartScreen), [showStartScreen]);

  useEffect(() => startWorkspaceUrlSync(), []);

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
        getActiveEditingContext: () => useWorkspaceStore.getState().activeEditingContext,
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

  const handleOpenedFilePath = useCallback(
    async (path: string) => {
      const opened = await openProject(createOpenedPathFileService(path));
      if (!opened) return;
      navigateTo(openedProjectPath());
    },
    [openProject]
  );

  useTauriOpenedFiles(engineReady, handleOpenedFilePath);

  return (
    <TooltipProvider>
      <Outlet />
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
