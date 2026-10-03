import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Download, ImageOff, Upload } from 'lucide-react';
import {
  diagramStepCommand,
  type DiagramStepAction,
  type DiagramStepActionId,
} from '../../diagram/actions/diagramActions';
import type { KnownDiagramAsset } from '../../diagram/document/diagramDocument';
import type { SanitizeNotice } from '../../diagram/upload/svgSanitize';
import { Button } from '../ui/Button';
import { FieldRow } from '../ui/fieldRows';
import { Notice } from '../ui/Notice';
import styles from './DiagramStepPicture.module.css';

const VERBS: readonly { id: DiagramStepActionId; icon: typeof Upload; variant: 'secondary' | 'ghost' }[] = [
  { id: 'upload-picture', icon: Upload, variant: 'secondary' },
  { id: 'export-picture', icon: Download, variant: 'ghost' },
  { id: 'remove-picture', icon: ImageOff, variant: 'ghost' },
];

/**
 * The Step pane's Picture section: what the picture is, what sanitizing changed
 * in it, and the picture verbs from the step's action catalog.
 */
export function DiagramStepPicture({
  asset,
  notices,
  actions,
}: {
  /** The step's picture, or null for a step without one. */
  asset: KnownDiagramAsset | null;
  /** What sanitizing changed in this upload, when it was uploaded this session. */
  notices: readonly SanitizeNotice[];
  actions: readonly DiagramStepAction[];
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.picture}>
      <FieldRow label={t('panels:diagram.picture.source', 'Source')} kind="text">
        {asset ? describeAsset(asset, t) : t('panels:diagram.picture.none', 'No picture yet')}
      </FieldRow>
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
    </div>
  );
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
