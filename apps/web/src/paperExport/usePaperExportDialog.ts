/**
 * The export dialog's state and verbs: the draft options, the scenes they call
 * for, the page they paint, and the save.
 *
 * The dialog edits a draft seeded from the remembered options, so a dialog
 * closed without saving changes nothing; a save remembers the draft for next
 * time. The scenes are built from the target's capture only when their key
 * changes (`usePaperExportScenes`); every other change repaints the page in
 * hand, through a deferred value so typing a margin stays responsive on a
 * large scene.
 *
 * What Export saves is the page the preview shows — the same object — and it
 * is enabled only once that page is the options as they stand: the scenes
 * built for the current key, painted with the current style and page, and on
 * screen. So the file is the preview (X2), and the PNG size cap is checked on
 * the page that will be written (X8).
 *
 * A target with several pages (a References sequence) exports the page on
 * show or every page as one ZIP (X13). Every page is then painted on one crop,
 * so the set lines up; the pager shows any of them, and every page the ZIP
 * holds is painted from the same scenes and options as the one on screen.
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
import { PT_PER_CSS_PX, type PaperSvgResult } from '../lib/paper/paperSvg';
import {
  paperExportKindOf,
  paperPageOf,
  type PaperExportSettings,
} from '../lib/paperExportSettings';
import { paperPresetRows } from '../lib/paperPresetRows';
import { isAppleMobilePlatform } from '../platform/runtime';
import { useSettingsStore } from '../store/settingsStore';
import type { PaperExportRequest } from '../store/paperExportUiStore';
import {
  createPaperExportSession,
  paintPaperExport,
  PAPER_EXPORT_SCENE_CACHE_SIZE,
  paperExportKeepsHiddenFaces,
  paperExportSceneInput,
  paperExportStyle,
  paperSceneHiddenFaces,
  paperScenesOnOneCrop,
  resolvePaperExportStyleChoice,
} from './paperExportSession';
import type { PaperExportScope } from './paperExportTarget';
import { paperExportedEvent, savePaperExport, savePaperExportZip } from './savePaperExport';
import { usePaperExportScenes, type PaperExportStatus } from './usePaperExportScenes';

export type { PaperExportStatus };

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

/** A fixed picture's PNG is its own pixel size: the density at which a CSS px is a pixel. */
const CSS_PX_PER_INCH = 96;

