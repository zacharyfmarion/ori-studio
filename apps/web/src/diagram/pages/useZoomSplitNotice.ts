import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { stepsOf, type DiagramDocument } from '../document/diagramDocument';
import type { PreparedDiagramPages } from './diagramPages';
import { zoomSplits } from './zoomArrows';
import { zoomSplitSentence } from './zoomSplitLabels';

/**
 * What the Pages view says about enlarged steps printed on the page after the
 * area they enlarge (Revision 2, Z3), from the pages as laid out from
 * `document`: null when every one is on its area's page, or no page break
 * would bring it there.
 */
export function useZoomSplitNotice(pages: PreparedDiagramPages | null, document: DiagramDocument | null): string | null {
  const { t, i18n } = useTranslation();
  const { language } = i18n;
  return useMemo(() => {
    if (!pages || !document) return null;
    return zoomSplitSentence(zoomSplits(pages.layout, stepsOf(document)), t, language);
  }, [pages, document, t, language]);
}
