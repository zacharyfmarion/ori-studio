import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCwSquare, Trash2, type LucideIcon } from 'lucide-react';
import type { AnnotationAction, AnnotationActionId } from '../../diagram/annotate/annotationActions';
import { annotationLabel, lineTypeLabel } from '../../diagram/annotate/annotateTools';
import { DIAGRAM_LINE_TYPES, lineTypeOf, type DiagramLineType } from '../../diagram/annotate/lineTypes';
import { annotationInkColor } from '../../diagram/annotate/annotationPrimitives';
import {
  carriesColor,
  carriesText,
  CLOSE_UP_SCALE,
  CLOSE_UP_SCALE_STEP,
  closeUpScale,
  closeUpScaleWithin,
  DEFAULT_PLEAT_KINKS,
  isSolidArrow,
  LABEL_MAX_LENGTH,
  PLEAT_KINKS,
  pleatKinks,
} from '../../diagram/annotate/annotationModel';
import { useFieldFocusRequest } from '../../diagram/annotate/useFieldFocusRequest';
import { useStepAnnotations } from '../../diagram/annotate/useStepAnnotations';
import { DEFAULT_DIAGRAM_STYLE, type DiagramStep, type KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { marksTouchingWindow, viewOfStep } from '../../diagram/zoom/stepView';
import { useAreaSubtitle } from '../../diagram/zoom/useZoomControls';
import { frameSubtitle, areaStepOf } from '../../diagram/zoom/zoomActions';
import { ZOOM_FRAME_ID, zoomShapeOf } from '../../diagram/zoom/zoomModel';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { shortcutLabelForAction } from '../../keyboard/shortcuts';
import { useShortcutResolution } from '../../store/shortcutStore';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { FieldRow, NumberRow, SegmentedRow, TextAreaRow } from '../ui/fieldRows';
import { Notice } from '../ui/Notice';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Badge } from '../ui/Badge';
import { DiagramAnnotationGlyph, EnlargeGlyph, SolidArrowGlyph } from './DiagramAnnotateToolGlyph';
import { DiagramBehindControls } from './DiagramBehindControls';
import { DiagramColorSelect } from './DiagramColorSelect';
import { DiagramDivisionsControls } from './DiagramDivisionsControls';
import { DiagramLineTypeMark } from './DiagramLineTypeMark';
import { DiagramPathNodeControls } from './DiagramPathNodeControls';
import { DiagramTicksRow } from './DiagramTicksRow';
import { DiagramWhiteArrowControls } from './DiagramWhiteArrowControls';
import { DiagramZoomControls } from './DiagramZoomControls';
import styles from './DiagramLayers.module.css';

/** The icon of each of the catalog's verbs the annotation row shows (`annotationActions.ts`). */
const ACTION_ICONS: Readonly<Partial<Record<AnnotationActionId, LucideIcon>>> = {
  'flip-horizontal': FlipHorizontal2,
  'flip-vertical': FlipVertical2,
  'flip-arc': FlipVertical2,
  'reset-path': RotateCcw,
  'turn-right-angle': RotateCwSquare,
  delete: Trash2,
};

/**
 * The Layers pane's body (Zach, 2026-10-05): what is drawn on the step open in
 * Annotate, and the selected one's own controls — a notice when some were made
 * by a newer Ori Studio, which the list leaves out; the list, in the order they
 * were drawn, a press selecting one as a press on the canvas does; and under
 * it the selected one's text, turn, type, a solid line's colour (17a), ticks, equal divisions' parts,
 * offset, ticks and count, kinks, scale, white arrow look, place in the
 * folds, axis, Flip Horizontal and Vertical, its verbs
 * (Flip Arc, Reset, Turn 90°, Delete), and in Edit Path a fold or white
 * arrow's node verbs. The Snap switch and the notice that the picture changed
 * stay in the Step pane, with the step (`DiagramStepAnnotations`).
 *
 * An enlarged step's frame is its first row (Revision 2): selected, its
 * controls (`DiagramZoomControls`); a mark lying wholly outside its window,
 * which it keeps but sizes nothing by — and far off it, no longer draws — is
 * badged so. An enlarge area's row says which steps were enlarged from it.
 */