function sameOptions(a: PaperExportSettings, b: PaperExportSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface PaperExportDialogBinding {
  /** The dialog's title: the page's, or the set's while it exports every page. */
  title: string;
  /** The picture is fixed: only the format can be chosen. */
  fixed: boolean;
  draft: PaperExportSettings;
  /** Change some options; nothing is remembered until a file is saved. */
  patch: (next: Partial<PaperExportSettings>) => void;
  /** Whether the target has pages to choose between, and which the export writes. */
  scopes: { scope: PaperExportScope; setScope: (scope: PaperExportScope) => void } | null;
  /**
   * The pager while every page is exported: which page the preview shows, of
   * how many, and its name.
   */
  pager: {
    index: number;
    count: number;
    label: string;
    setIndex: (index: number) => void;
  } | null;
  status: PaperExportStatus;
  error: string | null;
  /**
   * The page on screen: the options' page once painted, and while a new scene
   * builds, the last complete one. Null before the first, and once there is
   * nothing to show.
   */
  preview: PaperExportPreviewImage | null;
  /** The shown page's PNG pixel size at the draft's density; every page of a set is that size. */
  pngSize: { width: number; height: number } | null;
  /** The PNG would be larger than this browser will rasterise. */
  pngTooLarge: boolean;
  /** Faces the page leaves out because nothing shows them; counted only when it does. */
  hiddenFacesDropped: number;
  /** Whether the page keeps its buried faces, as the options and the surface decide. */
  keepsHiddenFaces: boolean;
  saving: boolean;
  /** How far an export of every page has got, while it paints them; null otherwise. */
  progress: { done: number; total: number } | null;
  /**
   * A file is being written and the dialog cannot be closed. Painting the
   * pages of a ZIP is not: closing then stops it, and nothing is saved.
   */
  busy: boolean;
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
  const { pages } = target;
  const savedPresets = useSettingsStore((state) => state.paperStyle.presets);
  const rows = useMemo(() => paperPresetRows(savedPresets), [savedPresets]);
  const remember = useSettingsStore((state) => state.rememberPaperExportOptions);

  // This kind's options: a step's, a figure's or a simulation's (X6).
  const kind = paperExportKindOf(target.surface);
  const [seed] = useState(() =>
    paperExportDraft(useSettingsStore.getState().paperExport[kind], request, rows)
  );
  const [draft, setDraft] = useState(seed);
  const patch = useCallback(
    (next: Partial<PaperExportSettings>) => setDraft((current) => ({ ...current, ...next })),
    []
  );

  // A picture no option can change (E9): exported as it is, in the format
  // chosen, at its own pixel size.
  const fixed = target.fixedPicture ?? null;
  const fixedPage = useMemo<PaperSvgResult | null>(
    () =>
      fixed && {
        svg: fixed.svg,
        widthPt: fixed.widthPx * PT_PER_CSS_PX,
        heightPt: fixed.heightPx * PT_PER_CSS_PX,
      },
    [fixed]
  );
  const choosable = pages !== null && pages.list.length > 1;
  const [scope, setScope] = useState<PaperExportScope>(choosable ? request.scope : 'this');
  const [pagerIndex, setPagerIndex] = useState(pages?.current ?? 0);
  const all = scope === 'all' && pages !== null;
  // The pages the options call for, and which of them the preview shows.
  const pageIndices = useMemo(
    () => (fixed ? [] : all ? pages.list.map((_, index) => index) : [pages?.current ?? 0]),
    [fixed, all, pages]
  );
  const shownAt = all ? pagerIndex : 0;

  // Once per dialog: a ref rather than the effect's deps alone, since a
  // development StrictMode mount runs the effect twice.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    trackPaperExportOpened(target.surface, scope);
  }, [target, scope]);

  const { format, keepHiddenFaces, background, sheet, paddingMm } = draft;
  const keepsHiddenFaces = paperExportKeepsHiddenFaces(target, { format, keepHiddenFaces });
  const session = useMemo(
    () => createPaperExportSession(target, PAPER_EXPORT_SCENE_CACHE_SIZE * (pages?.list.length ?? 1)),
    [target, pages]
  );
  const style = useMemo(() => paperExportStyle(target, draft.style, rows), [target, draft.style, rows]);
  const inputs = useMemo(
    () =>
      pageIndices.map((page) =>
        paperExportSceneInput(target, style, { format, keepHiddenFaces, background }, page)
      ),
    [pageIndices, target, style, format, keepHiddenFaces, background]
  );
  const key = inputs.map((input) => target.sceneKey(input)).join('\n');
  const built = usePaperExportScenes(session, inputs, key);
  const { status } = built;
  const scenes = useMemo(
    () => (all ? paperScenesOnOneCrop(built.scenes) : built.scenes),
    [all, built.scenes]
  );
  const scene = scenes[shownAt] ?? null;

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
  // Only the scenes built for the current key are painted: an older one
  // carries the style it was built with in its markup, and painting it with
  // another would show neither. While the next builds, the preview keeps its
  // image.
  const painted = useMemo(
    () => fixedPage ?? (scene ? paintPaperExport(target, scene, deferredStyle, deferredPage) : null),
    [fixedPage, scene, target, deferredStyle, deferredPage]
  );
  const preview = usePreviewImage(painted, status === 'building');

  const shown = preview?.page ?? null;
  const pngDpi = fixed ? CSS_PX_PER_INCH : draft.pngDpi;
  const pngSize = shown ? paperPngSize(shown, pngDpi) : null;
  const limit = isAppleMobilePlatform() ? APPLE_MOBILE_PNG_CANVAS_LIMIT : DESKTOP_PNG_CANVAS_LIMIT;
  const pngTooLarge = format === 'png' && pngSize !== null && !pngFitsCanvas(pngSize, limit);

  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const canExport =
    status === 'ready' && caughtUp && shown !== null && shown === painted && !pngTooLarge && !saving;

  // Aborted when the dialog goes, so a PNG still encoding, or a ZIP's pages
  // still painting, is not then offered to a save dialog nobody is waiting for.
  const aborter = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    aborter.current = controller;
    return () => controller.abort();
  }, []);

  const exportNow = useCallback(async () => {
    if (!canExport || !shown) return;
    const signal = aborter.current?.signal;
    setSaving(true);
    setSaveError(null);
    if (all) setProgress({ done: 0, total: scenes.length });
    try {
      const name =
        all && pages
          ? await savePaperExportZip({
              // Every page from the scenes and options the one on screen was
              // painted from; that one is the very page shown.
              pages: scenes.map((each, index) => ({
                page: index === shownAt ? shown : paintPaperExport(target, each, style, pageOptions),
                fileStem: pages.list[index]!.fileStem,
              })),
              format: draft.format,
              pngDpi: draft.pngDpi,
              zipStem: pages.zipStem,
              signal,
              onProgress: (done, total) => setProgress({ done, total }),
            })
          : await savePaperExport({
              page: shown,
              format: draft.format,
              pngDpi,
              fileStem: target.fileStem,
              signal,
            });
      // A dismissed save dialog: the options are still in front of the reader.
      if (!name) return;
      remember(kind, draft);
      trackPaperExported(
        // The density the file was written at, which a fixed picture sets itself.
        paperExportedEvent(target.surface, { ...draft, pngDpi }, {
          keepsHiddenFaces,
          style: draft.style,
          rows,
          changed: !sameOptions(draft, seed),
          scope,
          pageCount: scenes.length,
        })
      );
      toast.success(t('toasts:paperExport.saved', 'Exported {{name}}', { name }));
      close();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }, [
    canExport,
    shown,
    pngDpi,
    all,
    pages,
    scenes,
    shownAt,
    target,
    style,
    pageOptions,
    draft,
    remember,
    kind,
    keepsHiddenFaces,
    rows,
    seed,
    scope,
    t,
    close,
  ]);

  const painting = progress !== null && progress.done < progress.total;
  return {
    title: all ? pages.title : target.title,
    fixed: fixed !== null,
    draft,
    patch,
    scopes: choosable ? { scope, setScope } : null,
    pager:
      all && pages
        ? {
            index: pagerIndex,
            count: pages.list.length,
            label: pages.list[pagerIndex]?.label ?? '',
            setIndex: (index) => setPagerIndex(Math.min(pages.list.length - 1, Math.max(0, index))),
          }
        : null,
    status,
    error: built.error,
    preview,
    pngSize,
    pngTooLarge,
    hiddenFacesDropped: scene && !keepsHiddenFaces ? paperSceneHiddenFaces(scene) : 0,
    keepsHiddenFaces,
    saving,
    progress,
    busy: saving && !painting,
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
