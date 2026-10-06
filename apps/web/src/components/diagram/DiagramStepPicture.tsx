import { useRef, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  Compass,
  Download,
  ImageOff,
  Link2,
  PenTool,
  RefreshCw,
  Replace,
  Rotate3d,
  RotateCcwSquare,
  RotateCw,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import {
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
import { ActionList, type ActionListItem } from '../ui/ActionList';
import { Notice } from '../ui/Notice';
import { DiagramSheetThumbnail } from './DiagramSheetThumbnail';
import styles from './DiagramStepPicture.module.css';

/** The picture's verbs, by what they are about: its pattern, then the picture itself. */
const PATTERN_VERBS: readonly { id: DiagramStepActionId; icon: LucideIcon }[] = [
  { id: 'adjust-pose', icon: Rotate3d },
  { id: 'refresh-picture', icon: RefreshCw },
  { id: 'link-pattern', icon: Link2 },
  { id: 'from-references', icon: Compass },
  { id: 'open-in-edit', icon: PenTool },
  { id: 'replace-from-references', icon: Replace },
  { id: 'open-in-references', icon: Compass },
];
const FILE_VERBS: readonly { id: DiagramStepActionId; icon: LucideIcon }[] = [
  { id: 'upload-picture', icon: Upload },
  { id: 'export-picture', icon: Download },
  { id: 'remove-picture', icon: ImageOff },
];
/** An empty step's: the ways to give it a picture. */
const WAYS_IN: readonly { id: DiagramStepActionId; icon: LucideIcon }[] = [
  { id: 'upload-picture', icon: Upload },
  { id: 'link-pattern', icon: Link2 },
  { id: 'from-references', icon: Compass },
];
/** Or to make it a turn instead (D24): the turn-over in Edit's Flip glyph, as Pose shows it. */
const TURN_INSTEAD: readonly { id: DiagramStepActionId; icon: LucideIcon }[] = [
  { id: 'make-turn-over', icon: RotateCcwSquare },
  { id: 'make-rotate', icon: RotateCw },
];

/**
 * The Step pane's Picture section: what the picture is — an upload, or a
 * pattern of the crease pattern and how it shows it — how a linked picture
 * stands against its pattern, what sanitizing changed in an upload, and the
 * picture verbs from the step's action catalog, one to a row: those about its
 * pattern, then those about the picture itself; an empty step's are the ways
 * to give it one, and to make it a turn instead (D24). A verb that cannot do anything for this step is left
 * out rather than shown dead — Refresh while the pattern row says it is up to
 * date, Adjust Pose in Pose. The pattern picker, when the step's pattern is
 * being chosen, sits under them.
 */
export function DiagramStepPicture({
  step,
  asset,
  notices,
  actions,
  link,
  patternOpen,
  capture,
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
  /** The pattern picker, while the step's pattern is being chosen. */
  picker: ReactNode;
  /** The step is open in its detail, where Adjust pose would lead nowhere new. */
  detailOpen: boolean;
}) {
  const { t } = useTranslation();
  const source = step.source?.kind === 'cp' || step.source?.kind === 'references-step' ? step.source : null;
  // A pick or Cancel closes the picker under the focus: back to the verb
  // that opened it.
  const section = useRef<HTMLDivElement | null>(null);
  useReturnFocusOnClose(Boolean(picker), section, '[data-action="link-pattern"]');
  const empty = step.source === null && step.picture === null;
  const items = (verbs: readonly { id: DiagramStepActionId; icon: LucideIcon }[]): ActionListItem[] =>
    verbs.flatMap(({ id, icon }) => {
      const command = diagramStepCommand(actions, id);
      if (!command) return [];
      if (id === 'adjust-pose' && detailOpen) return [];
      if (id === 'refresh-picture' && command.disabled) return [];
      return [
        {
          id,
          icon,
          label: command.label,
          disabled: command.disabled,
          hint: command.hint,
          tone: id === 'remove-picture' ? 'danger' : undefined,
          run: command.run,
        },
      ];
    });
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
      <ActionList
        aria-label={t('panels:diagram.picture.verbs', 'Picture actions')}
        groups={empty ? [items(WAYS_IN), items(TURN_INSTEAD)] : [items(PATTERN_VERBS), items(FILE_VERBS)]}
      />
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
      return render.side === 'back'
        ? t('panels:diagram.picture.linkedCreasePatternBack', 'Crease pattern, back color')
        : t('panels:diagram.picture.linkedCreasePattern', 'Crease pattern');
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
      return t('panels:diagram.picture.sentCurrent', 'Unchanged since this step was added');
    case 'stale':
      return t('panels:diagram.picture.sentStale', 'Pattern changed since this step was added');
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
