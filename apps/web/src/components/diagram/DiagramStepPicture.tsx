import { useRef, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Compass, Download, ImageOff, Link2, PenTool, RefreshCw, Rotate3d, Upload } from 'lucide-react';
import {
  diagramStepChoice,
  diagramStepCommand,
  type DiagramStepAction,
  type DiagramStepActionId,
} from '../../diagram/actions/diagramActions';
import type { DiagramLinkStatus } from '../../diagram/capture/linkStatus';
import type {
  DiagramCpSource,
  DiagramReferencesSource,
  DiagramStep,
  KnownDiagramAsset,
} from '../../diagram/document/diagramDocument';
import { cameraDegrees } from '../../diagram/pictures/cameraDegrees';
import type { SanitizeNotice } from '../../diagram/upload/svgSanitize';
import { useReturnFocusOnClose } from '../../hooks/useReturnFocusOnClose';
import { Button } from '../ui/Button';
import { FieldRow } from '../ui/fieldRows';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Notice } from '../ui/Notice';
import { DiagramSheetThumbnail } from './DiagramSheetThumbnail';
import styles from './DiagramStepPicture.module.css';

const VERBS: readonly { id: DiagramStepActionId; icon: typeof Upload; variant: 'secondary' | 'ghost' }[] = [
  { id: 'adjust-pose', icon: Rotate3d, variant: 'secondary' },
  { id: 'refresh-picture', icon: RefreshCw, variant: 'secondary' },
  { id: 'upload-picture', icon: Upload, variant: 'secondary' },
  { id: 'link-pattern', icon: Link2, variant: 'secondary' },
  { id: 'from-references', icon: Compass, variant: 'secondary' },
  { id: 'open-in-edit', icon: PenTool, variant: 'ghost' },
  { id: 'open-in-references', icon: Compass, variant: 'ghost' },
  { id: 'export-picture', icon: Download, variant: 'ghost' },
  { id: 'remove-picture', icon: ImageOff, variant: 'ghost' },
];

/**
 * The Step pane's Picture section: what the picture is — an upload, or a
 * pattern of the crease pattern and how it shows it — how a linked picture
 * stands against its pattern, what sanitizing changed in an upload, and the
 * picture verbs from the step's action catalog. The pattern picker, when the
 * step's pattern is being chosen, sits under them.
 */
