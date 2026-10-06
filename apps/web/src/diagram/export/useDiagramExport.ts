/**
 * The Diagram's export dialog: its options, what they would write, the
 * preview and the save (D11).
 *
 * The dialog edits a draft seeded from the remembered options, so closing it
 * without saving changes nothing, and a save remembers the draft. It exports
 * the diagram as it was when it opened.
 *
 * - **PDF:** the pages, as the Pages view composes them; the preview is a
 *   page and the pager walks them. Text a font cannot set refuses the PDF
 *   before it is tried, since the writer would.
 * - **SVG:** the same pages on one sheet, in printed spreads
 *   (`diagramSheet.ts`); the preview is a spread, its pages as the PDF's
 *   preview shows them, and the pager walks the spreads.
 * - **Step files:** a file for each step with a picture (`stepFiles.ts`); the
 *   preview is a file and the pager walks them. A PNG too large for the
 *   browser to draw is refused before the save, as the paper export's is.
 *
 * Writing the PDF or the files can be stopped: closing the dialog stops it,
 * and nothing is offered to a save dialog. Only the save itself cannot be.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { trackDiagramExported } from '../../analytics';
import { reportError } from '../../monitoring';
import { paperPngSize } from '../../lib/paper/paperPng';
import { PT_PER_MM, type PaperSvgResult } from '../../lib/paper/paperSvg';
import {
  APPLE_MOBILE_PNG_CANVAS_LIMIT,
  DESKTOP_PNG_CANVAS_LIMIT,
  pngFitsCanvas,
} from '../../lib/paper/pngCanvasLimits';
import { exportFilename } from '../../platform/exportFilename';
import { getFileService, type FileService } from '../../platform/fileService';
import { isAppleMobilePlatform } from '../../platform/runtime';
import { savePaperExportZip } from '../../paperExport/savePaperExport';
import { useSettingsStore } from '../../store/settingsStore';
import type { DiagramDocument } from '../document/diagramDocument';
import { browserFontSource } from '../fonts/browserFontSource';
import { browserFontSubsetter } from '../fonts/browserFontSubsetter';
import { loadDiagramFonts, type DiagramFonts } from '../fonts/diagramFonts';
import type { FontSubsetter } from '../fonts/fontSubset';
import { diagramFontTexts, preparedPages, type PreparedDiagramPages } from '../pages/diagramPages';
import { composedPageUrl } from '../pages/useDiagramPages';
import { stepPictureSource } from '../pictures/paintDiagramStep';
import { svgDataUrl } from '../pictures/stepPictureCache';
import { browserPdfWriter, DiagramPdfError } from './browserPdfWriter';
import {
  normalizeDiagramExportSettings,
  type DiagramExportSettings,
} from './diagramExportSettings';
import { diagramPdfInput, type PdfWriter } from './diagramPdf';
import { diagramSheetFile, sheetLayoutOf } from './diagramSheet';
import { prepareStepFiles, stepFileMinHeightMm, type PreparedStepFiles } from './stepFiles';
import { stepsOf } from '../document/diagramDocument';

export type DiagramExportStatus = 'loading' | 'ready' | 'failed';

/** Where a save has got: writing (which closing stops), then saving (which it cannot). */
export type DiagramExportPhase = 'writing' | 'saving';

export interface DiagramExportBinding {
  draft: DiagramExportSettings;
  /** Change some options; nothing is remembered until a file is saved. */
  patch: (next: Partial<DiagramExportSettings>) => void;
  /** The fonts and the subsetter loading, ready, or not to be had. */
  status: DiagramExportStatus;
  /** The PDF's or the SVG's pages, or the step files: how many. */
  count: number;
  /** The page or file on show, as an image, with its size; null for the SVG, whose preview is `sheet`. */
  preview: { url: string; page: Pick<PaperSvgResult, 'widthPt' | 'heightPt'> } | null;
  /**
   * The SVG's sheet: its size, how many spreads it has, and the spread on
   * show, its pages as images left to right, null where it has none.
   */
  sheet: {
    widthMm: number;
    heightMm: number;
    spreads: number;
    spread: (string | null)[];
    pageMm: { width: number; height: number };
  } | null;
  pager: { index: number; count: number; label: string; setIndex: (index: number) => void } | null;
  /** The steps with no picture: blank space in the PDF and the SVG, no file in the ZIP. */
  empty: number[];
  /** The steps whose instruction is cut. */
  cut: number[];
  /** How many turns between steps the diagram has (D22): the pages print them, step files leave them out. */
  turns: number;
  /** Characters no font has: the PDF refuses them; a file draws them as boxes. */
  missing: string[];
  /**
   * A CJK face the text needs could not be downloaded (offline, say), so some
   * of `missing` may only be missing until it can be.
   */
  unavailable: boolean;
  /** Load the fonts again: after a download failed, or the fonts could not be had at all. */
  retry: () => void;
  /** A step file's PNG size at the density, for the file on show. */
  pngSize: { width: number; height: number } | null;
  pngTooLarge: boolean;
  /** The canvas's least height, for the number and the text it carries. */
  minHeightMm: number;
  phase: DiagramExportPhase | null;
  /** How far the step files have got, while they are written. */
  progress: { done: number; total: number } | null;
  /** The save dialog is up: the dialog cannot be closed. */
  busy: boolean;
  saveError: string | null;
  /** The name the save dialog is offered: the PDF's, the SVG's, or the ZIP's. */
  filename: string;
  canExport: boolean;
  exportNow: () => Promise<void>;
}

