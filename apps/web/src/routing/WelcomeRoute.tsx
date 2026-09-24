import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLandingSectionViewedEvents, useLandingViewedEvent } from '../analytics';
import { LANDING_SECTIONS, trackCta } from '../components/landing/WelcomeLanding';
import { WELCOME_DROP_POLICY, WelcomePage } from '../components/landing/WelcomePage';
import { useFileDropTarget } from '../hooks/useFileDropTarget';
import { OPEN_PROJECT_DIALOG } from '../lib/fileFormats';
import { humanizeError } from '../lib/toastMessages';
import { getFileService } from '../platform/fileService';
import { useIsPhoneSurface } from '../platform/mobileSurface';
import { takeOverStaticCopy } from '../seo/staticCopy';
import { useSettingsStore } from '../store/settingsStore';
import {
  loadedWorkspace,
  prefetchWorkspace,
  startActions,
  type StartOutcome,
} from './workspaceGateway';

/**
 * The `/welcome` route: a landing page led by the start screen.
 *
 * It renders without the editor. A start action loads the workspace through
 * `workspaceGateway` — already warming by then, from the pointer or focus reaching
 * an action — waits for its engine, and navigates to the workspace that now owns
 * the document. Until one is chosen nothing here depends on the editor, so the
 * actions are ready from the first paint.
 *
 * Every device gets the same page. The stylesheet stacks the hero and the three
 * actions into one column below 680px.
 *
 * Whether a cold start lands here or straight in Edit is decided by the router's
 * index redirect (the "Show welcome on startup" preference), not this component —
 * so returning here intentionally (File › New) always shows the start screen.
 */
export function WelcomeRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pageRef = useRef<HTMLElement | null>(null);
  const phone = useIsPhoneSurface();
  const showWelcomeOnStartup = useSettingsStore((state) => state.showWelcomeOnStartup);
  const setShowWelcomeOnStartup = useSettingsStore((state) => state.setShowWelcomeOnStartup);
  const [preparing, setPreparing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useLandingViewedEvent(phone ? 'phone' : 'desktop');
  useLandingSectionViewedEvents(pageRef, LANDING_SECTIONS);

  // A first visit painted the prerendered copy of this page; swap it for this one in the
  // same frame, before the browser paints again. See `seo/staticCopy.ts`.
  useLayoutEffect(() => takeOverStaticCopy(pageRef.current), []);

  // Arriving here clears transient project state — once the workspace exists. On a
  // first visit there is nothing to clear, and asking would load it.
  useEffect(() => {
    loadedWorkspace()?.resetForStartScreen();
  }, []);

  const run = useCallback(
    async (action: () => Promise<StartOutcome>) => {
      setPreparing(true);
      setErrorMessage(null);
      try {
        const outcome = await action();
        if (outcome.kind === 'navigate') navigate(outcome.path);
        else if (outcome.kind === 'error') setErrorMessage(outcome.message);
      } catch (error) {
        setErrorMessage(humanizeError(error, t));
      } finally {
        setPreparing(false);
      }
    },
    [navigate, t]
  );

  const handleOpenFile = useCallback(() => {
    // Opened here, inside the click: a browser shows a file picker only for a user
    // gesture, and the workspace that will read the file may still be loading.
    const picked = getFileService().openTextFile(OPEN_PROJECT_DIALOG);
    // Observed now so a failed pick is not reported unhandled before the workspace reads it.
    picked.catch(() => undefined);
    void run(() => startActions.openPicked(picked));
  }, [run]);

  const onDropFiles = useCallback(
    (files: File[]) => void run(() => startActions.dropFiles(files)),
    [run]
  );
  const { dropTargetProps, isDragActive } = useFileDropTarget({
    policy: WELCOME_DROP_POLICY,
    onDropFiles,
  });
  const { onDragEnter } = dropTargetProps;
  const warmThenDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      prefetchWorkspace();
      onDragEnter(event);
    },
    [onDragEnter]
  );

  return (
    <WelcomePage
      pageRef={pageRef}
      dropTargetProps={{ ...dropTargetProps, onDragEnter: warmThenDragEnter }}
      isDragActive={isDragActive}
      onScrollCue={() => trackCta('scroll')}
      preparing={preparing}
      errorMessage={errorMessage}
      onIntent={prefetchWorkspace}
      onCreateCreasePattern={() => void run(startActions.createCreasePattern)}
      onCreateDesign={() => void run(startActions.createDesign)}
      onOpenFile={handleOpenFile}
      showWelcomeOnStartup={showWelcomeOnStartup}
      onToggleShowWelcomeOnStartup={setShowWelcomeOnStartup}
    />
  );
}
