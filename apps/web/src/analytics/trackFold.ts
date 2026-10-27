import type { LayerSpreadOptions } from '../cp-workspace/folded/foldedLayerSpread';
import type { FoldCpOrigin } from '../fold/document/foldSequenceDocument';
import { ANALYTICS_EVENTS, bucketCount, COUNT_BUCKETS, FOLD_CHOICE_COUNT_BUCKETS } from './events';
import type {
  DiagramStyleChoiceName,
  FoldChoiceKind,
  FoldMarkDivideMode,
  FoldSheetSetting,
  FoldSheetShape,
  FoldSpreadAction,
  FoldSpreadVia,
  FoldStepAddedOpKind,
  FoldStepExtent,
  FoldStepLayerScope,
  FoldStepRotationAmount,
  FoldStepVertexForm,
  FoldStepVia,
} from './events';
import { track } from './runtime';
import { spreadProperties, spreadTracking } from './trackDiagram';

/** What a committed step says beyond its kind: how its line was located, how far it turned, or how it named its lines. */
type FoldStepAddedDetails =
  | { layerScope: FoldStepLayerScope; via: FoldStepVia; extent?: FoldStepExtent; targetCount?: number }
  | { amount: FoldStepRotationAmount }
  | { vertex: FoldStepVertexForm }
  | {
      repeat: {
        mode: 'grouped' | 'individual';
        count: number;
        /** Where its axis came from: offered and taken, or drawn on the crease pattern or the folded pane. */
        axisSource?: 'listed' | 'drawn_cp' | 'drawn_folded';
        /** Whether the mirror kept the layer order (the other side) or reversed it (behind). */
        side?: 'same' | 'behind';
      };
    };

/**
 * A step committed from the Fold canvas (plan D18). Hand-placed: a commit is
 * the session's verb, reached from the tool window, Enter and the chooser,
 * none of which dispatches a `MENU_ACTION_ID`. A turn takes no layers and
 * locates no line, so it carries `op_kind` alone, and a rotation how far it
 * turned (`amount`: its preset, or `other` for an exact angle — never the
 * angle); a precrease says how much of its line it creased (`extent`). A
 * vertex fold locates no line either: a petal fold says how its hinge was
 * named (`hinge`), a swivel its form — by its edge at a free vertex, by its
 * edge on a folded edge, or by its rays — and, by its edge, its target
 * (`swivel_form`, `target`), and on a folded edge whether it is the open
 * swivel or the inside one (`swivel_kind`); a squash its hinge, folded or
 * a drawn line (`squash_hinge`).
 */
export function trackFoldStepAdded(opKind: FoldStepAddedOpKind, details?: FoldStepAddedDetails): void {
  track(ANALYTICS_EVENTS.foldStepAdded, { op_kind: opKind, ...detailProperties(details) });
}

function detailProperties(details: FoldStepAddedDetails | undefined): Record<string, string> {
  if (!details) return {};
  if ('repeat' in details) {
    const { mode, count, axisSource, side } = details.repeat;
    return {
      repeat_mode: mode,
      count_bucket: bucketCount(count, COUNT_BUCKETS),
      ...(axisSource ? { axis_source: axisSource } : {}),
      ...(side ? { side } : {}),
    };
  }
  if ('amount' in details) return { amount: details.amount };
  if ('vertex' in details) return vertexFormProperties(details.vertex);
  return {
    layer_scope: details.layerScope,
    via: details.via,
    ...(details.extent ? { extent: details.extent } : {}),
    ...(details.targetCount !== undefined ? { target_count_bucket: bucketCount(details.targetCount, COUNT_BUCKETS) } : {}),
  };
}

/** A vertex fold's form as `fold step added`'s properties: enums only. */
function vertexFormProperties(form: FoldStepVertexForm): Record<string, string> {
  if ('hinge' in form) return { hinge: form.hinge };
  if ('squashHinge' in form) return { squash_hinge: form.squashHinge };
  if (form.swivelForm === 'valley_mountain') return { swivel_form: 'valley_mountain', swivel_kind: form.swivelKind };
  if (form.swivelForm === 'rays') return { swivel_form: 'rays' };
  if (form.swivelForm === 'fold') return { swivel_form: 'fold', target: form.target, swivel_kind: form.swivelKind };
  return { swivel_form: form.swivelForm, target: form.target };
}

/**
 * A refusal shown to the folder, by the engine's stable code: never a face, a
 * vertex or a line. A Repeat's refusal names its op (`op_kind: repeat`, as
 * `fold step added` spells it), since the steps it mirrors refuse in the
 * canvas tools' own codes; a canvas tool's carries none.
 */
