import { Pin } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { LayoutPage } from '../../diagram/pages/diagramPageLayout';
import { printedFrameMm } from '../../diagram/pages/pagePictures';
import { partBox, type PageBox, type PagePart } from '../../diagram/pages/pagePlacement';
import { placementBlocker } from '../../diagram/document/stepPlace';
import { stepById } from '../../diagram/document/diagramDocument';
import type { usePagePlacement } from '../../diagram/pages/usePagePlacement';
import { composedPageUrl } from '../../diagram/pages/useDiagramPages';
import { PAGES_PX_PER_MM } from '../../diagram/pages/usePagesView';
import styles from './DiagramPagesPlacement.module.css';

export const PAGE_PLACEMENT_PAN_EXCLUDED = [styles.drag, styles.handle];

type Placement = ReturnType<typeof usePagePlacement>;
const mm = (value: number) => value * PAGES_PX_PER_MM;
const position = (box: PageBox): CSSProperties => ({
  left: mm(box.x),
  top: mm(box.y),
  width: mm(box.w),
  height: mm(box.h),
});

/** Screen-only selection, grips, home ghosts and the lifted SVG. None enters an export. */
export function DiagramPagesPlacement({
  page,
  index,
  placement,
  onOpen,
}: {
  page: LayoutPage;
  index: number;
  placement: Placement;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { draft, selected, part } = placement;
  const cell = page.cells.find((c) => c.stepId === selected);
  const document = useWorkspaceStore((s) => s.diagram);
  const step = document && selected ? stepById(document, selected) : null;
  const local = draft?.page === index ? draft : null;
  const editable = placement.enabled && step && !placementBlocker(step);
  const chosen = cell && part ? partBox(cell, part) : null;
  const baseCell = local?.cell ?? cell;
  const home = baseCell && part ? (part === 'frame' ? baseCell.homeMm : baseCell.homeParts?.[part]) : null;
  const moved = step?.place && part && step.place[part];
  const size = cell && step && document ? printedFrameMm(step, document.assets, document.style, cell) : null;
  const auto = baseCell?.placed?.auto;
  const autoSize =
    baseCell && step && document
      ? printedFrameMm(step, document.assets, document.style, auto ? { ...baseCell, ...auto } : baseCell)
      : null;
  const labels: Record<PagePart, string> = {
    frame: t('panels:diagram.placement.frame', 'Frame'),
    number: t('panels:diagram.placement.number', 'Number'),
    picture: t('panels:diagram.placement.picture', 'Picture'),
    text: t('panels:diagram.placement.text', 'Text'),
  };
  return (
    <>
      {local && <LiftedPicture draft={local} />}
      {page.cells
        .filter((c) => c.clashes?.length)
        .map((c) => (
          <div
            key={c.stepId}
            className={styles.clash}
            style={position(partBox(c, 'frame'))}
            data-placement-clash={c.stepId}
          >
            <span>{t('panels:diagram.placement.overlaps', 'Overlaps')}</span>
          </div>
        ))}
      {editable && cell && (
        <>
          {(['number', 'picture', 'text'] as const)
            .filter((p) => part !== 'frame' && (p !== 'text' || cell.text.lines.length > 0))
            .map((p) => (
              <div
                key={p}
                data-place-part={p}
                aria-hidden="true"
                className={`${styles.target} ${part === p ? styles.drag : ''}`}
                data-selected={part === p || undefined}
                style={position(partBox(cell, p))}
                onPointerDown={(event) => placement.start(event, index, local?.cell ?? cell, p)}
                onPointerMove={placement.move}
                onPointerUp={placement.end}
                onPointerCancel={placement.cancel}
                onClick={(event) => {
                  event.stopPropagation();
                  useWorkspaceStore.getState().selectDiagramPagesPart(p);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  onOpen(cell.stepId);
                }}
              />
            ))}
          {chosen && <div className={styles.selection} data-place-selection={part} style={position(chosen)} />}
          {part === 'picture' &&
            chosen &&
            (['left', 'middle', 'right'] as const).map((grip, i) => (
              <div
                key={grip}
                data-place-scale={grip}
                aria-hidden="true"
                className={styles.handle}
                style={{ left: mm(chosen.x + (chosen.w * i) / 2), top: mm(chosen.y + chosen.h) }}
                onPointerDown={(event) => placement.start(event, index, local?.cell ?? cell, 'picture', grip)}
                onPointerMove={placement.move}
                onPointerUp={placement.end}
                onPointerCancel={placement.cancel}
                onClick={(event) => event.stopPropagation()}
              />
            ))}
          {part === 'picture' && chosen && step.place?.scale && (
            <span className={styles.pin} style={{ left: mm(chosen.x), top: mm(chosen.y) }} aria-hidden="true">
              <Pin size={10} />
            </span>
          )}
          {home && chosen && (moved || local?.dx || local?.dy) && (
            <>
              <div className={styles.home} style={position(home)} />
              <svg className={styles.guide} aria-hidden="true">
                <line
                  x1={mm(home.x + home.w / 2)}
                  y1={mm(home.y + home.h / 2)}
                  x2={mm(chosen.x + chosen.w / 2)}
                  y2={mm(chosen.y + chosen.h / 2)}
                />
              </svg>
            </>
          )}
          {local && (local.dx !== 0 || local.dy !== 0 || local.factor !== 1) && (
            <>
              <div
                className={styles.chip}
                style={{ left: mm(chosen?.x ?? cell.cellMm.x), top: mm((chosen?.y ?? cell.cellMm.y) - 7) }}
              >
                {local.pointer?.size
                  ? t('panels:diagram.placement.dragSize', '{{mm}} mm · auto {{auto}} mm', {
                      mm: size?.toFixed(1),
                      auto: autoSize?.toFixed(1),
                    })
                  : `${labels[local.part]} · ${local.dx.toFixed(1)}, ${local.dy.toFixed(1)} mm`}
                {local.snap?.number && (
                  <> · {t('panels:diagram.placement.matchStep', '= step {{number}}', { number: local.snap.number })}</>
                )}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function LiftedPicture({ draft }: { draft: NonNullable<Placement['draft']> }) {
  const { base, cell, part, page, dx, dy, factor, pointer } = draft;
  const picture = partBox(cell, 'picture');
  const only = (part: PagePart) => composedPageUrl(base, page, { band: false, only: { stepId: cell.stepId, part } });
  if (!pointer?.size)
    return (
      <img
        alt=""
        draggable={false}
        className={styles.lifted}
        src={only(part)}
        style={{ transform: `translate(${mm(dx)}px, ${mm(dy)}px)` }}
      />
    );
  return (
    <>
      <img alt="" draggable={false} className={styles.lifted} src={only('number')} />
      <img
        alt=""
        draggable={false}
        className={styles.lifted}
        src={only('picture')}
        style={{
          transformOrigin: `${mm(picture.x + picture.w / 2)}px ${mm(picture.y)}px`,
          transform: `scale(${factor})`,
        }}
      />
      <img
        alt=""
        draggable={false}
        className={styles.lifted}
        src={only('text')}
        style={{ transform: `translateY(${mm(picture.h * (factor - 1))}px)` }}
      />
    </>
  );
}
