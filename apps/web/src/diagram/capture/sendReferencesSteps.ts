/**
 * Send to diagram, from References (D6): cards of the step strip become
 * diagram steps — each a snapshot of its card's picture, its sentence as the
 * instruction, and where it came from.
 *
 * Where it came from is the sheet, found again in the segmentation every
 * Diagram link is made in (D3): the precrease component's outline is matched
 * by its rim to a region, and the region's creases fingerprinted, so editing
 * another sheet never reads as a change to this one. The planner's sheets and
 * the Diagram's regions are both the border loops of the pattern, and match
 * one for one on every file tried; a sheet that matches no region is still
 * sent, and its link says its pattern cannot be found.
 */
import { toast } from 'sonner';
import {
  trackDiagramStepAdded,
  trackReferencesStepSentToDiagram,
  type ReferencesSentToDiagramVia,
} from '../../analytics';
import { ensureCpSegmentationArtifacts } from '../../cp-workspace/cpSegmentationArtifacts';
import type { ReferencesDiagramCard } from '../../cp-workspace/references/referencesDiagramCards';
import { regionReferenceFor, resolveRegion, type RegionReference } from '../../cp-workspace/regions/regionReference';
import { fitSheetThumbnail, type SheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import i18n from '../../i18n';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  stepDiagramKey,
  stepIndex,
  type ReferencesPlanSettings,
  type SentReferencesStep,
} from '../document/diagramDocument';
import { storedReferencesSource } from '../document/diagramFile';
import { storedStepDiagramModel } from '../document/stepDiagramModelFile';
import { digest } from '../pictures/pictureKey';
import { chooseStepCreases } from './captureCreases';
import { creasesThumbnail } from './captureThumbnail';
import { abandonOnEngineLoss } from './engineLoss';

/** What References hands over. */
export interface ReferencesSend {
  cards: readonly ReferencesDiagramCard[];
  /** The sheet's model-space corners (`PrecreaseComponent.outline`). */
  outline: readonly (readonly [number, number])[];
  mode: 'sequence' | 'find';
  /** The plan's settings, for a sequence; null in Find. */
  settings: ReferencesPlanSettings | null;
  /** One card, or every card of the strip. */
  via: ReferencesSentToDiagramVia;
}

/** What became of a send. */
export type ReferencesSendOutcome =
  | { status: 'sent'; stepIds: string[]; filled: boolean }
  | { status: 'no-pattern' }
  | { status: 'read-only' }
  /** A card too large for the file to read back: nothing was sent. */
  | { status: 'too-large' }
  /**
   * The pattern's regions could not be worked out (the engine was not ready,
   * or restarted): nothing was sent, since a step whose sheet was never found
   * would be stored with no creases to compare and later say it changed.
   */
  | { status: 'unknown' }
  /** The diagram was replaced while the sheet was being found. */
  | { status: 'discarded' };

/**
 * Send cards to the diagram as one undo step, and say where they went: into
 * the step From References… waits for, or after the diagram's selected step,
 * or at the end. References stays on screen; the toast offers the Diagram.
 */
export async function sendReferencesToDiagram(send: ReferencesSend): Promise<ReferencesSendOutcome> {
  const outcome = await sendCards(send);
  say(outcome, send);
  return outcome;
}

