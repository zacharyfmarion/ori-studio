/**
 * Print a diagram (`file.printDiagram`): its pages as the Pages view composes
 * them and the PDF export prints them — one layout, one page composer, at the
 * page setup's paper — through the runtime's print dialog
 * (`platform/printPages.ts`).
 *
 * The pages are laid out with their fonts first, which the first time in a
 * session means loading them: the header's Print says "Preparing…" until the
 * dialog is asked for. A failure is reported, and said in a toast, as an
 * export's is in its dialog.
 */
import { toast } from 'sonner';
import i18n from '../../i18n';
import { reportError } from '../../monitoring';
import { printPages, type PrintPagesRequest } from '../../platform/printPages';
import { useDiagramPrintUiStore } from '../../store/diagramPrintUiStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { stepsOf, type DiagramDocument } from '../document/diagramDocument';
import { browserFontSource } from '../fonts/browserFontSource';
import { browserFontSubsetter } from '../fonts/browserFontSubsetter';
import { prepareDiagramPages, type PreparedDiagramPages } from '../pages/diagramPages';
import { composedPageUrl } from '../pages/useDiagramPages';

/** Where the pages come from and where they go: the app's, or a test's. */
export interface DiagramPrintDependencies {
  prepare: (document: DiagramDocument) => Promise<PreparedDiagramPages>;
  print: (request: PrintPagesRequest) => Promise<void>;
}

export const BROWSER_DIAGRAM_PRINT: DiagramPrintDependencies = {
  prepare: (document) =>
    prepareDiagramPages(document, { fontSource: browserFontSource, subsetter: browserFontSubsetter }),
  print: (request) => printPages(request),
};

/** The pages the print dialog is handed: every page, at the paper's size. */
export async function diagramPrintRequest(
  document: DiagramDocument,
  prepare: DiagramPrintDependencies['prepare']
): Promise<PrintPagesRequest> {
  const pages = await prepare(document);
  const { paper } = pages.layout;
  return {
    pages: pages.layout.pages.map((_, index) => composedPageUrl(pages, index)),
    widthMm: paper.widthMm,
    heightMm: paper.heightMm,
  };
}

/**
 * Print the diagram as it is now. False when there is nothing to print or a
 * print is already being prepared; a failure is reported and said, and also
 * false.
 */
export async function printDiagram(dependencies: DiagramPrintDependencies = BROWSER_DIAGRAM_PRINT): Promise<boolean> {
  const ui = useDiagramPrintUiStore.getState();
  const document = useWorkspaceStore.getState().diagram;
  if (ui.preparing || !document || stepsOf(document).length === 0) return false;
  ui.setPreparing(true);
  try {
    const request = await diagramPrintRequest(document, dependencies.prepare);
    // Ready: the dialog is the runtime's from here, however long it stays up.
    useDiagramPrintUiStore.getState().setPreparing(false);
    await dependencies.print(request);
    return true;
  } catch (cause) {
    reportError(cause, { surface: 'diagram:print' });
    toast.error(i18n.t('toasts:diagramPrint.failed', 'The diagram couldn’t be printed'), {
      description: cause instanceof Error ? cause.message : String(cause),
    });
    return false;
  } finally {
    useDiagramPrintUiStore.getState().setPreparing(false);
  }
}
