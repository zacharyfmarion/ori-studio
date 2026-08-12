import { selectSelection } from './store/workspaceStore/designTabs';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useAppOpenedEvent } from './analytics';
import { BpOptimizerModal } from './components/BpOptimizerModal';
import { CommandDialogModal } from './components/CommandDialogModal';
import { CpDetectImportModal } from './components/CpDetectImportModal';
import { GlobalErrorReporter } from './components/errors/GlobalErrorReporter';
import { OverlayErrorBoundary } from './components/errors/OverlayErrorBoundary';
import { GlobalToasts } from './components/GlobalToasts';
import { HelpModal } from './components/HelpModal';
import { SelectByIndexModal } from './components/SelectByIndexModal';
import { ShareLinkModal } from './cp-workspace/share/ShareLinkModal';
import { SettingsModal } from './components/SettingsModal';
import { TooltipProvider } from './components/ui/Tooltip';
import { handleMenuAction } from './commands/menuActions';
import { useTauriOpenedFiles } from './hooks/useTauriOpenedFiles';
import { useWindowTitle } from './hooks/useWindowTitle';
import { installHeldModifierTracker } from './keyboard/heldModifiers';
import { installAppKeyboardListener } from './lib/appKeyboard';
import { registerWorkerFailureSink, workerErrorCode } from './lib/workerDiagnostics';
import { useTauriNativeMenu } from './menus/useTauriNativeMenu';
import { createOpenedPathFileService } from './platform/fileService';
import { isWorkspaceBlocked } from './platform/mobileSurface';
import { getRuntimeSurface } from './platform/runtime';
import { navigateTo } from './routing/appRouter';
import { currentWorkspacePath } from './routing/landing';
import { startWorkspaceUrlSync } from './routing/workspaceUrlSync';
import { useWelcomeDiscardGuard } from './routing/useWelcomeDiscardGuard';
import { requestConfirmation } from './store/commandDialogStore';
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
  const { t } = useTranslation();
  const initEngine = useWorkspaceStore((state) => state.initEngine);
  const openProject = useWorkspaceStore((state) => state.openProject);
  const selectNone = useWorkspaceStore((state) => state.selectNone);
  const engineReady = useWorkspaceStore((state) => state.engineReady);
  const toasterTheme = useThemeStore((state) => state.currentTheme.type);

  useWelcomeDiscardGuard();

  // Fire `app opened` once per launch (super properties ride along).
  useAppOpenedEvent();

  useEffect(() => startWorkspaceUrlSync(), []);

  useTauriNativeMenu();

  useEffect(() => {
    // A blocked phone never reaches a workspace, so the CP and TreeMaker wasm
    // bridges this pulls in are pure cost on the connection least able to afford
    // them. Skipping is the single biggest thing the landing page does for load
    // time there.
    if (isWorkspaceBlocked()) return;
    void initEngine();
  }, [initEngine]);

  // Route worker deaths into the store's error envelope so they reach the same
  // toast as engine errors. The runtime modules that own the workers keep no
  // store dependency, hence the registered sink.
  useEffect(() => {
    registerWorkerFailureSink((failure) => {
      useWorkspaceStore.setState({
        error: { code: workerErrorCode(failure.worker), message: failure.message },
      });
    });
    return () => registerWorkerFailureSink(null);
  }, []);

  useWindowTitle();

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
            title: t('dialogs:closeGuard.title', 'Discard unsaved changes?'),
            message: t(
              'dialogs:closeGuard.message',
              'Your current project has unsaved changes. Close Ori Studio and discard them?'
            ),
            confirmLabel: t('dialogs:closeGuard.discard', 'Discard'),
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
  }, [t]);

  useEffect(() => {
    return installAppKeyboardListener(
      {
        getActiveEditingContext: () => useWorkspaceStore.getState().activeEditingContext,
        getSelection: () => selectSelection(useWorkspaceStore.getState()),
        handleMenuAction,
        selectNone,
        getShortcutOverrides: () => useShortcutStore.getState().overrides,
      },
      document
    );
  }, [selectNone]);

  // Held modifiers are a separate input kind from chords -- a state surfaces
  // sample, not an event they handle -- so they track alongside the shortcut
  // dispatcher rather than through it.
  useEffect(() => installHeldModifierTracker(), []);

  const handleOpenedFilePath = useCallback(
    async (path: string) => {
      const opened = await openProject(createOpenedPathFileService(path));
      if (!opened) return;
      navigateTo(currentWorkspacePath());
    },
    [openProject]
  );

  useTauriOpenedFiles(engineReady, handleOpenedFilePath);

  return (
    <TooltipProvider>
      <Outlet />
      <OverlayErrorBoundary id="help">
        <HelpModal />
      </OverlayErrorBoundary>
      <OverlayErrorBoundary id="select-by-index">
        <SelectByIndexModal />
        <ShareLinkModal />
      </OverlayErrorBoundary>
      <OverlayErrorBoundary id="cp-detect-import">
        <CpDetectImportModal />
      </OverlayErrorBoundary>
      <OverlayErrorBoundary id="bp-optimizer">
        <BpOptimizerModal />
      </OverlayErrorBoundary>
      <OverlayErrorBoundary id="settings">
        <SettingsModal />
      </OverlayErrorBoundary>
      <OverlayErrorBoundary id="command-dialog">
        <CommandDialogModal />
      </OverlayErrorBoundary>
      <OverlayErrorBoundary id="global-toasts">
        <GlobalToasts />
        <GlobalErrorReporter />
      </OverlayErrorBoundary>
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