async function sendCards(send: ReferencesSend): Promise<ReferencesSendOutcome> {
  const start = useWorkspaceStore.getState();
  if (start.diagramReadOnly) return { status: 'read-only' };
  const document = start.oristudioCpDocument?.document;
  if (!document) return { status: 'no-pattern' };
  const loadId = start.diagramLoadId;
  const segmentation = await abandonOnEngineLoss(ensureCpSegmentationArtifacts(document)).catch(() => null);
  if (!segmentation) return { status: 'unknown' };

  // The sheet, as the Diagram finds regions: by its rim.
  const outline: RegionReference = {
    boundary: [send.outline.map(([x, y]) => ({ x, y }))],
    bounds: boundsOf(send.outline),
    segmentIdHint: null,
  };
  const segment = resolveRegion(outline, resolveCpSegments(segmentation));
  const region = segment ? regionReferenceFor(segment) : outline;
  const choice = segment ? chooseStepCreases(document, { kind: 'segment', region }, segmentation) : null;
  const creases = choice?.status === 'found' ? choice.creases : null;
  const thumbnail = creases ? creasesThumbnail(document, creases, segmentation) : outlineThumbnail(send.outline);

  const sent: SentReferencesStep[] = [];
  for (const card of send.cards) {
    const model = storedStepDiagramModel(card.model);
    const source = storedReferencesSource({
      kind: 'references-step',
      region,
      fingerprint: creases?.drawnFingerprint ?? null,
      thumbnail,
      mode: send.mode,
      settings: send.settings,
      card: card.card,
      line: card.line,
      side: card.mirrored ? 'back' : 'front',
    });
    if (!model || !source) return { status: 'too-large' };
    const key = stepDiagramKey(`steps-${digest(JSON.stringify(model))}`, card.mirrored);
    sent.push({ source, picture: { kind: 'step-diagram', model, mirrored: card.mirrored, key }, text: card.sentence });
  }

  const state = useWorkspaceStore.getState();
  const target = state.diagramReferencesTarget;
  const label = sent.length === 1 ? 'Send to diagram' : 'Send steps to diagram';
  const stepIds = state.addReferencesDiagramSteps(sent, { loadId, label });
  if (!stepIds) return useWorkspaceStore.getState().diagramReadOnly ? { status: 'read-only' } : { status: 'discarded' };
  return { status: 'sent', stepIds, filled: target !== null && stepIds[0] === target };
}

/** Count the send, say where it went, and offer the way to it. */
function say(outcome: ReferencesSendOutcome, send: ReferencesSend): void {
  const t = i18n.t;
  switch (outcome.status) {
    case 'sent': {
      trackReferencesStepSentToDiagram(send.mode, send.via, outcome.stepIds.length, outcome.filled);
      // A step that was filled was there already: only the new ones are added.
      const added = outcome.stepIds.length - (outcome.filled ? 1 : 0);
      for (let index = 0; index < added; index += 1) trackDiagramStepAdded('references', 'references');
      const diagram = useWorkspaceStore.getState().diagram;
      const numbers = diagram ? outcome.stepIds.map((stepId) => stepIndex(diagram, stepId) + 1) : [];
      const first = numbers[0] ?? 0;
      const last = numbers[numbers.length - 1] ?? first;
      const message =
        numbers.length === 1
          ? outcome.filled
            ? t('toasts:diagram.references.filledStep', 'Sent to step {{number}}', { number: first })
            : t('toasts:diagram.addedAsStep', 'Added as step {{number}}', { number: first })
          : t('toasts:diagram.references.addedSteps', 'Added as steps {{first}}–{{last}}', { first, last });
      const selected = outcome.stepIds[outcome.stepIds.length - 1]!;
      toast.success(message, {
        action: {
          label: t('toasts:diagram.openDiagram', 'Open diagram'),
          onClick: () => {
            useWorkspaceStore.getState().selectDiagramStep(selected);
            useLayoutStore.getState().activateWorkspace('diagram');
          },
        },
      });
      return;
    }
    case 'read-only':
      toast.error(
        t(
          'toasts:diagram.capture.readOnly',
          'This diagram was made with a newer Ori Studio and opens read-only.'
        )
      );
      return;
    case 'no-pattern':
      toast.error(t('toasts:diagram.capture.noPattern', 'Open a crease pattern in Edit first.'));
      return;
    case 'unknown':
      toast.error(
        t('toasts:diagram.capture.unknown', 'The crease pattern isn’t ready yet. Try again in a moment.')
      );
      return;
    case 'too-large':
      toast.error(
        t('toasts:diagram.references.tooLarge', 'This step is too detailed to keep in the diagram.')
      );
      return;
    case 'discarded':
      return;
  }
}

function boundsOf(points: readonly (readonly [number, number])[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/** A sheet no region matches, drawn as its outline: all there is of it to show. */
function outlineThumbnail(outline: readonly (readonly [number, number])[]): SheetThumbnail {
  const strokes = outline.map(([x1, y1], index) => {
    const [x2, y2] = outline[(index + 1) % outline.length]!;
    return { x1, y1, x2, y2, role: 'edge' as const };
  });
  return fitSheetThumbnail(strokes) ?? { viewBox: '0 0 100 100', strokes: [] };
}
