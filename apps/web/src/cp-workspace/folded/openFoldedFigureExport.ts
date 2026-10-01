/**
 * "Export…" on a folded figure: read its picture from the runtime and open
 * the export dialog on it.
 *
 * What the picture needs is read here, once, when the verb runs — the render
 * model and the aux lines a 3D figure's window draws (an aux line drawn a
 * moment ago is awaited, so it is on the page), the kernel's paper scene for
 * a flat one, the canvas's scale — so every repaint the dialog makes works
 * from that one capture (X3), however the figure changes while it is open.
 */
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { exportPaperStyle } from '../../lib/paperStyleSettings';
import { focusedElement, usePaperExportUiStore } from '../../store/paperExportUiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { folded3dAuxLinesSettled } from '../../store/workspaceStore/folded3dAuxLinesSync';
import { getOristudioCpFoldedFigurePaperScene } from '../../store/workspaceStore/oristudioCpRuntime';
import { overlayCssPerModel } from '../annotations/annotationTransform';
import { cpOverlayViewStore } from '../cpOverlayViewStore';
import { folded3dAuxLinesOf } from './folded3dAuxLines';
import { folded3dRenderModel } from './folded3dRenderModels';
import { foldedFlatFigureExportsScene } from './foldedFlatFigureExport';
import { foldedFigureExportPicture, foldedFigureExportTarget } from './foldedFigureExportTarget';

/**
 * CSS px per crease-pattern user unit at the mounted canvas — what a folded
 * figure's on-screen box is measured in, so its export page is its on-screen
 * size (D3). 1 when no canvas is mounted, which is the box at zoom 1.
 */
export function foldedFigureCssPerUserUnit(): number {
  const user = cpOverlayViewStore.get()?.user;
  return user ? overlayCssPerModel(user) : 1;
}

export async function openFoldedFigureExport(figureId: string, t: TFunction): Promise<void> {
  // Before any await: the element the verb was run from, while it still has focus.
  const returnFocus = focusedElement();
  const store = useWorkspaceStore;
  const figure = store.getState().oristudioCpFoldedFigures.find((entry) => entry.id === figureId);
  if (!figure) return;
  try {
    if (figure.folded3d) await folded3dAuxLinesSettled(store, figure.handle);
    const kernel = foldedFlatFigureExportsScene(figure)
      ? // The document's aux lines as they stand now, as the canvas draws them.
        await getOristudioCpFoldedFigurePaperScene(
          figure.handle,
          store.getState().oristudioCpDocument?.handle ?? null
        )
      : null;
    const picture = foldedFigureExportPicture(figure, {
      model: (figure.folded3d && folded3dRenderModel(figure.handle)) || null,
      aux: figure.folded3d ? folded3dAuxLinesOf(figure.handle) : null,
      kernel,
      cssPerUserUnit: foldedFigureCssPerUserUnit(),
    });
    if (!picture) {
      toast.error(t('toasts:foldedFigureExport.empty', 'This folded model has nothing to export yet'));
      return;
    }
    const { workspaceTitle } = store.getState();
    const target = foldedFigureExportTarget({
      figure,
      picture,
      title: t('dialogs:paperExport.titleFoldedFigure', 'Export {{title}}', { title: figure.title }),
      fileStem: `${workspaceTitle} ${figure.title}`,
      // Read rather than subscribed: the style matters at the moment of export.
      exportStyle: exportPaperStyle(useSettingsStore.getState().paperStyle, figure.appearance),
      storedSceneHint: t(
        'dialogs:paperExport.storedSceneHint',
        'Shaded as it was when it was folded: fold it again to light it in another style.'
      ),
    });
    usePaperExportUiStore.getState().open({ target, format: null, scope: 'this', returnFocus });
  } catch (cause) {
    toast.error(t('toasts:foldedFigureExport.failed', 'Could not export this folded model'), {
      description: cause instanceof Error ? cause.message : undefined,
    });
  }
}
