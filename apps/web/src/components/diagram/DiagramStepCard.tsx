import { forwardRef, useCallback, useId, useMemo, useRef, type ForwardedRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Compass,
  ImagePlus,
  Link2,
  Lock,
  PenLine,
  PenTool,
  Rotate3d,
  RotateCcwSquare,
  RotateCw,
  ScanSearch,
  Trash2,
  Upload,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import { turnCardWords, turnLabel, turnPlace, type TurnBetween } from '../../diagram/actions/diagramTurnActions';
import { turnGlyphSvg } from '../../diagram/annotate/turnGlyph';
import {
  isLockedStep,
  isLockedTurn,
  type DiagramAsset,
  type DiagramStep,
  type DiagramStyle,
  type DiagramTurn,
} from '../../diagram/document/diagramDocument';
import { linkedSourceOf, needsPose, type DiagramLinkStatus } from '../../diagram/capture/linkStatus';
import { stepPictureSource, type StepPictureSource } from '../../diagram/pictures/paintDiagramStep';
import { useStepPictureUrl } from '../../diagram/pictures/useStepPictureUrl';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { DiagramSheetThumbnail } from './DiagramSheetThumbnail';
import styles from './DiagramStepCard.module.css';
import { capturedStyleChange } from '../../diagram/pictures/lighting';

/**
 * One step in the Steps grid: its number and kind, its picture, and its
 * instruction.
 *
 * An `option` of the grid's listbox rather than a button: the grid is one
 * control, navigated with the arrows, and a screen reader announces it as a
 * list to choose from rather than a row of unrelated buttons. The grid moves
 * focus between cards as the selection moves (a roving tab stop), which is
 * what lets a screen reader follow it.
 *
 * An empty card's Upload… and Link…, a capture's Stop, and the Adjust pose
 * and Annotate buttons over a picture are a pointer's shortcuts, hidden from
 * assistive technology and out of the tab order: the same verbs are in the
 * card's menu and the Step pane, where a keyboard and a screen reader reach
 * them. The card names itself from its number, kind, how
 * its link stands and its instruction, so a shortcut's label is not read as
 * part of it.
 *
 * A linked step — to a pattern, or to a sheet's card pulled from References —
 * shows its pattern's thumbnail beside its kind, and says over its picture
 * when the pattern has changed or gone.
 *
 * Every card a diagram can change has a Delete over its well's corner, beside
 * Adjust pose and Annotate (D24), and an empty one offers to be a turn instead
 * of a step: Turn over and Rotate, beside the ways to give it a picture.
 */
export const DiagramStepCard = forwardRef<
  HTMLDivElement,
  {
    step: DiagramStep;
    assets: Readonly<Record<string, DiagramAsset>>;
    /** The pens a captured picture is painted in. */
    style: DiagramStyle;
    /** 1-based, as the page will print it. */
    number: number;
    selected: boolean;
    /** Whether this card is the grid's tab stop. */
    tabStop: boolean;
    /** A picture dragged over the grid would land on this card. */
    dropTarget: boolean;
    readOnly: boolean;
    onSelect: (stepId: string) => void;
    /** Open this step in detail. */
    onOpen: (stepId: string) => void;
    /** Pick a picture for this step. Called from the click itself. */
    onUpload: (stepId: string) => void;
    /** How the step's link stands; null for a step that is not linked. */
    link: DiagramLinkStatus | null;
    /** The pages cut the step's instruction with "…". */
    textCut: boolean;
    /**
     * An enlarged step (Revision 2): the number of the step its area is on,
     * or null once the area is gone; undefined for a step that is not enlarged.
     */
    enlargedFrom?: number | null;
    /** The step's capture while one runs, and whether its fold can be stopped. */
    capture: { stoppable: boolean } | null;
    /** A crease pattern is open to link an empty step to. */
    patternOpen: boolean;
    /** Choose a pattern for this step. */
    onLink: (stepId: string) => void;
    onStop: (stepId: string) => void;
    /** Fill this step from the References browser. */
    onFromReferences: (stepId: string) => void;
    /** Open this step in Pose or Annotate, from the buttons over its picture. */
    onOpenIn: (stepId: string, mode: 'pose' | 'annotate') => void;
    /** Go to Edit: an empty step's way to a pattern when none is open. */
    onGoToEdit: () => void;
    /** Make this empty step a turn in its place (D24). */
    onMakeTurn: (stepId: string, kind: 'turn-over' | 'rotate') => void;
    /** Delete this step, asking first when it holds work. */
    onDelete: (stepId: string) => void;
  }
>(function DiagramStepCard(
  {
    step,
    assets,
    style,
    number,
    selected,
    tabStop,
    dropTarget,
    readOnly,
    onSelect,
    onOpen,
    onUpload,
    link,
    textCut,
    enlargedFrom,
    capture,
    patternOpen,
    onLink,
    onStop,
    onFromReferences,
    onOpenIn,
    onGoToEdit,
    onMakeTurn,
    onDelete,
  },
  forwarded
) {
  const { t } = useTranslation();
  const labelId = useId();
  const own = useRef<HTMLDivElement | null>(null);
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      own.current = element;
      assignRef(forwarded, element);
    },
    [forwarded]
  );
  const locked = isLockedStep(step);
  const text = step.text.trim();
  const picture = stepPictureSource(step, assets);
  const url = useStepPictureUrl(own, step, assets, style);
  const linked = linkedSourceOf(step);
  const sent = linked?.kind === 'references-step';
  const restyled = capturedStyleChange(step, style);
  const chip = capture
    ? t('panels:diagram.card.capturing', 'Capturing…')
    : link === 'stale'
      ? // A step sent from References is never refreshed: its sheet changed, that is all.
        sent
        ? t('panels:diagram.card.patternChanged', 'Pattern changed')
        : needsPose(step)
          ? // Folded part way in the simulator: only Pose captures it again (D19).
            t('panels:diagram.card.stalePoseAgain', 'Out of date · Pose again')
          : t('panels:diagram.card.stale', 'Out of date')
      : link === 'missing'
        ? t('panels:diagram.card.missing', 'Pattern missing')
        : restyled === 'light'
          ? t('panels:diagram.card.lightingChanged', 'Lighting changed')
          : restyled === 'style'
            ? t('panels:diagram.card.styleChanged', 'Style changed')
            : textCut
            ? t('panels:diagram.card.textCut', 'Text doesn’t fit')
            : null;
  // A press must not take focus from the card's keys.
  const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      tabIndex={tabStop ? 0 : -1}
      aria-labelledby={`${labelId}-number ${labelId}-kind${chip ? ` ${labelId}-chip` : ''}${enlargedFrom !== undefined ? ` ${labelId}-enlarged` : ''} ${labelId}-text`}
      className={styles.card}
      data-selected={selected || undefined}
      data-drop-target={dropTarget || undefined}
      data-step-id={step.id}
      onClick={() => onSelect(step.id)}
      onDoubleClick={() => onOpen(step.id)}
    >
      <div className={styles.header}>
        <span id={`${labelId}-number`} className={styles.number}>
          {t('panels:diagram.card.number', 'Step {{number}}', { number })}
        </span>
        <span className={styles.kind}>
          {enlargedFrom !== undefined && !locked && (
            // Enlarged, and from which step's area (Revision 2): cards never draw across cards, so a chip, not
            // the arrow — in the header, beside the kind, where it covers none of the picture.
            <span className={styles.enlarged} data-enlarged-chip="">
              <ScanSearch size={11} aria-hidden="true" />
              <span id={`${labelId}-enlarged`}>
                {enlargedFrom === null
                  ? t('panels:diagram.card.enlarged', 'Enlarged')
                  : t('panels:diagram.card.enlargedFrom', 'Enlarged · {{number}}', { number: enlargedFrom })}
              </span>
            </span>
          )}
          {linked && (
            <span className={styles.pattern}>
              <DiagramSheetThumbnail thumbnail={linked.thumbnail} />
            </span>
          )}
          <span id={`${labelId}-kind`} className={styles.kindBadge}>
            <Badge tone="neutral">
              {locked ? t('panels:diagram.card.badgeNewer', 'Newer') : stepKindLabel(step, picture, t)}
            </Badge>
          </span>
        </span>
      </div>
      <div className={styles.well} data-picture={(picture !== null && !locked) || undefined}>
        {locked ? (
          <span className={styles.placeholder}>
            <Lock size={18} aria-hidden="true" />
            {t('panels:diagram.card.locked', 'Made with a newer Ori Studio')}
          </span>
        ) : picture ? (
          url && <img className={styles.picture} src={url} alt="" draggable={false} decoding="async" />
        ) : linked ? (
          <span className={styles.placeholder}>{t('panels:diagram.card.notCaptured', 'Not captured yet')}</span>
        ) : (
          <span className={styles.placeholder}>
            <ImagePlus size={18} aria-hidden="true" />
            {t('panels:diagram.card.noPicture', 'No picture yet')}
            {!readOnly && (
              <span className={styles.shortcuts}>
                <Button
                  size="sm"
                  variant="secondary"
                  tabIndex={-1}
                  aria-hidden="true"
                  onMouseDown={keepFocus}
                  onClick={() => onUpload(step.id)}
                >
                  <Upload size={13} aria-hidden="true" />
                  {t('panels:diagram.card.upload', 'Upload…')}
                </Button>
                {patternOpen && (
                  <Button
                    size="sm"
                    variant="secondary"
                    tabIndex={-1}
                    aria-hidden="true"
                    onMouseDown={keepFocus}
                    onClick={(event) => {
                      // The picker selects the step itself.
                      event.stopPropagation();
                      onLink(step.id);
                    }}
                  >
                    <Link2 size={13} aria-hidden="true" />
                    {t('panels:diagram.card.link', 'Link…')}
                  </Button>
                )}
                {!patternOpen && (
                  <Button
                    size="sm"
                    variant="ghost"
                    tabIndex={-1}
                    aria-hidden="true"
                    onMouseDown={keepFocus}
                    onClick={(event) => {
                      event.stopPropagation();
                      onGoToEdit();
                    }}
                  >
                    <PenTool size={13} aria-hidden="true" />
                    {t('panels:diagram.card.goToEdit', 'Go to Edit')}
                  </Button>
                )}
                {patternOpen && (
                  <Button
                    size="sm"
                    variant="secondary"
                    tabIndex={-1}
                    aria-hidden="true"
                    onMouseDown={keepFocus}
                    onClick={(event) => {
                      // It selects the step itself.
                      event.stopPropagation();
                      onFromReferences(step.id);
                    }}
                  >
                    <Compass size={13} aria-hidden="true" />
                    {t('panels:diagram.card.fromReferences', 'References…')}
                  </Button>
                )}
              </span>
            )}
            {!readOnly && (
              // Or no picture at all: the model turned over or round between two steps (D24).
              <span className={styles.turnWays}>
                <span className={styles.or}>{t('panels:diagram.card.orTurn', 'or a turn')}</span>
                <span className={styles.shortcuts}>
                  <Button
                    size="sm"
                    variant="ghost"
                    tabIndex={-1}
                    aria-hidden="true"
                    onMouseDown={keepFocus}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMakeTurn(step.id, 'turn-over');
                    }}
                  >
                    <RotateCcwSquare size={13} aria-hidden="true" />
                    {t('panels:diagram.card.turnOver', 'Turn over')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    tabIndex={-1}
                    aria-hidden="true"
                    onMouseDown={keepFocus}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMakeTurn(step.id, 'rotate');
                    }}
                  >
                    <RotateCw size={13} aria-hidden="true" />
                    {t('panels:diagram.card.rotate', 'Rotate')}
                  </Button>
                </span>
              </span>
            )}
          </span>
        )}
        {!readOnly && (
          <span className={styles.verbs}>
            {!locked && (picture !== null || linked !== null) && (
              <button
                type="button"
                className={styles.verb}
                title={t('panels:diagram.actions.adjustPose', 'Adjust Pose')}
                tabIndex={-1}
                aria-hidden="true"
                onMouseDown={keepFocus}
                onClick={(event) => {
                  // It selects the step itself, and a double-click must not open it twice.
                  event.stopPropagation();
                  onOpenIn(step.id, 'pose');
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <Rotate3d size={14} />
              </button>
            )}
            {!locked && picture !== null && (
              <button
                type="button"
                className={styles.verb}
                title={t('panels:diagram.actions.annotate', 'Annotate')}
                tabIndex={-1}
                aria-hidden="true"
                onMouseDown={keepFocus}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenIn(step.id, 'annotate');
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <PenLine size={14} />
              </button>
            )}
            <DeleteVerb
              label={t('panels:diagram.actions.delete', 'Delete Step')}
              onDelete={() => onDelete(step.id)}
            />
          </span>
        )}
        {chip && (
          <span className={styles.chip} data-tone={capture ? 'progress' : 'warning'}>
            <span id={`${labelId}-chip`}>{chip}</span>
            {capture?.stoppable && (
              <button
                type="button"
                className={styles.stop}
                tabIndex={-1}
                aria-hidden="true"
                onMouseDown={keepFocus}
                onClick={(event) => {
                  event.stopPropagation();
                  onStop(step.id);
                }}
              >
                {t('panels:diagram.card.stop', 'Stop')}
              </button>
            )}
          </span>
        )}
      </div>
      <p id={`${labelId}-text`} className={styles.instruction} data-empty={text === '' || undefined}>
        {text === '' ? t('panels:diagram.card.noInstruction', 'No instruction') : text}
      </p>
    </div>
  );
});

