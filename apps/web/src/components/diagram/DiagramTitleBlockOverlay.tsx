import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import type { PageBox } from '../../diagram/pages/pagePlacement';
import {
  missingTitleBlockParts,
  type MissingTitleBlockPart,
  type ResolvedTitleBlock,
  type TitleBlockPlaceholder,
} from '../../diagram/pages/titleBlockContent';
import type { LayoutTitleBlock } from '../../diagram/pages/titleBlockColumn';
import type { PrintPaper } from '../../diagram/pages/printPaper';
import { PAGES_PX_PER_MM } from '../../diagram/pages/usePagesView';
import { PageGuide } from './PageGuide';
import { PagePlaceholder } from './PagePlaceholder';

const px = (mm: number) => mm * PAGES_PX_PER_MM;

/**
 * Where the words go in each room: the pattern's square's at the top of what
 * a model standing in it leaves free; the model's box's at its foot, under the
 * pattern drawn behind it; a cut's at the end of the line it marks.
 */
const WORDS: Readonly<Record<TitleBlockPlaceholder['room'], 'top' | 'middle' | 'bottom'>> = {
  square: 'top',
  model: 'bottom',
  cut: 'middle',
};

/**
 * The first page's title block on the Pages view, over the page and never in
 * it (`implementation-plans/diagram-title-block.md`, section 6): its outline,
 * drawn as the margin guide is, and a box in each room of its art where what
 * would print there prints nothing, saying why — the crease pattern, the
 * finished model — and where the header has no more room for the credits. An
 * empty title, credit or note is not drawn, and not marked either, nor a
 * note's end cut with "…" past half the page (Zach, 2026-10-15). No two
 * boxes overlap. A press passes through to the page, which brings the Page
 * tab forward.
 */
export function DiagramTitleBlockOverlay({
  block,
  content,
  model,
  paper,
}: {
  block: LayoutTitleBlock;
  content: ResolvedTitleBlock;
  /** Where the block draws its model (`PreparedDiagramPages.titleBlockModel`), which the square's mark keeps clear of. */
  model: PageBox | null;
  /** The page, which the outline is inset into as the margin guide is. */
  paper: Pick<PrintPaper, 'widthMm' | 'heightMm'>;
}) {
  const { t } = useTranslation();
  const words = ({ part, step, number, file }: MissingTitleBlockPart): string[] => {
    switch (part) {
      case 'pattern':
        return [
          file
            ? t('panels:diagram.pages.titleBlock.fileNoPattern', 'The uploaded file has no folds')
            : step
              ? t('panels:diagram.pages.titleBlock.stepNoPattern', 'Step {{number}} has no crease pattern', { number })
              : t('panels:diagram.pages.titleBlock.noPattern', 'No step is linked to a crease pattern'),
        ];
      case 'model':
        return [
          step
            ? t('panels:diagram.pages.titleBlock.stepNoPicture', 'Step {{number}} has no picture yet', { number })
            : t('panels:diagram.pages.titleBlock.noModel', 'No step has a picture yet'),
        ];
      case 'credits':
        return [t('panels:diagram.pages.titleBlock.creditsCut', 'Some credits don’t fit')];
    }
  };
  const { x, y, w, h } = block.geometry.block;
  const at = (box: PageBox) => ({ left: px(box.x), top: px(box.y), width: px(box.w), height: px(box.h) });
  return (
    <>
      {/* The margin's guide draws the block's top and sides: its foot alone says where the steps begin. */}
      <PageGuide
        data-title-block=""
        edges="foot"
        style={{ left: px(x), top: px(y), right: px(paper.widthMm - x - w), bottom: px(paper.heightMm - y - h) }}
      />
      {missingTitleBlockParts(block, content, model).map(({ room, key, box, missing }) => (
        <PagePlaceholder
          key={key}
          kind={room === 'cut' ? 'cut' : 'part'}
          words={WORDS[room]}
          data-title-block-room={room}
          style={at(box)}
        >
          {missing.map((part) => (
            <span key={part.part} data-title-block-missing={part.part}>
              {words(part).map((line, index) => (
                <Fragment key={index}>
                  {index > 0 && <br />}
                  {line}
                </Fragment>
              ))}
            </span>
          ))}
        </PagePlaceholder>
      ))}
    </>
  );
}
