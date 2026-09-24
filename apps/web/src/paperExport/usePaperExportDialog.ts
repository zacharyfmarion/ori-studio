/**
 * The export dialog's state and verbs: the draft options, the scene they call
 * for, the page they paint, and the save.
 *
 * The dialog edits a draft seeded from the remembered options, so a dialog
 * closed without saving changes nothing; a save remembers the draft for next
 * time. The scene is built from the target's capture only when its key
 * changes; every other change repaints the scene in hand, through a deferred
 * value so typing a margin stays responsive on a large scene.
 *
 * What Export saves is the page the preview shows — the same object — and it
 * is enabled only once that page is the options as they stand: the scene
 * built for the current key, painted with the current style and page, and on
 * screen. So the file is the preview (X2), and the PNG size cap is checked on
 * the page that will be written (X8).
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { trackPaperExported, trackPaperExportOpened } from '../analytics';
import { paperPngSize } from '../lib/paper/paperPng';
import {
  APPLE_MOBILE_PNG_CANVAS_LIMIT,
  DESKTOP_PNG_CANVAS_LIMIT,
  pngFitsCanvas,
} from '../lib/paper/pngCanvasLimits';
import type { PaperScene } from '../lib/paper/paperScene';
import type { PaperSvgResult } from '../lib/paper/paperSvg';
import { paperPageOf, type PaperExportSettings } from '../lib/paperExportSettings';
import { paperPresetRows } from '../lib/paperPresetRows';
import { isAppleMobilePlatform } from '../platform/runtime';
import { useSettingsStore } from '../store/settingsStore';
import type { PaperExportRequest } from '../store/paperExportUiStore';
import {
  createPaperExportSession,
  paintPaperExport,
  paperExportKeepsHiddenFaces,
  paperExportSceneInput,
  paperExportStyle,
  paperSceneHiddenFaces,
  resolvePaperExportStyleChoice,
} from './paperExportSession';
import { paperExportedEvent, savePaperExport } from './savePaperExport';

/** Where the preview is: building a scene, showing one, or unable to. */
export type PaperExportStatus = 'building' | 'ready' | 'empty' | 'error';

interface SceneState {
  key: string;
  scene: PaperScene | null;
  status: PaperExportStatus;
  error: string | null;
}

/** The image on screen: a painted page and the object URL it is shown through. */
export interface PaperExportPreviewImage {
  url: string;
  page: PaperSvgResult;
}

/** The draft the dialog opens on: the remembered options, the verb's format, and a style choice the presets can still honour. */
export function paperExportDraft(
  remembered: PaperExportSettings,
  request: Pick<PaperExportRequest, 'format'>,
  rows: Parameters<typeof resolvePaperExportStyleChoice>[1]
): PaperExportSettings {
  return {
    ...remembered,
    format: request.format ?? remembered.format,
    style: resolvePaperExportStyleChoice(remembered.style, rows),
  };
}