/**
 * A turn between two steps, in the Steps grid (D24): a card the size of a
 * step's, in its place in the order — its name where a step has its number,
 * a "No number" badge, the glyph a page prints for it, and how it turns and
 * where it prints. The cards around it keep their numbers. An option of the
 * grid's listbox as a step's card is, named by what it is and where; it opens
 * no detail. Its Delete is a pointer's shortcut, as a step's is.
 */
export const DiagramTurnCard = forwardRef<
  HTMLDivElement,
  {
    turn: DiagramTurn;
    /** The numbers of the steps either side; null at an end. */
    between: TurnBetween;
    /** The pens the glyph is drawn in, as a page draws it. */
    style: DiagramStyle;
    selected: boolean;
    tabStop: boolean;
    /** A picture dragged over the grid would land here: a new step after the turn. */
    dropTarget: boolean;
    readOnly: boolean;
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
  }
>(function DiagramTurnCard({ turn, between, style, selected, tabStop, dropTarget, readOnly, onSelect, onDelete }, ref) {
  const { t } = useTranslation();
  const locked = isLockedTurn(turn);
  const { title, how } = turnCardWords(turn, t);
  const where = turnPlace(between, t);
  const glyph = useMemo(() => {
    const svg = locked ? null : turnGlyphSvg(turn, style);
    return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
  }, [turn, style, locked]);
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      aria-label={turnLabel(turn, between, t)}
      tabIndex={tabStop ? 0 : -1}
      className={styles.card}
      data-selected={selected || undefined}
      data-drop-target={dropTarget || undefined}
      data-step-id={turn.id}
      data-turn-kind={locked ? 'locked' : turn.kind}
      onClick={() => onSelect(turn.id)}
    >
      <div className={styles.header}>
        <span className={styles.number}>{title}</span>
        <span className={styles.kind}>
          {/* Wrapped as a step's badge is, so the two headers are one height. */}
          <span className={styles.kindBadge}>
            <Badge tone="neutral">{t('panels:diagram.card.badgeNoNumber', 'No number')}</Badge>
          </span>
        </span>
      </div>
      <div className={styles.well} data-picture={!locked || undefined}>
        {glyph ? (
          <img className={styles.turnGlyph} src={glyph} alt="" draggable={false} />
        ) : (
          <span className={styles.placeholder}>
            <Lock size={18} aria-hidden="true" />
            {t('panels:diagram.card.lockedTurn', 'Made with a newer Ori Studio')}
          </span>
        )}
        {!readOnly && (
          <span className={styles.verbs}>
            <DeleteVerb label={t('panels:diagram.turns.delete', 'Delete Turn')} onDelete={() => onDelete(turn.id)} />
          </span>
        )}
      </div>
      <p className={styles.instruction}>
        {how}
        {where && <span className={styles.where}>{where}</span>}
      </p>
    </div>
  );
});