export function DiagramStepPicture({
  step,
  asset,
  notices,
  actions,
  link,
  patternOpen,
  capture,
  waiting,
  picker,
  detailOpen,
}: {
  step: DiagramStep;
  /** The upload the step shows, or null for a step without one. */
  asset: KnownDiagramAsset | null;
  /** What sanitizing changed in this upload, when it was uploaded this session. */
  notices: readonly SanitizeNotice[];
  actions: readonly DiagramStepAction[];
  /** How the step's link stands; null for a step that is not linked. */
  link: DiagramLinkStatus | null;
  /** A crease pattern is open, so an unknown link is only waiting to be checked. */
  patternOpen: boolean;
  /** The step's capture while one runs, and its Stop when the fold can be stopped. */
  capture: { stop: (() => void) | null } | null;
  /** References' next Send to diagram fills this step (From References…), and the way to stop waiting. */
  waiting: { cancel: () => void } | null;
  /** The pattern picker, while the step's pattern is being chosen. */
  picker: ReactNode;
  /** The step is open in its detail, where Adjust pose would lead nowhere new. */
  detailOpen: boolean;
}) {
  const { t } = useTranslation();
  const source = step.source?.kind === 'cp' || step.source?.kind === 'references-step' ? step.source : null;
  // How a linked pattern is shown (D19), in Pose or not.
  const showAs = diagramStepChoice(actions, 'show-as');
  // A pick or Cancel closes the picker, or the waiting notice, under the
  // focus: back to the verb that opened it.
  const section = useRef<HTMLDivElement | null>(null);
  useReturnFocusOnClose(Boolean(picker), section, '[data-verb="link-pattern"]');
  useReturnFocusOnClose(Boolean(waiting), section, '[data-verb="from-references"]');
  return (
    <div ref={section} className={styles.picture}>
      <FieldRow label={t('panels:diagram.picture.source', 'Source')} kind="text">
        {source?.kind === 'references-step'
          ? describeSent(source, step.picture, t)
          : source
            ? describeLinked(source, step.picture !== null, t)
            : asset
            ? describeAsset(asset, t)
            : t('panels:diagram.picture.none', 'No picture yet')}
      </FieldRow>
      {showAs && (
        // Its own row under its label: the three ways are too wide to sit
        // beside it in a pane this narrow, and cut short they say nothing.
        <div className={styles.showAs} title={showAs.hint}>
          <span className={styles.showAsLabel} aria-hidden="true">
            {t('panels:diagram.picture.showAs', 'Show as')}
          </span>
          <SegmentedControl
            size="sm"
            fill
            aria-label={t('panels:diagram.picture.showAs', 'Show as')}
            value={showAs.options.find((option) => option.checked)?.id ?? null}
            disabled={showAs.disabled}
            options={showAs.options.map((option) => ({ value: option.id, label: option.label }))}
            onChange={(way) => showAs.options.find((option) => option.id === way)?.run()}
          />
        </div>
      )}
      {source?.kind === 'cp' && source.render.mode === 'folded-3d' && step.picture !== null && (
        <FieldRow label={t('panels:diagram.picture.view', 'View')} kind="text">
          {t('panels:diagram.pose.cameraReadout', 'Yaw {{yaw}}° · Pitch {{pitch}}°', { ...cameraDegrees(source.render.camera) })}
        </FieldRow>
      )}
      {source && (
        <FieldRow label={t('panels:diagram.picture.pattern', 'Pattern')} kind="text">
          <span className={styles.pattern}>
            <span className={styles.patternThumb}>
              <DiagramSheetThumbnail thumbnail={source.thumbnail} />
            </span>
            <span data-link={capture ? 'capturing' : (link ?? undefined)}>
              {capture
                ? t('panels:diagram.picture.capturing', 'Capturing…')
                : source.kind === 'references-step'
                  ? sentSentence(link ?? 'unknown', patternOpen, t)
                  : linkSentence(link ?? 'unknown', patternOpen, t)}
            </span>
          </span>
        </FieldRow>
      )}
      {source && step.picture?.kind === 'fixed' && (
        <div className={styles.notice}>
          <Notice>
            {t(
              'panels:diagram.picture.noLayerOrder',
              'Its layers couldn’t be put in order, so it shows the folded paper see-through.'
            )}
          </Notice>
        </div>
      )}
      {waiting && (
        <div className={styles.notice}>
          <Notice>
            {t(
              'panels:diagram.picture.waitingReferences',
              'Waiting for References: the next step sent to the diagram fills this one.'
            )}{' '}
            <Button size="sm" variant="ghost" onClick={waiting.cancel}>
              {t('panels:diagram.picture.cancelWaiting', 'Cancel')}
            </Button>
          </Notice>
        </div>
      )}
      {capture?.stop && (
        <div className={styles.verbs}>
          <Button size="sm" variant="secondary" onClick={capture.stop}>
            {t('panels:diagram.picture.stop', 'Stop')}
          </Button>
        </div>
      )}
      {notices.length > 0 && (
        <div className={styles.notice}>
          <Notice tone="warning">
            <strong>{t('panels:diagram.picture.simplified', 'This picture was simplified.')}</strong>{' '}
            {notices.map((notice) => noticeSentence(notice, t)).join(' ')}
          </Notice>
        </div>
      )}
      <div className={styles.verbs}>
        {VERBS.map(({ id, icon: Icon, variant }) => {
          const command = diagramStepCommand(actions, id);
          if (!command || (detailOpen && id === 'adjust-pose')) return null;
          return (
            <Button
              key={id}
              size="sm"
              variant={variant}
              disabled={command.disabled}
              title={command.hint}
              data-verb={id}
              onClick={command.run}
            >
              <Icon size={14} aria-hidden="true" />
              {command.label}
            </Button>
          );
        })}
      </div>
      {picker}
    </div>
  );
}

