/**
 * The page setup's words, for every surface that says them: the Page pane's
 * controls and the export dialog's summary of the setup. One set of keys, so
 * the two cannot name a paper or a layout differently.
 *
 * Literal `t()` calls, so the extractor sees each key.
 */
import type { TFunction } from 'i18next';
import type {
  DiagramPageLayout,
  DiagramPageOrientation,
  DiagramPageSetup,
  DiagramPageSide,
  DiagramPaperSize,
} from '../document/diagramDocument';

export function paperSizeLabel(size: DiagramPaperSize, t: TFunction): string {
  switch (size) {
    case 'a4':
      return t('panels:diagram.pagePane.sizes.a4', 'A4');
    case 'a5':
      return t('panels:diagram.pagePane.sizes.a5', 'A5');
    case 'b5-jis':
      return t('panels:diagram.pagePane.sizes.b5Jis', 'B5 (JIS)');
    case 'letter':
      return t('panels:diagram.pagePane.sizes.letter', 'US Letter');
  }
}

export function orientationLabel(orientation: DiagramPageOrientation, t: TFunction): string {
  return orientation === 'portrait'
    ? t('panels:diagram.pagePane.portrait', 'Portrait')
    : t('panels:diagram.pagePane.landscape', 'Landscape');
}

export function layoutLabel(layout: DiagramPageLayout, t: TFunction): string {
  return layout === 'grid' ? t('panels:diagram.pagePane.grid', 'Grid') : t('panels:diagram.pagePane.flow', 'Flow');
}

/** The side of its spread page 1 prints on: the Page pane's First page choice. */
export function pageSideLabel(side: DiagramPageSide, t: TFunction): string {
  return side === 'left'
    ? t('panels:diagram.pagePane.sideLeft', 'Left')
    : t('panels:diagram.pagePane.sideRight', 'Right');
}

/** The setup in a line: "A4 Portrait · Grid, 3 × 3". */
export function pageSetupSummary(page: DiagramPageSetup, t: TFunction): string {
  return t('dialogs:diagramExport.pageSetupSummary', '{{size}} {{orientation}} · {{layout}}, {{columns}} × {{rows}}', {
    size: paperSizeLabel(page.size, t),
    orientation: orientationLabel(page.orientation, t),
    layout: layoutLabel(page.layout, t),
    columns: page.columns,
    rows: page.rows,
  });
}