/**
 * A card's Delete, over its well's corner: a pointer's shortcut, as Adjust
 * pose and Annotate are — the card's menu, the Step pane and the Delete key
 * are the keyboard's.
 */
function DeleteVerb({ label, onDelete }: { label: string; onDelete: () => void }) {
  return (
    <button
      type="button"
      className={styles.verb}
      data-danger=""
      title={label}
      tabIndex={-1}
      aria-hidden="true"
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        // It must not select the card it is about to take away, nor open it on a
        // double-click — and the second click of one lands on whatever card took
        // this one's place, which it must not delete too.
        event.stopPropagation();
        if (event.detail > 1) return;
        onDelete();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <Trash2 size={14} />
    </button>
  );
}

/**
 * What the step is, for its badge: where a linked step comes from and how it
 * is shown, or what an upload is.
 */
function stepKindLabel(step: DiagramStep, picture: StepPictureSource | null, t: TFunction): string {
  if (step.source?.kind === 'references-step') return t('panels:diagram.card.badgeReferences', 'References');
  if (step.source?.kind === 'cp') {
    switch (step.source.render.mode) {
      case 'crease-pattern':
        return t('panels:diagram.card.badgeCreasePattern', 'Crease pattern');
      case 'folded-flat':
        return t('panels:diagram.card.badgeFolded', 'Folded');
      case 'folded-3d':
        return t('panels:diagram.card.badgeFolded3d', 'Folded · 3D');
      case 'simulated':
        return t('panels:diagram.card.badgeSimulated', 'Simulated · {{percent}}%', {
          percent: Math.round(step.source.render.foldPercent),
        });
    }
  }
  if (picture?.kind === 'asset') {
    return picture.asset.kind === 'svg'
      ? t('panels:diagram.card.badgeSvg', 'SVG')
      : t('panels:diagram.card.badgeImage', 'Image');
  }
  return t('panels:diagram.card.badgeEmpty', 'Empty');
}

function assignRef<T>(ref: ForwardedRef<T>, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}
