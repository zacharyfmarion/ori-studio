import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Download, ImageOff, Link2, RefreshCw, Upload } from 'lucide-react';
import {
  diagramStepCommand,
  type DiagramStepAction,
  type DiagramStepActionId,
} from '../../diagram/actions/diagramActions';
import type { DiagramLinkStatus } from '../../diagram/capture/linkStatus';
import type {
  DiagramCpSource,
  DiagramStep,
  KnownDiagramAsset,
} from '../../diagram/document/diagramDocument';
import type { SanitizeNotice } from '../../diagram/upload/svgSanitize';
import { Button } from '../ui/Button';
import { FieldRow } from '../ui/fieldRows';
import { Notice } from '../ui/Notice';
import { DiagramSheetThumbnail } from './DiagramSheetThumbnail';
import styles from './DiagramStepPicture.module.css';

const VERBS: readonly { id: DiagramStepActionId; icon: typeof Upload; variant: 'secondary' | 'ghost' }[] = [
  { id: 'refresh-picture', icon: RefreshCw, variant: 'secondary' },
  { id: 'upload-picture', icon: Upload, variant: 'secondary' },
  { id: 'link-pattern', icon: Link2, variant: 'secondary' },
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
  picker,
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
}) {
  const { t } = useTranslation();
  const source = step.source?.kind === 'cp' ? step.source : null;
  return (
    <div className={styles.picture}>
      <FieldRow label={t('panels:diagram.picture.source', 'Source')} kind="text">
        {source
          ? describeLinked(source, step.picture !== null, t)
          : asset
            ? describeAsset(asset, t)
            : t('panels:diagram.picture.none', 'No picture yet')}
      </FieldRow>
      {source && (
        <FieldRow label={t('panels:diagram.picture.pattern', 'Pattern')} kind="text">
          <span className={styles.pattern}>
            <span className={styles.patternThumb}>
              <DiagramSheetThumbnail thumbnail={source.thumbnail} />
            </span>
            <span data-link={capture ? 'capturing' : (link ?? undefined)}>
              {capture
                ? t('panels:diagram.picture.capturing', 'Capturing…')
                : linkSentence(link ?? 'unknown', patternOpen, t)}
            </span>
          </span>
        </FieldRow>
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
          if (!command) return null;
          return (
            <Button
              key={id}
              size="sm"
              variant={variant}
              disabled={command.disabled}
              title={command.hint}
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
    case 'unsupported':
      return t(
        'panels:diagram.picture.unsupported',
        'Some of its parts aren’t supported and were left out.'
      );
  }
}
