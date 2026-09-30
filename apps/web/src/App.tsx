import { selectSelection } from './store/workspaceStore/designTabs';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Toaster } from 'sonner';
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
import { useUpdateCheck } from './hooks/useUpdateCheck';
import { UpdateCard } from './components/UpdateCard';
import { createOpenedPathFileService } from './platform/fileService';
import { getRuntimeSurface } from './platform/runtime';
import { confirmDiscardUnsavedWork, hasUnsavedWork } from './lib/unsavedWork';
import { currentPath, navigateTo } from './routing/appRouter';
import { currentWorkspacePath } from './routing/landing';
import { startWorkspaceUrlSync } from './routing/workspaceUrlSync';
import { useWelcomeDiscardGuard } from './routing/useWelcomeDiscardGuard';
import { sitePageForPath } from './site/sitePages';
import { useShortcutStore } from './store/shortcutStore';
import { useThemeStore } from './store/themeStore';
import { useWorkspaceStore } from './store/workspaceStore';
import { ensureEngineBooted } from './store/workspaceStore/engineBoot';
import './styles/sonner.css';

/**
 * The workspace runtime: app-wide lifecycle (engine init, window title, close
 * guards, global keyboard, workspace↔URL sync) and the always-mounted overlays.
 * Loaded through `routing/workspaceGateway.ts` and mounted by `RootLayout` beside
 * the active route once loaded, which is what lets the landing page render
 * without it.
 */
export default function App() {
  const { t } = useTranslation();
  const openProject = useWorkspaceStore((state) => state.openProject);
  const selectNone = useWorkspaceStore((state) => state.selectNone);
  const engineReady = useWorkspaceStore((state) => state.engineReady);
  const toasterTheme = useThemeStore((state) => state.currentTheme.type);

  useWelcomeDiscardGuard();

  useEffect(() => startWorkspaceUrlSync(), []);

  useTauriNativeMenu();
  useUpdateCheck();

  // Every device, once the runtime is mounted — which is only once the workspace is
  // in use or asked for. The landing page's first load boots nothing.
  useEffect(() => {
    void ensureEngineBooted();
  }, []);

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
      // `beforeunload` cannot await a dialog — the browser owns this prompt —
      // so it shares the predicate but not the confirmation.
      if (!hasUnsavedWork()) return;
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
          if (!hasUnsavedWork()) return;
          event.preventDefault();
          void confirmDiscardUnsavedWork({
            title: t('dialogs:closeGuard.title', 'Discard unsaved changes?'),
            message: t(
              'dialogs:closeGuard.message',
              'Your current project has unsaved changes. Close Ori Studio and discard them?'
            ),
            confirmLabel: t('dialogs:closeGuard.discard', 'Discard'),
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
        // The reader owns the keyboard on a site page; nothing is mounted for a
        // shortcut to act on there. Asked of the router, not of focus.
        isReadingSitePage: () => {
          const path = currentPath();
          return path !== null && sitePageForPath(path) !== null;
        },
        getActiveEditingContext: () => useWorkspaceStore.getState().activeEditingContext,
        getSelection: () => selectSelection(useWorkspaceStore.getState()),
        handleMenuAction,
        selectNone,
        getShortcutOverrides: () => useShortcutStore.getState().overrides,
        getShortcutDefaultsSource: () => useShortcutStore.getState().defaultsSource,
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
      {/* Root-level, so it floats over the welcome screen as well as the
          workspace — the welcome screen is where the app opens, and where
          someone is most likely to be when an update lands. */}
      <OverlayErrorBoundary id="update-card">
        <UpdateCard />
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
