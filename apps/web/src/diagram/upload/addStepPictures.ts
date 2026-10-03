import { toast } from 'sonner';
import {
  trackDiagramPictureUploaded,
  trackDiagramStepAdded,
  type DiagramPictureUploadOutcome,
  type DiagramStepAddedVia,
} from '../../analytics';
import i18n from '../../i18n';
import { getFileService, type PickedFile } from '../../platform/fileService';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  randomDiagramId,
  type DiagramIdFactory,
  type KnownDiagramAsset,
} from '../document/diagramDocument';
import {
  importStepPicture,
  naturalFileOrder,
  type ImportDependencies,
  type ImportedPicture,
} from './importStepPicture';
import type { SanitizeNotice } from './svgSanitize';

/** What the picker offers. Anything else the browser decodes is still taken from a drop. */
export const STEP_PICTURE_EXTENSIONS = ['svg', 'png', 'jpg', 'jpeg', 'webp'];
const STEP_PICTURE_MIME_TYPES = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'];

/** How long an upload runs before it says it is working. */
const PROGRESS_DELAY_MS = 400;

export type StepPictureFailureReason = Extract<ImportedPicture, { ok: false }>['reason'];

export interface StepPictureUploadOptions {
  /** How the files arrived: picked (one, or a batch) or dropped. For analytics. */
  via: 'pick' | 'drop';
  /** Replace this step's picture with the first file, rather than adding steps. */
  replaceStepId?: string;
  /**
   * The step the insertion rule reads as selected: the selection at the
   * gesture, which the import must not lose to a click made while it reads.
   * The selection when the call is made, by default.
   */
  anchorStepId?: string | null;
  dependencies?: ImportDependencies;
  newId?: DiagramIdFactory;
}

export interface StepPictureUploadResult {
  /** The steps that got a picture. */
  stepIds: string[];
  /** The files that did not, by name — shown to the user, never sent anywhere. */
  failures: { name: string; reason: StepPictureFailureReason }[];
}

/**
 * Put uploaded files in the diagram (D7).
 *
 * Files are read and imported one at a time, in natural name order (step-2
 * before step-10), so a batch of large files is never in memory at once. The
 * ones that import are then added in one edit, under the insertion rule
 * (`addDiagramPictures`), or replace a step's picture. What sanitizing changed
 * in a picture's look is recorded for the Step pane to say; the files that
 * could not be added are named in one toast.
 *
 * Resolves `null` when nothing was attempted: no files, a read-only diagram,
 * or a diagram replaced while the files were being read — which drops them
 * rather than adding them to a project they were not meant for.
 */
export async function addStepPictures(
  files: readonly PickedFile[],
  options: StepPictureUploadOptions
): Promise<StepPictureUploadResult | null> {
  const store = useWorkspaceStore.getState;
  if (files.length === 0 || store().diagramReadOnly) return null;
  const loadId = store().diagramLoadId;
  // Read before anything is awaited: where the user meant, not where the
  // selection has wandered by the time the files are in.
  const anchorStepId =
    options.anchorStepId !== undefined ? options.anchorStepId : store().diagramSelectedStepId;
  const newId = options.newId ?? randomDiagramId;
  const replacing = options.replaceStepId;
  const ordered = replacing === undefined ? naturalFileOrder(files) : files.slice(0, 1);
  const via: DiagramStepAddedVia =
    options.via === 'drop' ? 'drop' : ordered.length > 1 ? 'batch' : 'grid';

  const assets: KnownDiagramAsset[] = [];
  const notices = new Map<string, SanitizeNotice[]>();
  const failures: StepPictureUploadResult['failures'] = [];
  const progress = showProgressLater(ordered.length);
  try {
    for (const file of ordered) {
      const id = newId('asset');
      const result = await importStepPicture(file, id, options.dependencies);
      trackDiagramPictureUploaded(result.format, uploadOutcome(result), result.fileBytes, ordered.length);
      if (!result.ok) {
        failures.push({ name: file.name, reason: result.reason });
        continue;
      }
      assets.push(assetFrom(id, result));
      if (result.notices.length > 0) notices.set(id, result.notices);
    }
  } finally {
    progress.done();
  }
  if (store().diagramLoadId !== loadId) return null;

  let stepIds: string[] = [];
  if (assets.length > 0) {
    if (replacing !== undefined) {
      if (store().setDiagramStepPicture(replacing, assets[0], { loadId })) stepIds = [replacing];
    } else {
      const added = store().addDiagramPictures(assets, { loadId, anchorStepId });
      if (added) {
        stepIds = added.stepIds;
        // A picture that filled an empty step added no step.
        if (!added.filled) for (const asset of assets) trackDiagramStepAdded(asset.kind, via);
      }
    }
    for (const [id, changes] of notices) store().noteDiagramPictureChanges(id, changes);
  }
  if (failures.length > 0) reportFailures(failures);
  return { stepIds, failures };
}