interface Loaded {
  fonts: DiagramFonts;
  subsetter: FontSubsetter;
}

/** Where the export's fonts come from, what writes its PDF, and where it saves: the app's, or a test's. */
export interface DiagramExportDependencies {
  load: (document: DiagramDocument) => Promise<Loaded>;
  writePdf: PdfWriter;
  fileService: () => FileService;
}

export const BROWSER_DIAGRAM_EXPORT: DiagramExportDependencies = {
  load: async (document) => {
    const [fonts, subsetter] = await Promise.all([
      loadDiagramFonts(diagramFontTexts(document), document.hanStyle, browserFontSource),
      browserFontSubsetter(),
    ]);
    return { fonts, subsetter };
  },
  writePdf: browserPdfWriter,
  fileService: getFileService,
};

/** A diagram's name for its files: its title, or "Diagram". */
function fileStemOf(document: DiagramDocument): string {
  return document.title.trim() || 'Diagram';
}

const stepFileUrls = new WeakMap<PreparedStepFiles, Map<number, { url: string; page: PaperSvgResult }>>();

/** Step file `index`, composed and as a `data:` URL, once per preparation. */
function stepFilePreview(files: PreparedStepFiles, index: number) {
  let byIndex = stepFileUrls.get(files);
  if (!byIndex) {
    byIndex = new Map();
    stepFileUrls.set(files, byIndex);
  }
  let shown = byIndex.get(index);
  if (!shown) {
    const page = files.compose(index);
    shown = { url: svgDataUrl(page.svg), page };
    byIndex.set(index, shown);
  }
  return shown;
}

