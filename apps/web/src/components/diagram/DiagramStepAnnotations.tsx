import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FlipVertical2, RotateCcw, RotateCwSquare, Trash2, type LucideIcon } from 'lucide-react';
import type { AnnotationAction, AnnotationActionId } from '../../diagram/annotate/annotationActions';
import { annotationKindLabel, lineTypeLabel } from '../../diagram/annotate/annotateTools';
import { DIAGRAM_LINE_TYPES, lineTypeOf, type DiagramLineType } from '../../diagram/annotate/lineTypes';
import { carriesText, LABEL_MAX_LENGTH } from '../../diagram/annotate/annotationModel';
import { onLabelFocusRequest, takeLabelFocus } from '../../diagram/annotate/labelFocus';
import { useStepAnnotations } from '../../diagram/annotate/useStepAnnotations';
import { primaryModifierLabel } from '../../lib/platform';
import type { DiagramStep, KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { shortcutLabelForAction } from '../../keyboard/shortcuts';
import { useShortcutResolution } from '../../store/shortcutStore';
import { Button } from '../ui/Button';
import { FieldRow, SegmentedRow, TextAreaRow, ToggleRow } from '../ui/fieldRows';
import { Notice } from '../ui/Notice';
import { DiagramAnnotationGlyph } from './DiagramAnnotateToolGlyph';
import { DiagramLineTypeMark } from './DiagramLineTypeMark';
import { SegmentedControl } from '../ui/SegmentedControl';
import { DiagramPathNodeControls } from './DiagramPathNodeControls';
import { DiagramWhiteArrowControls } from './DiagramWhiteArrowControls';
import styles from './DiagramStepAnnotations.module.css';

/** The icon of each of the catalog's verbs the annotation row shows (`annotationActions.ts`). */
const ACTION_ICONS: Readonly<Partial<Record<AnnotationActionId, LucideIcon>>> = {
  'flip-arc': FlipVertical2,
  'reset-path': RotateCcw,
  'turn-right-angle': RotateCwSquare,
  delete: Trash2,
};

/**
 * The Step pane's annotations (D13).
 *
 * Out of Annotate, how many the step has and the way in. In Annotate — where
 * the tool in hand says what it does in the tool window over the canvas
 * (`DiagramAnnotateToolWindow`) — the Snap switch (for a finger, which has
 * no ⌘ to hold), a notice when they were drawn on another picture, the list —
 * a press selects one, as a press on the canvas does — and the selected
 * one's own controls:
 * a label's or a callout's text, an arrow's Flip arc and Reset, a white
 * arrow's width and tail, a line's type, a rotation's turn, a turn-over's axis, Delete, and
 * in Edit Path a fold or white arrow's node verbs.
 */
export function DiagramStepAnnotations({ step }: { step: DiagramStep }) {
  const { t } = useTranslation();
  const annotations = useStepAnnotations(step);
  const { annotating, known, selected, editable } = annotations;

  if (!annotating) {
    if (step.picture === null && step.annotations.length === 0) return null;
    return (
      <div className={styles.summary}>
        <span>
          {step.annotations.length === 0
            ? t('panels:diagram.annotations.none', 'No annotations')
            : t('panels:diagram.annotations.count', '{{count}} annotations', {
                count: step.annotations.length,
                defaultValue_one: '{{count}} annotation',
              })}
        </span>
        <Button size="sm" variant="secondary" disabled={!editable} onClick={annotations.annotate}>
          {t('panels:diagram.annotations.annotate', 'Annotate')}
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.annotations}>
      <ToggleRow
        label={t('panels:diagram.annotations.snap', 'Snap to Picture')}
        help={t(
          'panels:diagram.annotations.snapHelp',
          'Circles, right angles’ corners, callouts’ points and the ends of lines snap to the picture’s points and to other annotations nearby. Hold {{modifier}} to put one down anywhere. Arrows go where they are drawn.',
          { modifier: primaryModifierLabel() }
        )}
        checked={annotations.snap}
        onChange={annotations.setSnap}
      />
      {annotations.outOfStep && (
        <div className={styles.notice}>
          <Notice tone="warning">
            <p className={styles.noticeText}>
              {t('panels:diagram.annotations.pictureChanged', 'The picture changed since these annotations were drawn.')}
            </p>
            <Button size="sm" variant="ghost" disabled={!editable} onClick={annotations.keep}>
              {t('panels:diagram.annotations.keep', 'Keep Them Here')}
            </Button>
          </Notice>
        </div>
      )}
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
      {known.length === 0 ? (
        <p className={styles.empty}>{t('panels:diagram.annotations.empty', 'Nothing drawn yet.')}</p>
      ) : (
        <ul className={styles.list} aria-label={t('panels:diagram.annotations.list', 'Annotations')}>
          {known.map((annotation) => (
            <li key={annotation.id}>
              <button
                type="button"
                className={styles.row}
                aria-pressed={annotation.id === selected?.id}
                onClick={() => annotations.select(annotation.id === selected?.id ? null : annotation.id)}
              >
                <DiagramAnnotationGlyph kind={annotation.kind} />
                <span className={styles.rowName}>
                  {carriesText(annotation.kind) && annotation.text
                    ? annotation.text
                    : annotationKindLabel(t, annotation.kind)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && <SelectedAnnotation annotation={selected} editable={editable} annotations={annotations} />}
    </div>
  );
}

/** The selected annotation's own controls, by its kind, and Delete. */
function SelectedAnnotation({
  annotation,
  editable,
  annotations,
}: {
  annotation: KnownDiagramAnnotation;
  editable: boolean;
  annotations: ReturnType<typeof useStepAnnotations>;
}) {
  const { t } = useTranslation();
  const resolution = useShortcutResolution();
  const field = useRef<HTMLTextAreaElement | null>(null);
  const { id } = annotation;

  // A label or a callout just put down on the canvas asks for its text (D8).
  useEffect(() => {
    const focus = () => {
      field.current?.focus();
      field.current?.select();
    };
    if (takeLabelFocus(id)) focus();
    return onLabelFocusRequest((requested) => {
      if (requested === id && takeLabelFocus(id)) focus();
    });
  }, [id]);

  const keyed = ({ label, shortcutId }: Pick<AnnotationAction, 'label' | 'shortcutId'>) => {
    const key = shortcutId ? shortcutLabelForAction(shortcutId, resolution) : undefined;
    return key ? `${label} (${key})` : label;
  };
  const nodeActions = annotations.actions.filter((action) => action.group === 'node');
  const lineType = lineTypeOf(annotation.kind);
  const typeName = t('panels:diagram.annotations.lineType', 'Type');

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
      {annotation.kind === 'white-arrow' && (
        <DiagramWhiteArrowControls
          annotation={annotation}
          editable={editable}
          onChange={(look) => annotations.setWhiteArrowLook(id, look)}
        />
      )}
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
      <FieldRow label={annotationKindLabel(t, annotation.kind)} kind="text">
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