export function DiagramLayers({ step }: { step: DiagramStep }) {
  const { t } = useTranslation();
  const annotations = useStepAnnotations(step);
  const { known, selected, editable } = annotations;
  const selectedId = useWorkspaceStore((state) => state.diagramSelectedAnnotationId);
  const view = useMemo(() => viewOfStep(step), [step]);
  const frame = view.zoom;
  // The marks an enlarged step keeps but is not sized by: wholly outside its window (Zach, 2026-10-07).
  const outside = useMemo(() => {
    if (!view.window) return null;
    const touching = new Set(marksTouchingWindow(view.window, step.annotations).map((mark) => mark.id));
    return new Set(step.annotations.filter((mark) => !touching.has(mark.id)).map((mark) => mark.id));
  }, [view.window, step.annotations]);
  const frameSelected = frame !== null && selectedId === ZOOM_FRAME_ID;

  return (
    <div className={styles.layers}>
      {annotations.unknownCount > 0 && (
        <div className={styles.notice}>
          <Notice>
            {t(
              'panels:diagram.annotations.newer',
              'Some of this step’s annotations were made with a newer Ori Studio. They are kept, but not shown here.'
            )}
          </Notice>
        </div>
      )}
      {known.length === 0 && !frame ? (
        <p className={styles.empty}>{t('panels:diagram.annotations.empty', 'Nothing drawn yet.')}</p>
      ) : (
        <ul className={styles.list} aria-label={t('panels:diagram.layers.list', 'Layers')}>
          {frame && (
            <li>
              <FrameRow step={step} shape={frame.zoom.shape} selected={frameSelected} onSelect={annotations.select} />
            </li>
          )}
          {known.map((annotation) => (
            <li key={annotation.id}>
              <button
                type="button"
                className={styles.row}
                aria-pressed={annotation.id === selected?.id}
                onClick={() => annotations.select(annotation.id === selected?.id ? null : annotation.id)}
              >
                {isSolidArrow(annotation) ? (
                  <SolidArrowGlyph />
                ) : annotation.kind === 'zoom' ? (
                  <EnlargeGlyph shape={zoomShapeOf(annotation)} />
                ) : (
                  <DiagramAnnotationGlyph kind={annotation.kind} color={annotation.color} />
                )}
                <span className={styles.rowText}>
                  <span className={styles.rowName}>
                    {carriesText(annotation.kind) && annotation.text ? annotation.text : annotationLabel(t, annotation)}
                  </span>
                  {annotation.kind === 'zoom' && <AreaSubtitle area={annotation} />}
                  {/* Under its name, as a subtitle is: beside it, the badge took the row's width and cut the name off. */}
                  {outside?.has(annotation.id) && (
                    <span className={styles.rowBadge}>
                      <Badge tone="neutral">{t('panels:diagram.annotations.outsideFrame', 'Outside the enlarged frame')}</Badge>
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {frameSelected && (
        <div className={styles.selected}>
          <DiagramZoomControls step={step} target={FRAME_TARGET} />
        </div>
      )}
      {selected && <SelectedAnnotation step={step} annotation={selected} editable={editable} annotations={annotations} />}
    </div>
  );
}

const FRAME_TARGET = { kind: 'frame' } as const;

/**
 * An enlarged step's frame, as the first row of its list (Revision 2, Z10):
 * "Enlarged frame", and where it came from. Pressed, it selects the frame, as
 * a click on its boundary on the canvas does.
 */
function FrameRow({
  step,
  shape,
  selected,
  onSelect,
}: {
  step: DiagramStep;
  shape: 'circle' | 'rounded';
  selected: boolean;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const diagram = useWorkspaceStore((state) => state.diagram);
  const areaStep = useMemo(() => (diagram ? areaStepOf(diagram, step.id) : null), [diagram, step.id]);
  return (
    <button
      type="button"
      className={styles.row}
      aria-pressed={selected}
      data-zoom-frame-row=""
      onClick={() => onSelect(selected ? null : ZOOM_FRAME_ID)}
    >
      <EnlargeGlyph shape={shape} />
      <span className={styles.rowText}>
        <span className={styles.rowName}>{t('panels:diagram.annotations.enlargedFrame', 'Enlarged frame')}</span>
        <span className={styles.rowNote}>{frameSubtitle(t, areaStep)}</span>
      </span>
    </button>
  );
}

/** Which steps an area was enlarged on, under its row's name. */
function AreaSubtitle({ area }: { area: KnownDiagramAnnotation }) {
  const subtitle = useAreaSubtitle(area);
  return subtitle ? <span className={styles.rowNote}>{subtitle}</span> : null;
}

/** The selected annotation's own controls, by its kind, and Delete. */
function SelectedAnnotation({
  step,
  annotation,
  editable,
  annotations,
}: {
  step: DiagramStep;
  annotation: KnownDiagramAnnotation;
  editable: boolean;
  annotations: ReturnType<typeof useStepAnnotations>;
}) {
  const { t } = useTranslation();
  const resolution = useShortcutResolution();
  const { id } = annotation;
  // A label or a callout just put down on the canvas asks for its text (D8).
  const field = useFieldFocusRequest<HTMLTextAreaElement>(id, 'text');

  const keyed = ({ label, shortcutId }: Pick<AnnotationAction, 'label' | 'shortcutId'>) => {
    const key = shortcutId ? shortcutLabelForAction(shortcutId, resolution) : undefined;
    return key ? `${label} (${key})` : label;
  };
  const nodeActions = annotations.actions.filter((action) => action.group === 'node');
  const flipActions = annotations.actions.filter((action) => action.group === 'flip');
  const lineType = lineTypeOf(annotation.kind);
  const typeName = t('panels:diagram.annotations.lineType', 'Type');
  const colorName = t('panels:diagram.annotations.color', 'Color');
  const style = useWorkspaceStore((state) => state.diagram?.style ?? DEFAULT_DIAGRAM_STYLE);

  return (
    <div className={styles.selected}>
      {nodeActions.length > 0 && (
        <DiagramPathNodeControls
          actions={nodeActions}
          node={annotations.node}
          count={annotations.nodeCount}
          keyed={keyed}
        />
      )}
      {carriesText(annotation.kind) && (
        <TextAreaRow
          // One field per label or callout: a draft never carries over to the next one.
          key={id}
          label={t('panels:diagram.annotations.text', 'Text')}
          value={annotation.text ?? ''}
          rows={1}
          singleLine
          maxLength={LABEL_MAX_LENGTH}
          disabled={!editable}
          fieldRef={field}
          onCommit={(text, session) => annotations.setText(id, text, session)}
        />
      )}
      {annotation.kind === 'rotate' && annotation.rotate && (
        <>
          <SegmentedRow
            label={t('panels:diagram.annotations.turn', 'Turn')}
            value={annotation.rotate.amount}
            disabled={!editable}
            options={[
              { id: 'eighth', label: '1/8' },
              { id: 'quarter', label: '1/4' },
              { id: 'half', label: '1/2' },
            ]}
            onChange={(amount) =>
              annotations.setRotation(id, { ...annotation.rotate!, amount: amount as 'eighth' | 'quarter' | 'half' })
            }
          />
          <SegmentedRow
            label={t('panels:diagram.annotations.direction', 'Direction')}
            value={annotation.rotate.direction}
            disabled={!editable}
            options={[
              { id: 'cw', label: t('panels:diagram.annotations.clockwise', 'Clockwise') },
              { id: 'ccw', label: t('panels:diagram.annotations.counterclockwise', 'Counterclockwise') },
            ]}
            onChange={(direction) =>
              annotations.setRotation(id, { ...annotation.rotate!, direction: direction as 'cw' | 'ccw' })
            }
          />
        </>
      )}
      {lineType !== null && (
        <FieldRow label={typeName} kind="segmented" disabled={!editable}>
          <SegmentedControl<DiagramLineType>
            size="sm"
            iconsOnly
            aria-label={typeName}
            value={lineType}
            disabled={!editable}
            options={DIAGRAM_LINE_TYPES.map((type) => ({
              value: type,
              label: lineTypeLabel(t, type),
              tooltip: lineTypeLabel(t, type),
              icon: <DiagramLineTypeMark type={type} />,
            }))}
            onChange={(type) => annotations.setLineType(id, type)}
          />
        </FieldRow>
      )}
      {carriesColor(annotation.kind) && (
        // A solid line's colour (17a): the rail's select, on the mark.
        <FieldRow label={colorName} kind="select" disabled={!editable}>
          <DiagramColorSelect
            // One per mark: a pick still under way when another is selected ends with the select, its picker closing with its input, rather than going on to recolour the next one in the same undo step.
            key={id}
            variant="row"
            label={colorName}
            value={annotation.color ?? null}
            ink={annotationInkColor(style)}
            disabled={!editable}
            onChange={(color, pick) => annotations.setColor(id, color, pick)}
          />
        </FieldRow>
      )}
      {annotation.kind === 'angle-mark' && (
        <DiagramTicksRow value={annotation.ticks} disabled={!editable} onChange={(ticks) => annotations.setTicks(id, ticks)} />
      )}
      {annotation.kind === 'divisions' && (
        <DiagramDivisionsControls
          // One set of fields per mark: the next one's Parts, asked for as it is laid, shows its own count when it takes the focus.
          key={id}
          step={step}
          annotation={annotation}
          editable={editable}
          onParts={(parts) => annotations.setParts(id, parts)}
          onOffset={(offset) => annotations.setDivisionsOffset(id, offset)}
          onTicks={(ticks) => annotations.setTicks(id, ticks)}
          onNumbered={(numbered) => annotations.setNumbered(id, numbered)}
        />
      )}
      {annotation.kind === 'pleat-arrow' && (
        <NumberRow
          label={t('panels:diagram.annotations.kinks', 'Kinks')}
          value={annotation.kinks ?? DEFAULT_PLEAT_KINKS}
          min={1}
          max={PLEAT_KINKS.length}
          disabled={!editable}
          normalize={pleatKinks}
          onCommit={(kinks) => annotations.setKinks(id, pleatKinks(kinks))}
        />
      )}
      {annotation.kind === 'close-up' && (
        <NumberRow
          label={t('panels:diagram.annotations.scale', 'Scale')}
          value={closeUpScale(annotation)}
          min={CLOSE_UP_SCALE.min}
          max={CLOSE_UP_SCALE.max}
          step={CLOSE_UP_SCALE_STEP}
          suffix="×"
          disabled={!editable}
          normalize={closeUpScaleWithin}
          onCommit={(scale) => annotations.setCloseUpScale(id, scale)}
        />
      )}
      {annotation.kind === 'white-arrow' && (
        <DiagramWhiteArrowControls
          annotation={annotation}
          editable={editable}
          onChange={(look) => annotations.setWhiteArrowLook(id, look)}
        />
      )}
      {annotation.kind === 'zoom' && <DiagramZoomControls step={step} target={{ kind: 'area', area: annotation }} />}
      <DiagramBehindControls
        annotation={annotation}
        editable={editable}
        knowsFlaps={annotations.knowsFlaps}
        onEnd={(end, behind) => annotations.setBehind(id, end, behind)}
        onLayers={(layers) => annotations.setBehindLayers(id, layers)}
      />
      {annotation.kind === 'turn-over' && (
        <SegmentedRow
          label={t('panels:diagram.annotations.axis', 'Turns')}
          value={annotation.axis ?? 'vertical'}
          disabled={!editable}
          options={[
            { id: 'vertical', label: t('panels:diagram.annotations.sideToSide', 'Side to Side') },
            { id: 'horizontal', label: t('panels:diagram.annotations.topToBottom', 'Top to Bottom') },
          ]}
          onChange={(axis) => annotations.setAxis(id, axis as 'vertical' | 'horizontal')}
        />
      )}
      {flipActions.length > 0 && (
        // Two mirrors, side by side however narrow the pane: each named in full by its tooltip.
        <FieldRow label={t('panels:diagram.annotations.flipRow', 'Flip')} kind="text">
          <span className={styles.verbs}>
            {flipActions.map((action) => {
              const Icon = ACTION_ICONS[action.id]!;
              return (
                <IconButton
                  key={action.id}
                  size="sm"
                  title={keyed(action)}
                  aria-label={action.label}
                  aria-disabled={action.disabled || undefined}
                  onClick={() => {
                    if (!action.disabled) action.run();
                  }}
                >
                  <Icon size={14} aria-hidden="true" />
                </IconButton>
              );
            })}
          </span>
        </FieldRow>
      )}
      <FieldRow label={annotationLabel(t, annotation)} kind="text">
        <span className={styles.verbs}>
          {annotations.actions
            .filter((action) => action.group === 'annotation')
            .map((action) => {
              const Icon = ACTION_ICONS[action.id];
              return (
                <Button
                  key={action.id}
                  size="sm"
                  variant="ghost"
                  // Refusing keeps the focus: Reset Shape refuses once it has run.
                  aria-disabled={action.disabled || undefined}
                  title={keyed(action)}
                  onClick={() => {
                    if (!action.disabled) action.run();
                  }}
                >
                  {Icon && <Icon size={14} aria-hidden="true" />}
                  {action.label}
                </Button>
              );
            })}
        </span>
      </FieldRow>
    </div>
  );
}
