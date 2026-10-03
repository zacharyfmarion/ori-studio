import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FlipVertical2, Trash2 } from 'lucide-react';
import { annotateToolHelp, annotateToolLabel, annotationKindLabel } from '../../diagram/annotate/annotateTools';
import { LABEL_MAX_LENGTH, isArrowKind } from '../../diagram/annotate/annotationModel';
import { onLabelFocusRequest, takeLabelFocus } from '../../diagram/annotate/labelFocus';
import { useStepAnnotations } from '../../diagram/annotate/useStepAnnotations';
import type { DiagramStep, KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { shortcutLabelForAction } from '../../keyboard/shortcuts';
import { useShortcutResolution } from '../../store/shortcutStore';
import { Button } from '../ui/Button';
import { FieldRow, SegmentedRow, TextAreaRow } from '../ui/fieldRows';
import { Notice } from '../ui/Notice';
import { DiagramAnnotateToolGlyph } from './DiagramAnnotateToolGlyph';
import styles from './DiagramStepAnnotations.module.css';

/**
 * The Step pane's annotations (D13).
 *
 * Out of Annotate, how many the step has and the way in. In Annotate, the
 * tool in hand and what it does, a notice when they were drawn on another
 * picture, the list — a press selects one, as a press on the canvas does —
 * and the selected one's own controls: a label's text, an arrow's Flip arc,
 * a rotation's turn, a turn-over's axis, and Delete.
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
      <div className={styles.tool}>
        <span className={styles.toolName}>{annotateToolLabel(t, annotations.tool)}</span>
        <p className={styles.help}>{annotateToolHelp(t, annotations.tool)}</p>
      </div>
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
                <DiagramAnnotateToolGlyph tool={annotation.kind} />
                <span className={styles.rowName}>
                  {annotation.kind === 'label' && annotation.text
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

  // A label just put down on the canvas asks for its text (D8).
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

  const keyed = (label: string, shortcut: Parameters<typeof shortcutLabelForAction>[0]) => {
    const key = shortcutLabelForAction(shortcut, resolution);
    return key ? `${label} (${key})` : label;
  };

  return (
    <div className={styles.selected}>
      {annotation.kind === 'label' && (
        <TextAreaRow
          // One field per label: a draft never carries over to the next one.
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
          {isArrowKind(annotation.kind) && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!editable}
              title={keyed(t('tools:diagram.flipArc', 'Flip Arc'), 'diagram.flipArc')}
              onClick={() => annotations.flip(id)}
            >
              <FlipVertical2 size={14} aria-hidden="true" />
              {t('tools:diagram.flipArc', 'Flip Arc')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={!editable}
            title={keyed(t('panels:diagram.annotations.delete', 'Delete'), 'edit.delete')}
            onClick={() => annotations.remove(id)}
          >
            <Trash2 size={14} aria-hidden="true" />
            {t('panels:diagram.annotations.delete', 'Delete')}
          </Button>
        </span>
      </FieldRow>
    </div>
  );
}