export function useDiagramExport(
  document: DiagramDocument,
  close: () => void,
  dependencies: DiagramExportDependencies = BROWSER_DIAGRAM_EXPORT
): DiagramExportBinding {
  const { t } = useTranslation();
  const remember = useSettingsStore((state) => state.rememberDiagramExport);
  const [draft, setDraft] = useState(() => useSettingsStore.getState().diagramExport);
  // Through the normaliser, so a canvas that the number and the text no
  // longer fit grows to fit them.
  const patch = useCallback(
    (next: Partial<DiagramExportSettings>) =>
      setDraft((current) => normalizeDiagramExportSettings({ ...current, ...next })),
    []
  );

  const [loaded, setLoaded] = useState<Loaded | 'failed' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setLoaded(null);
    setAttempt((count) => count + 1);
  }, []);
  useEffect(() => {
    let live = true;
    dependencies
      .load(document)
      .then((next) => {
        if (live) setLoaded(next);
      })
      .catch((error: unknown) => {
        reportError(error, { surface: 'diagram:export' });
        if (live) setLoaded('failed');
      });
    return () => {
      live = false;
    };
  }, [document, dependencies, attempt]);
  const ready = loaded !== null && loaded !== 'failed' ? loaded : null;

  const pdf = draft.kind === 'pdf';
  const svg = draft.kind === 'svg';
  // The PDF and the SVG print the pages; switching between them keeps them.
  const printed = pdf || svg;
  const pages = useMemo<PreparedDiagramPages | null>(
    () => (ready && printed ? preparedPages(document, ready.fonts, ready.subsetter) : null),
    [ready, printed, document]
  );
  const sheetLayout = useMemo(() => (pages && svg ? sheetLayoutOf(pages) : null), [pages, svg]);
  const { number, text, sameSize, widthMm, heightMm, transparent } = draft;
  const files = useMemo<PreparedStepFiles | null>(
    () =>
      ready && !printed
        ? prepareStepFiles(document, ready.fonts, ready.subsetter, {
            number,
            text,
            sameSize,
            widthMm,
            heightMm,
            transparent,
          })
        : null,
    [ready, printed, document, number, text, sameSize, widthMm, heightMm, transparent]
  );

  const count = pages ? pages.layout.pages.length : (files?.files.length ?? 0);
  // The pager walks the SVG's spreads, and the others' pages or files.
  const shown = sheetLayout ? sheetLayout.spreads.length : count;
  const [pagerIndex, setPagerIndex] = useState(0);
  const index = Math.min(pagerIndex, Math.max(0, shown - 1));
  const sheet = useMemo(() => {
    if (!pages || !sheetLayout) return null;
    const spread = sheetLayout.spreads[index] ?? [];
    return {
      widthMm: sheetLayout.widthMm,
      heightMm: sheetLayout.heightMm,
      spreads: sheetLayout.spreads.length,
      spread: spread.slice(0, sheetLayout.across).map((at) => (at === null ? null : composedPageUrl(pages, at))),
      pageMm: sheetLayout.pageMm,
    };
  }, [pages, sheetLayout, index]);
  const preview = useMemo(() => {
    if (sheetLayout) return null;
    if (pages) {
      const { paper } = pages.layout;
      return { url: composedPageUrl(pages, index), page: { widthPt: paper.widthMm * PT_PER_MM, heightPt: paper.heightMm * PT_PER_MM } };
    }
    if (files && files.files.length > 0) return stepFilePreview(files, index);
    return null;
  }, [sheetLayout, pages, files, index]);

  const empty = useMemo(
    () =>
      stepsOf(document).flatMap((step, at) => (stepPictureSource(step, document.assets) ? [] : [at + 1])),
    [document]
  );
  const cut = useMemo(
    () =>
      pages
        ? pages.layout.pages.flatMap((page) => page.cells.filter((cell) => cell.textOverflow).map((cell) => cell.number))
        : (files?.cut ?? []),
    [pages, files]
  );
  const missing = pages?.missing ?? files?.missing ?? [];

  const png = !printed && draft.format === 'png';
  const limit = isAppleMobilePlatform() ? APPLE_MOBILE_PNG_CANVAS_LIMIT : DESKTOP_PNG_CANVAS_LIMIT;
  const pngSize = png && preview ? paperPngSize(preview.page, draft.dpi) : null;
  const pngTooLarge = pngSize !== null && !pngFitsCanvas(pngSize, limit);

  const [phase, setPhase] = useState<DiagramExportPhase | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const canExport =
    ready !== null && count > 0 && phase === null && !pngTooLarge && !(pdf && missing.length > 0);

  // Aborted when the dialog goes: a PDF still being written, or files still
  // being drawn, are then never offered to a save dialog.
  const aborter = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    aborter.current = controller;
    return () => controller.abort();
  }, []);

  const exportNow = useCallback(async () => {
    const signal = aborter.current?.signal;
    if (!canExport || !ready || !signal) return;
    setPhase('writing');
    setSaveError(null);
    // A frame for "Exporting…" before the pages are composed.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stem = fileStemOf(document);
    try {
      let name: string | null = null;
      if (pdf) {
        const input = diagramPdfInput(document, ready.fonts, ready.subsetter, draft.pdf);
        const bytes = await dependencies.writePdf(input.pages, input.fonts, input.options, signal);
        if (signal.aborted) return;
        setPhase('saving');
        const saved = await dependencies.fileService().saveBinaryFile({
          title: 'Export PDF',
          bytes,
          suggestedName: exportFilename(stem, 'pdf'),
          path: null,
          extensions: ['pdf'],
          mimeType: 'application/pdf',
        });
        name = saved?.name ?? null;
      } else if (svg && pages) {
        const file = diagramSheetFile(document, pages, ready.fonts, ready.subsetter);
        if (signal.aborted) return;
        setPhase('saving');
        const saved = await dependencies.fileService().saveTextFile({
          title: 'Export SVG',
          contents: file.svg,
          suggestedName: exportFilename(stem, 'svg'),
          path: null,
          extensions: ['svg'],
        });
        name = saved?.name ?? null;
      } else if (files) {
        const written = files.files.map((file, at) => ({ page: files.compose(at), fileStem: file.fileStem }));
        if (png) {
          // A cropped file can be larger than the one on show. A refusal the
          // reader can act on, not a failure: nothing is reported.
          const at = written.findIndex(({ page }) => !pngFitsCanvas(paperPngSize(page, draft.dpi), limit));
          if (at >= 0) {
            const size = paperPngSize(written[at]!.page, draft.dpi);
            setSaveError(
              t(
                'dialogs:diagramExport.pngFileTooLarge',
                'Step {{number}} would be {{width}} × {{height}} px, too large for a PNG. Lower the resolution or the size.',
                { number: files.files[at]!.number, width: size.width, height: size.height }
              )
            );
            return;
          }
        }
        setProgress({ done: 0, total: written.length });
        name = await savePaperExportZip({
          pages: written,
          format: draft.format,
          pngDpi: draft.dpi,
          zipStem: stem,
          fileService: dependencies.fileService(),
          signal,
          onProgress: (done, total) => {
            setProgress({ done, total });
            if (done === total) setPhase('saving');
          },
        });
      }
      // A dismissed save dialog: the options are still in front of the reader.
      if (!name) return;
      remember(draft);
      trackDiagramExported(
        pdf ? 'pdf' : svg ? 'svg' : 'zip',
        pdf
          ? { preset: draft.pdf === 'print-shop' ? 'print_shop' : 'home' }
          : svg
            ? null
            : {
                fileType: draft.format,
                dpi: png ? draft.dpi : null,
                number: draft.number,
                text: draft.text,
                sameSize: draft.sameSize,
                transparent: draft.transparent,
              },
        { files: count, steps: stepsOf(document).length, empty: empty.length }
      );
      toast.success(t('toasts:diagramExport.saved', 'Exported {{name}}', { name }));
      close();
    } catch (cause) {
      if (signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) return;
      reportError(cause, { surface: 'diagram:export' });
      setSaveError(saveErrorMessage(cause, t));
    } finally {
      if (!signal.aborted) {
        setPhase(null);
        setProgress(null);
      }
    }
  }, [canExport, ready, document, pdf, svg, pages, draft, files, png, limit, remember, count, empty, t, close, dependencies]);

  return {
    draft,
    patch,
    status: loaded === null ? 'loading' : loaded === 'failed' ? 'failed' : 'ready',
    count,
    preview,
    sheet,
    pager:
      shown > 1
        ? {
            index,
            count: shown,
            label: sheetLayout
              ? spreadLabel(sheetLayout.spreads[index] ?? [], t)
              : pdf
                ? t('dialogs:diagramExport.pageLabel', 'Page {{number}}', { number: index + 1 })
                : t('dialogs:diagramExport.stepLabel', 'Step {{number}}', {
                    number: files?.files[index]?.number ?? index + 1,
                  }),
            setIndex: (next) => setPagerIndex(Math.min(shown - 1, Math.max(0, next))),
          }
        : null,
    empty,
    cut,
    turns: document.steps.length - stepsOf(document).length,
    missing,
    unavailable: (ready?.fonts.unavailable.length ?? 0) > 0,
    retry,
    pngSize,
    pngTooLarge,
    minHeightMm: Math.ceil(stepFileMinHeightMm(draft)),
    phase,
    progress,
    busy: phase === 'saving',
    saveError,
    filename: exportFilename(fileStemOf(document), pdf ? 'pdf' : svg ? 'svg' : 'zip'),
    canExport,
    exportNow,
  };
}

/** A spread in the pager: "Pages 2–3", or "Page 1" alone. */
function spreadLabel(spread: readonly (number | null)[], t: ReturnType<typeof useTranslation>['t']): string {
  const numbers = spread.filter((at): at is number => at !== null).map((at) => at + 1);
  return numbers.length > 1
    ? t('dialogs:diagramExport.spreadLabel', 'Pages {{first}}–{{last}}', { first: numbers[0], last: numbers.at(-1) })
    : t('dialogs:diagramExport.pageLabel', 'Page {{number}}', { number: numbers[0] ?? 1 });
}

/** What went wrong, for the dialog's footer. */
function saveErrorMessage(cause: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (cause instanceof DiagramPdfError) {
    return cause.code === 'text'
      ? t('dialogs:diagramExport.pdfText', 'Some text can’t be printed in the diagram’s fonts.')
      : t('dialogs:diagramExport.pdfFailed', 'The PDF couldn’t be written: {{message}}', { message: cause.message });
  }
  return cause instanceof Error ? cause.message : String(cause);
}