/**
 * Open the picker and add what is picked. Call it from the click itself: a
 * browser opens a file picker only inside a user gesture, so nothing may be
 * awaited before it.
 */
export async function pickStepPictures(
  options: Omit<StepPictureUploadOptions, 'via'> = {}
): Promise<StepPictureUploadResult | null> {
  const t = i18n.t;
  const anchorStepId =
    options.anchorStepId !== undefined
      ? options.anchorStepId
      : useWorkspaceStore.getState().diagramSelectedStepId;
  const files = await getFileService().openBinaryFiles({
    title:
      options.replaceStepId === undefined
        ? t('dialogs:diagram.uploadPicturesTitle', 'Upload pictures')
        : t('dialogs:diagram.replacePictureTitle', 'Replace picture'),
    extensions: STEP_PICTURE_EXTENSIONS,
    mimeTypes: STEP_PICTURE_MIME_TYPES,
    multiple: options.replaceStepId === undefined,
  });
  if (!files) return null;
  return addStepPictures(files, { ...options, anchorStepId, via: 'pick' });
}

function assetFrom(id: string, result: ImportedPicture & { ok: true }): KnownDiagramAsset {
  const { content, bytes } = result;
  return content.kind === 'svg'
    ? { id, kind: 'svg', svg: content.svg, widthPx: content.widthPx, heightPx: content.heightPx, bytes }
    : { id, kind: 'raster', src: content.src, widthPx: content.widthPx, heightPx: content.heightPx, bytes };
}

function uploadOutcome(result: ImportedPicture): DiagramPictureUploadOutcome {
  if (!result.ok) return result.reason;
  return result.notices.length > 0 ? 'flattened' : 'ok';
}

/**
 * A "working" toast, but only once an upload has taken long enough to need
 * one: most single pictures are in before it would have shown.
 */
function showProgressLater(count: number): { done: () => void } {
  let id: string | number | null = null;
  const timer = setTimeout(() => {
    id = toast.loading(
      i18n.t('toasts:diagram.uploadProgress', {
        count,
        defaultValue_one: 'Adding the picture…',
        defaultValue_other: 'Adding {{count}} pictures…',
      })
    );
  }, PROGRESS_DELAY_MS);
  return {
    done: () => {
      clearTimeout(timer);
      if (id !== null) toast.dismiss(id);
    },
  };
}

/** How many failed files a toast names before it counts the rest. */
const NAMED_FAILURES = 3;

function reportFailures(failures: StepPictureUploadResult['failures']): void {
  const t = i18n.t;
  const lines = failures
    .slice(0, NAMED_FAILURES)
    .map(({ name, reason }) =>
      t('toasts:diagram.uploadFailureLine', '{{name}}: {{reason}}', { name, reason: failureReason(reason) })
    );
  const rest = failures.length - NAMED_FAILURES;
  if (rest > 0) {
    lines.push(
      t('toasts:diagram.uploadFailureMore', {
        count: rest,
        defaultValue_one: 'and 1 more',
        defaultValue_other: 'and {{count}} more',
      })
    );
  }
  toast.error(
    t('toasts:diagram.uploadFailed', {
      count: failures.length,
      defaultValue_one: 'A picture couldn’t be added',
      defaultValue_other: '{{count}} pictures couldn’t be added',
    }),
    { description: lines.join(' · ') }
  );
}

export function failureReason(reason: StepPictureFailureReason): string {
  const t = i18n.t;
  switch (reason) {
    case 'too_large':
      return t('toasts:diagram.uploadTooLarge', 'it is too large');
    case 'rejected':
      return t('toasts:diagram.uploadRejected', 'it is not an SVG Ori Studio can read safely');
    case 'unsupported':
      return t('toasts:diagram.uploadUnsupported', 'it is not a picture');
    case 'unreadable':
      return t('toasts:diagram.uploadUnreadable', 'the picture could not be read');
  }
}
