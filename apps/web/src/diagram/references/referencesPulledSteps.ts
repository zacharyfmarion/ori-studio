/**
 * Cards pulled from the References browser into the diagram (D20): each a
 * snapshot of its card's picture, its sentence as the instruction, and where
 * it came from (D6) — the sheet, found again in the segmentation every
 * Diagram link is made in (D3), and the plan and way it was drawn from. A
 * turn-over card is pulled as a turn between steps, unnumbered (D22).
 *
 * The card is split as it is pulled (17d): its paper is the step's picture,
 * and its folds, reference lines, rings, letters and arrows the step's
 * annotations — those the browser's Show menu shows — so they can be edited.
 * A card with more marks than a step holds is pulled whole, as every card was
 * before, and the toast says so.
 */
import { toast } from 'sonner';
import {
  trackDiagramPicturePosed,
  trackDiagramStepAdded,
  trackDiagramStepsPulledFromReferences,
  trackDiagramTurnAdded,
  type DiagramPulledInto,
} from '../../analytics';
import { ensureCpSegmentationArtifacts } from '../../cp-workspace/cpSegmentationArtifacts';
import type { ReferencesDiagramCard } from '../../cp-workspace/references/referencesDiagramCards';
import { regionReferenceFor, resolveRegion, type RegionReference } from '../../cp-workspace/regions/regionReference';
import { fitSheetThumbnail, type SheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import i18n from '../../i18n';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { DEFAULT_PAPER_EXPORT_MARKS, type PaperExportMarks } from '../../lib/paperExportSettings';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { editedCardMarksGone } from '../document/cardMarks';
import {
  anchorTakesCard,
  DEFAULT_DIAGRAM_STYLE,
  stepById,
  stepDiagramKey,
  stepIndex,
  stepNumber,
  type DiagramDocument,
  type DiagramPullAnchor,
  type DiagramStepDiagramPicture,
  type ReferencesPlanSettings,
  type SentReferencesEntry,
} from '../document/diagramDocument';
import { storedReferencesSource } from '../document/diagramFile';
import { storedStepDiagramModel } from '../document/stepDiagramModelFile';
import { digest } from '../pictures/pictureKey';
import { chooseStepCreases } from '../capture/captureCreases';
import { creasesThumbnail } from '../capture/captureThumbnail';
import { abandonOnEngineLoss } from '../capture/engineLoss';
import { replacedEdited, undoNewest } from './cardMarksToast';
import { liftedCardPicture } from './referencesCardMarks';
import type { ReferencesStepWay } from './referencesStepWays';

/**
 * A card's picture as a step keeps it: its model as the file reads it back,
 * keyed by its content and side. Null for one too large to keep.
 */
export function referencesCardPicture(card: ReferencesDiagramCard): DiagramStepDiagramPicture | null {
  const model = storedStepDiagramModel(card.model);
  if (!model) return null;
  const key = stepDiagramKey(`steps-${digest(JSON.stringify(model))}`, card.mirrored);
  return { kind: 'step-diagram', model, mirrored: card.mirrored, key };
}

/** One card to pull, and the way its fold is made by, when it has a choice. */
export interface PulledCard {
  card: ReferencesDiagramCard;
  picture: DiagramStepDiagramPicture;
  way: string | null;
}

/** What the browser pulls. */
export interface ReferencesPull {
  cards: readonly PulledCard[];
  /** The sheet's model-space corners (`PrecreaseComponent.outline`). */
  outline: readonly (readonly [number, number])[];
  mode: 'sequence' | 'find';
  /** The plan's settings, for a sequence; null in Find. */
  settings: ReferencesPlanSettings | null;
  /** The plan's cache key id, for a sequence; null in Find. */
  plan: string | null;
  anchor: DiagramPullAnchor;
  /** The browser's opening the pull was pressed in (`DiagramReferencesBrowserState.opening`). */
  opening?: number;
  /** Which of each card's marks are pulled (17d, the Show menu); absent, every one. */
  marks?: PaperExportMarks;
}

/** What became of a pull. */
export type ReferencesPullOutcome =
  /**
   * Added; `into` says where the cards went, which the anchor may not have
   * been able to take. `baked`, the steps whose card's marks are more than a
   * step holds, pulled whole; `replaced`, the marks the author had edited that
   * went with a replaced step's old card (17d).
   */
  | { status: 'pulled'; stepIds: string[]; turnIds: string[]; into: DiagramPulledInto; baked: string[]; replaced: number }
  | { status: 'no-pattern' }
  | { status: 'read-only' }
  /** A card too large for the file to read back: nothing was added. */
  | { status: 'too-large' }
  /** The pattern's regions could not be worked out: nothing was added (D6). */
  | { status: 'unknown' }
  /** The diagram was replaced while the sheet was being found. */
  | { status: 'discarded' };

/** Pull cards into the diagram as one undo step, where the browser was opened for, and say where they went. */
export async function pullFromReferences(pull: ReferencesPull): Promise<ReferencesPullOutcome> {
  const outcome = await pullCards(pull);
  say(outcome, pull);
  return outcome;
}

async function pullCards(pull: ReferencesPull): Promise<ReferencesPullOutcome> {
  const start = useWorkspaceStore.getState();
  if (start.diagramReadOnly) return { status: 'read-only' };
  const document = start.oristudioCpDocument?.document;
  if (!document) return { status: 'no-pattern' };
  const loadId = start.diagramLoadId;
  const segmentation = await abandonOnEngineLoss(ensureCpSegmentationArtifacts(document)).catch(() => null);
  if (!segmentation) return { status: 'unknown' };

  // The sheet, as the Diagram finds regions: by its rim.
  const outline: RegionReference = {
    boundary: [pull.outline.map(([x, y]) => ({ x, y }))],
    bounds: boundsOf(pull.outline),
    segmentIdHint: null,
  };
  const segment = resolveRegion(outline, resolveCpSegments(segmentation));
  const region = segment ? regionReferenceFor(segment) : outline;
  // The marks the Show menu shows, laid out as the diagram's style draws its pages (17d).
  const marks = pull.marks ?? DEFAULT_PAPER_EXPORT_MARKS;
  const style = useWorkspaceStore.getState().diagram?.style ?? DEFAULT_DIAGRAM_STYLE;
  const choice = segment ? chooseStepCreases(document, { kind: 'segment', region }, segmentation) : null;
  const creases = choice?.status === 'found' ? choice.creases : null;
  const thumbnail = creases ? creasesThumbnail(creases, segmentation) : outlineThumbnail(pull.outline);

  const sent: SentReferencesEntry[] = [];
  for (const { card, picture, way } of pull.cards) {
    // References turns the paper over left to right: about the vertical axis.
    if (card.kind === 'turn-over') {
      sent.push({ kind: 'turn-over', axis: 'vertical' });
      continue;
    }
    const source = storedReferencesSource({
      kind: 'references-step',
      region,
      fingerprint: creases?.drawnFingerprint ?? null,
      thumbnail,
      mode: pull.mode,
      settings: pull.settings,
      card: card.card,
      line: card.line,
      side: card.mirrored ? 'back' : 'front',
      ...(pull.plan !== null ? { plan: pull.plan } : {}),
      ...(way !== null ? { way } : {}),
      sentence: card.sentence,
      marks: { letters: marks.letters, highlights: marks.highlights },
    });
    if (!source) return { status: 'too-large' };
    sent.push({ source, picture, lifted: liftedCardPicture(picture, marks, style), text: card.sentence });
  }

  // Named by what it will do: an anchor that can no longer take a card has them all after it.
  const takes = anchorTakesCard(useWorkspaceStore.getState().diagram, pull.anchor);
  const label =
    takes && pull.anchor.kind === 'fill'
      ? 'Fill step from References'
      : takes && pull.anchor.kind === 'replace'
        ? 'Replace card from References'
        : sent.length === 1
          ? 'Add step from References'
          : 'Add steps from References';
  const pulled = useWorkspaceStore
    .getState()
    .pullReferencesDiagramSteps(sent, pull.anchor, { loadId, label, opening: pull.opening });
  if (!pulled) return useWorkspaceStore.getState().diagramReadOnly ? { status: 'read-only' } : { status: 'discarded' };
  const into = landedInto(pull.anchor, pulled.stepIds, useWorkspaceStore.getState().diagram);
  return { status: 'pulled', ...pulled, into };
}

/**
 * Where pulled cards went: into the anchor's own step (filled or replaced),
 * after it, or — its step gone — at the end.
 */
function landedInto(anchor: DiagramPullAnchor, stepIds: readonly string[], diagram: DiagramDocument | null): DiagramPulledInto {
  if (anchor.kind === 'end') return 'end';
  if (anchor.kind !== 'after' && stepIds[0] === anchor.stepId) return anchor.kind;
  return diagram && stepIndex(diagram, anchor.stepId) >= 0 ? 'after' : 'end';
}

/** Count the pull, and say where it went. */
function say(outcome: ReferencesPullOutcome, pull: ReferencesPull): void {
  const t = i18n.t;
  switch (outcome.status) {
    case 'pulled': {
      const marks = pull.marks ?? DEFAULT_PAPER_EXPORT_MARKS;
      trackDiagramStepsPulledFromReferences(pull.mode, outcome.into, outcome.stepIds.length + outcome.turnIds.length, {
        letters: marks.letters ? 'shown' : 'hidden',
        reference_lines: marks.highlights ? 'shown' : 'hidden',
        marks: outcome.baked.length > 0 ? 'baked' : 'lifted',
      });
      sayBaked(outcome.baked);
      // A step filled or replaced was there already: only the new ones are added.
      const kept = outcome.into === 'fill' || outcome.into === 'replace' ? 1 : 0;
      for (let index = kept; index < outcome.stepIds.length; index += 1) {
        trackDiagramStepAdded('references', 'references');
      }
      outcome.turnIds.forEach(() => trackDiagramTurnAdded('turn-over', 'references'));
      const diagram = useWorkspaceStore.getState().diagram;
      const numbers = diagram ? outcome.stepIds.map((stepId) => stepNumber(diagram, stepId) ?? 0) : [];
      const first = numbers[0] ?? 0;
      const last = numbers[numbers.length - 1] ?? first;
      if (numbers.length === 0) {
        // Only a turn-over: no step to name, and nothing numbered.
        toast.success(
          t('toasts:diagram.references.addedTurnOvers', {
            count: outcome.turnIds.length,
            defaultValue_one: 'Added a turn-over',
            defaultValue_other: 'Added {{count}} turn-overs',
          })
        );
        return;
      }
      const added =
        numbers.length > 1
          ? t('toasts:diagram.references.addedSteps', 'Added as steps {{first}}–{{last}}', { first, last })
          : kept === 0
            ? t('toasts:diagram.addedAsStep', 'Added as step {{number}}', { number: first })
            : outcome.into === 'fill'
              ? t('toasts:diagram.references.filledStep', 'Filled step {{number}}', { number: first })
              : t('toasts:diagram.references.replacedStep', 'Replaced step {{number}}’s card', { number: first });
      // Marks the author had edited that went with the old card are said on the same toast, with Undo, so
      // once it is undone nothing on screen still says the card was replaced.
      if (outcome.replaced > 0) {
        toast.success(added, { description: replacedEdited(outcome.replaced), action: undoNewest() });
      } else toast.success(added);
      return;
    }
    case 'read-only':
      toast.error(
        t('toasts:diagram.capture.readOnly', 'This diagram was made with a newer Ori Studio and opens read-only.')
      );
      return;
    case 'no-pattern':
      toast.error(t('toasts:diagram.capture.noPattern', 'Open a crease pattern in Edit first.'));
      return;
    case 'unknown':
      toast.error(t('toasts:diagram.capture.unknown', 'The crease pattern isn’t ready yet. Try again in a moment.'));
      return;
    case 'too-large':
      toast.error(t('toasts:diagram.references.tooLarge', 'This step is too detailed to keep in the diagram.'));
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

/** That the cards pulled into these steps keep their marks in their pictures: more than a step holds (17d, §5). */
function sayBaked(stepIds: readonly string[]): void {
  if (stepIds.length === 0) return;
  const t = i18n.t;
  const store = useWorkspaceStore.getState();
  const number = store.diagram ? stepNumber(store.diagram, stepIds[0]!) : null;
  toast.message(
    stepIds.length === 1 && number !== null
      ? t(
          'toasts:diagram.references.bakedStep',
          'Step {{number}}’s marks stay part of its picture: there are more than a step holds.',
          { number }
        )
      : t('toasts:diagram.references.bakedSteps', {
          count: stepIds.length,
          defaultValue_one: 'A step’s marks stay part of its picture: there are more than a step holds.',
          defaultValue_other: '{{count}} steps’ marks stay part of their pictures: there are more than a step holds.',
        })
  );
}

/**
 * Another way chosen for a References step (D23): the way's card split as the
 * step's own was pulled — its choice of marks, in the diagram's style (17d) —
 * and swapped for every mark the old way's card brought (RM6). Says so when
 * the new card keeps its marks in its picture, past what the step holds
 * beside the author's (§8), and when marks the author had edited went, with
 * Undo. False when nothing changed.
 */
export function chooseReferencesWay(stepId: string, way: ReferencesStepWay): boolean {
  const store = useWorkspaceStore.getState();
  const was = store.diagram ? stepById(store.diagram, stepId) : null;
  if (!was) return false;
  const marks = was.source?.kind === 'references-step' ? (was.source.marks ?? DEFAULT_PAPER_EXPORT_MARKS) : DEFAULT_PAPER_EXPORT_MARKS;
  const lifted = liftedCardPicture(way.picture, marks, store.diagram?.style ?? DEFAULT_DIAGRAM_STYLE);
  if (!store.setDiagramReferencesWay(stepId, { ...way, lifted })) return false;
  trackDiagramPicturePosed('choose_way', 'references');
  const now = useWorkspaceStore.getState().diagram;
  const after = now ? stepById(now, stepId) : null;
  if (!after) return true;
  // The way's whole card, its marks in it: they were more than the step holds.
  if (after.picture?.key === way.picture.key) sayBaked([stepId]);
  const replaced = editedCardMarksGone(was, after);
  if (replaced > 0) toast.message(replacedEdited(replaced), { action: undoNewest() });
  return true;
}

/** A sheet no region matches, drawn as its outline: all there is of it to show. */
function outlineThumbnail(outline: readonly (readonly [number, number])[]): SheetThumbnail {
  const strokes = outline.map(([x1, y1], index) => {
    const [x2, y2] = outline[(index + 1) % outline.length]!;
    return { x1, y1, x2, y2, role: 'edge' as const };
  });
  return fitSheetThumbnail(strokes) ?? { viewBox: '0 0 100 100', strokes: [] };
}