function sameOptions(a: PaperExportSettings, b: PaperExportSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface PaperExportDialogBinding {
  draft: PaperExportSettings;
  /** Change some options; nothing is remembered until a file is saved. */
  patch: (next: Partial<PaperExportSettings>) => void;
  status: PaperExportStatus;
  error: string | null;
  /**
   * The page on screen: the options' page once painted, and while a new scene
   * builds, the last complete one. Null before the first, and once there is
   * nothing to show.
   */
  preview: PaperExportPreviewImage | null;
  /** The shown page's PNG pixel size at the draft's density. */
  pngSize: { width: number; height: number } | null;
  /** The PNG would be larger than this browser will rasterise. */
  pngTooLarge: boolean;
  /** Faces the page leaves out because nothing shows them; counted only when it does. */
  hiddenFacesDropped: number;
  /** Whether the page keeps its buried faces, as the options and the surface decide. */
  keepsHiddenFaces: boolean;
  saving: boolean;
  saveError: string | null;
  canExport: boolean;
  exportNow: () => Promise<void>;
}

/**
 * `close` closes this dialog only — the caller binds it to the request — so a
 * save that settles after its dialog was replaced cannot close the newer one.
 */
export function usePaperExportDialog(
  request: PaperExportRequest,
  close: () => void
): PaperExportDialogBinding {
  const { t } = useTranslation();
  const { target } = request;
  const savedPresets = useSettingsStore((state) => state.paperStyle.presets);
  const rows = useMemo(() => paperPresetRows(savedPresets), [savedPresets]);
  const remember = useSettingsStore((state) => state.rememberPaperExportOptions);

  const [seed] = useState(() =>
    paperExportDraft(useSettingsStore.getState().paperExport, request, rows)
  );
  const [draft, setDraft] = useState(seed);
  const patch = useCallback(
    (next: Partial<PaperExportSettings>) => setDraft((current) => ({ ...current, ...next })),
    []
  );

  // Once per dialog: a ref rather than the effect's deps alone, since a
  // development StrictMode mount runs the effect twice.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    trackPaperExportOpened(target.surface);
  }, [target]);

  const { format, keepHiddenFaces, background, sheet, paddingMm } = draft;
  const keepsHiddenFaces = paperExportKeepsHiddenFaces(target, { format, keepHiddenFaces });
  const session = useMemo(() => createPaperExportSession(target), [target]);
  const style = useMemo(() => paperExportStyle(target, draft.style, rows), [target, draft.style, rows]);
  const input = useMemo(
    () => paperExportSceneInput(target, style, { format, keepHiddenFaces, background }),
    [target, style, format, keepHiddenFaces, background]
  );
  const key = target.sceneKey(input);

  const [sceneState, setSceneState] = useState<SceneState>({
    key: '',
    scene: null,
    status: 'building',
    error: null,
  });
  // The input a key stands for, read when the build starts; a ref so the
  // effect below runs per key rather than per render. Refreshed by the effect
  // declared first, so it is current when the build effect reads it.
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  });
  useEffect(() => {
    let current = true;
    // The page in hand stays on screen while the next one builds.
    setSceneState((previous) => ({ ...previous, status: 'building', error: null }));
    session.scene(inputRef.current).then(
      (scene) => {
        if (!current) return;
        setSceneState({ key, scene, status: scene ? 'ready' : 'empty', error: null });
      },
      (cause: unknown) => {
        if (!current) return;
        setSceneState({
          key,
          scene: null,
          status: 'error',
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    );
    return () => {
      current = false;
    };
  }, [key, session]);

  // `paperExportPage`, memoised on what the page reads: the format and the
  // density change the file, not the page, and repaint nothing — the format
  // reaches the page only through whether it keeps its hidden faces.
  const pageOptions = useMemo(
    () => paperPageOf({ sheet, paddingMm, background, keepHiddenFaces: keepsHiddenFaces }),
    [sheet, paddingMm, background, keepsHiddenFaces]
  );
  const deferredPage = useDeferredValue(pageOptions);
  const deferredStyle = useDeferredValue(style);
  const caughtUp = deferredPage === pageOptions && deferredStyle === style;
  const { scene } = sceneState;
  // A scene built for another key is on its way out: the build effect has yet
  // to run for the key this render asks for.
  const status: PaperExportStatus = sceneState.key === key ? sceneState.status : 'building';
  const sceneCurrent = status === 'ready';
  // Only the scene built for the current key is painted: an older one carries
  // the style it was built with in its markup, and painting it with another
  // would show neither. While the next builds, the preview keeps its image.
  const painted = useMemo(
    () => (sceneCurrent && scene ? paintPaperExport(target, scene, deferredStyle, deferredPage) : null),
    [sceneCurrent, scene, target, deferredStyle, deferredPage]
  );
  const preview = usePreviewImage(painted, status === 'building');

  const shown = preview?.page ?? null;
  const pngSize = shown ? paperPngSize(shown, draft.pngDpi) : null;
  const limit = isAppleMobilePlatform() ? APPLE_MOBILE_PNG_CANVAS_LIMIT : DESKTOP_PNG_CANVAS_LIMIT;
  const pngTooLarge = format === 'png' && pngSize !== null && !pngFitsCanvas(pngSize, limit);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const canExport =
    sceneCurrent && caughtUp && shown !== null && shown === painted && !pngTooLarge && !saving;

  // Aborted when the dialog goes, so a PNG still encoding is not then offered
  // to a save dialog nobody is waiting for.
  const aborter = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    aborter.current = controller;
    return () => controller.abort();
  }, []);

  const exportNow = useCallback(async () => {
    if (!canExport || !shown) return;
    setSaving(true);
    setSaveError(null);
    try {
      const name = await savePaperExport({
        page: shown,
        format: draft.format,
        pngDpi: draft.pngDpi,
        fileStem: target.fileStem,
        signal: aborter.current?.signal,
      });
      // A dismissed save dialog: the options are still in front of the reader.
      if (!name) return;
      remember(draft);
      trackPaperExported(
        paperExportedEvent(target.surface, draft, {
          keepsHiddenFaces,
          style: draft.style,
          rows,
          changed: !sameOptions(draft, seed),
        })
      );
      toast.success(t('toasts:paperExport.saved', 'Exported {{name}}', { name }));
      close();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [canExport, shown, target, draft, remember, keepsHiddenFaces, rows, seed, t, close]);

  return {
    draft,
    patch,
    status,
    error: status === 'error' ? sceneState.error : null,
    preview,
    pngSize,
    pngTooLarge,
    hiddenFacesDropped: scene && !keepsHiddenFaces ? paperSceneHiddenFaces(scene) : 0,
    keepsHiddenFaces,
    saving,
    saveError,
    canExport,
    exportNow,
  };
}

/**
 * The painted page as an image, the URL and the page set together so the
 * box's aspect never runs ahead of the image in it. While `building`, a null
 * page keeps the last image up; otherwise it clears it.
 *
 * A URL is revoked only after the commit that took it off screen — never while
 * it is still the image's `src`, which would blank an image still loading
 * during a quick run of repaints — and every URL is revoked on unmount.
 */
function usePreviewImage(page: PaperSvgResult | null, building: boolean): PaperExportPreviewImage | null {
  const [image, setImage] = useState<PaperExportPreviewImage | null>(null);
  const retired = useRef<string[]>([]);
  useEffect(() => {
    if (!page) {
      if (!building) setImage(null);
      return undefined;
    }
    const url = URL.createObjectURL(new Blob([page.svg], { type: 'image/svg+xml' }));
    setImage({ url, page });
    return () => {
      retired.current.push(url);
    };
  }, [page, building]);

  const shownUrl = image?.url ?? null;
  useEffect(() => {
    const keep: string[] = [];
    for (const url of retired.current) {
      if (url === shownUrl) keep.push(url);
      else URL.revokeObjectURL(url);
    }
    retired.current = keep;
  });
  // Declared after the effect that retires the URL in hand, so its unmount
  // cleanup has run by the time this one revokes them all.
  useEffect(
    () => () => {
      for (const url of retired.current) URL.revokeObjectURL(url);
      retired.current = [];
    },
    []
  );
  return image;
}