export function trackFoldRefused(code: string, opKind?: FoldStepAddedOpKind): void {
  track(ANALYTICS_EVENTS.foldRefused, { code, ...(opKind ? { op_kind: opKind } : {}) });
}

/** A saved Repeat updated from its source steps: no step, no range, no axis. */
export function trackFoldRepeatRebuilt(): void {
  track(ANALYTICS_EVENTS.foldRepeatRebuilt);
}

/** The Divide line marked a segment: how it divided it, never the segment, the parts or the ratio. */
export function trackFoldMarkAdded(divideMode: FoldMarkDivideMode): void {
  track(ANALYTICS_EVENTS.foldMarkAdded, { divide_mode: divideMode });
}

/**
 * The sheet a Fold sequence starts from changed in the Paper pane: which
 * setting, and the sheet after it — its shape by kind (never a size or a
 * side count) and the side that starts up. A new shape comes from Import
 * starting sheet, and says where its outline came from (`origin`, the closed
 * enum `fold cp imported` names a pattern's by: a format or `project_cp`).
 */
export function trackFoldSheetChanged(
  setting: FoldSheetSetting,
  sheet: { shape: FoldSheetShape; startSide: 'front' | 'back' },
  origin?: FoldCpOrigin
): void {
  track(ANALYTICS_EVENTS.foldSheetChanged, {
    setting,
    sheet_shape: sheet.shape,
    start_side: sheet.startSide,
    ...(origin ? { origin } : {}),
  });
}

/**
 * The sequence's paper style was picked in the Paper pane: which kind of
 * choice, as the Diagram names its style (`DiagramStyleChoiceName`) — never a
 * preset's name or a colour.
 */
export function trackFoldPaperStyleChanged(style: DiagramStyleChoiceName): void {
  track(ANALYTICS_EVENTS.foldPaperStyleChanged, { style });
}

/**
 * A Fold step's layer spread changed, from where, and — when it leaves the
 * layers spread — how, as the Diagram counts a spread (`spreadProperties`):
 * enums and buckets, never a value.
 */
export function trackFoldSpreadChanged(
  action: FoldSpreadAction,
  via: FoldSpreadVia,
  spread: LayerSpreadOptions | null
): void {
  track(ANALYTICS_EVENTS.foldSpreadChanged, {
    action,
    via,
    ...(spread ? spreadProperties(spreadTracking(spread)) : {}),
  });
}

/**
 * The engine offered more than one answer to choose between: which choice
 * (`choice_kind` — a bare `kind` already names an optimizer, a design and a
 * solve surface on other events), and how many, bucketed.
 */
export function trackFoldChoiceOffered(choiceKind: FoldChoiceKind, count: number): void {
  track(ANALYTICS_EVENTS.foldChoiceOffered, {
    choice_kind: choiceKind,
    count_bucket: bucketCount(count, FOLD_CHOICE_COUNT_BUCKETS),
  });
}

/**
 * Explicit order review, without model data or candidate indices. The callers'
 * `canceled` is sent as `cancelled`, as every other event spells it.
 */
export function trackFoldOrderResolved(result: 'accepted' | 'canceled', source: 'tool' | 'cp', count: number): void {
  track(ANALYTICS_EVENTS.foldOrderResolved, {
    result: result === 'canceled' ? 'cancelled' : result,
    source,
    count_bucket: bucketCount(count, FOLD_CHOICE_COUNT_BUCKETS),
  });
}

/**
 * A press of Find more orders ended: the search finished (`exhausted`), ran
 * out of the press's time (`incomplete`), or was stopped; whether it found
 * orders the review did not have before it (`found`), and how many there are
 * now, bucketed. Never which orders.
 */
export function trackFoldOrdersSearched(result: 'exhausted' | 'incomplete' | 'stopped', foundMore: boolean, count: number): void {
  track(ANALYTICS_EVENTS.foldOrdersSearched, {
    result,
    found: foundMore ? 'more' : 'none',
    count_bucket: bucketCount(count, FOLD_CHOICE_COUNT_BUCKETS),
  });
}

/** Only the setting's state is reported, never the selected references. */
export function trackFoldFreeLineSnapChanged(enabled: boolean): void {
  track(ANALYTICS_EVENTS.foldFreeLineSnapChanged, { state: enabled ? 'on' : 'off' });
}

/** Viewing the CP's other side, independently of a Turn over step; no model data. */
export function trackFoldCpSideChanged(side: 'front' | 'back'): void {
  track(ANALYTICS_EVENTS.foldCpSideChanged, { side });
}