/** What a linked picture shows of its pattern, or that it waits to be posed. */
function describeLinked(source: DiagramCpSource, posed: boolean, t: TFunction): string {
  if (!posed) return t('panels:diagram.picture.linkedUnposed', 'A pattern, not captured yet');
  const { render } = source;
  switch (render.mode) {
    case 'crease-pattern':
      return t('panels:diagram.picture.linkedCreasePattern', 'Crease pattern');
    case 'folded-flat':
      return render.side === 'back'
        ? t('panels:diagram.picture.linkedFoldedBack', 'Folded, from the back')
        : t('panels:diagram.picture.linkedFolded', 'Folded');
    case 'folded-3d':
      return t('panels:diagram.picture.linkedFolded3d', 'Folded, in 3D');
    case 'simulated':
      return render.foldPercent === 0
        ? t('panels:diagram.picture.linkedSimulatedFlat', 'Simulated, flat: Adjust Pose to fold it')
        : t('panels:diagram.picture.linkedSimulated', 'Simulated, {{percent}}% folded', {
            percent: Math.round(render.foldPercent),
          });
  }
}

/** What a step sent from References is: which card, and from which side of the paper it is shown. */
function describeSent(
  source: DiagramReferencesSource,
  picture: DiagramStep['picture'],
  t: TFunction
): string {
  const back = picture?.kind === 'step-diagram' && picture.mirrored;
  const card =
    source.card === null
      ? t('panels:diagram.picture.sentCard', 'A card from References')
      : source.mode === 'find'
        ? t('panels:diagram.picture.sentFind', 'Step {{number}} of a reference', { number: source.card })
        : t('panels:diagram.picture.sentSequence', 'Step {{number}} of the folding sequence', {
            number: source.card,
          });
  return back ? t('panels:diagram.picture.sentBack', '{{card}}, from the back', { card }) : card;
}

/** How the sheet a References step came from stands, in words: it is never refreshed (D6). */
function sentSentence(link: DiagramLinkStatus, patternOpen: boolean, t: TFunction): string {
  switch (link) {
    case 'current':
      return t('panels:diagram.picture.sentCurrent', 'Unchanged since this step was sent');
    case 'stale':
      return t('panels:diagram.picture.sentStale', 'Pattern changed since this step was sent');
    case 'missing':
      return t('panels:diagram.picture.missing', 'Pattern missing');
    case 'unknown':
      return patternOpen
        ? t('panels:diagram.picture.checking', 'Checking…')
        : t('panels:diagram.picture.unknown', 'Not checked: the crease pattern isn’t open');
  }
}

/** How a link stands, in words. */
function linkSentence(link: DiagramLinkStatus, patternOpen: boolean, t: TFunction): string {
  switch (link) {
    case 'current':
      return t('panels:diagram.picture.current', 'Up to date');
    case 'stale':
      return t('panels:diagram.picture.stale', 'Out of date: the pattern changed');
    case 'missing':
      return t('panels:diagram.picture.missing', 'Pattern missing');
    case 'unknown':
      return patternOpen
        ? t('panels:diagram.picture.checking', 'Checking…')
        : t('panels:diagram.picture.unknown', 'Not checked: the crease pattern isn’t open');
  }
}

function describeAsset(asset: KnownDiagramAsset, t: TFunction): string {
  const size = { width: Math.round(asset.widthPx), height: Math.round(asset.heightPx) };
  return asset.kind === 'svg'
    ? t('panels:diagram.picture.svg', 'Uploaded SVG, {{width}} × {{height}} px', size)
    : t('panels:diagram.picture.raster', 'Uploaded image, {{width}} × {{height}} px', size);
}

function noticeSentence(notice: SanitizeNotice, t: TFunction): string {
  switch (notice) {
    case 'flowed-text':
      return t(
        'panels:diagram.picture.flowedText',
        'Flowed text isn’t supported and was left out: convert it to regular text, then replace the picture.'
      );
    case 'linked-image':
      return t(
        'panels:diagram.picture.linkedImage',
        'Linked images can’t be kept: embed them in the file, then replace the picture.'
      );
    case 'css-dropped':
      return t(
        'panels:diagram.picture.cssDropped',
        'Some of its styling couldn’t be kept, so parts may look different.'
      );
    case 'text-font':
      return t(
        'panels:diagram.picture.textFont',
        'Its text is set in the diagram’s font, so it may look a little different.'
      );
    case 'unsupported':
      return t(
        'panels:diagram.picture.unsupported',
        'Some of its parts aren’t supported and were left out.'
      );
  }
}
