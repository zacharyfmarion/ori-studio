/**
 * The Layer order dialog's analytics facts (spec §10, plan "Analytics"), as
 * pure values: the event and its enum and bucketed properties, never a face,
 * a letter, a coordinate or an unbucketed count. The reducer hands the four
 * the dialog reports to its hook as `track` effects at the moment they
 * happen; the hook sends them through the central analytics layer (U10). The
 * fifth, `layer constraints need attention`, is the hosts' (H4, H7), built
 * here so its buckets match the dialog's.
 *
 * Pure: no React, no store, no engine calls.
 */
import { bucketCount } from '../../analytics/events';
import type { LayerRefusal } from '../engine/layerOrderEngine';
import type { LayerPickOrigin } from './layerOrderSentence';
import type { LayerTally, LayerVerb } from './layerOrderEngineFacts';

/** Where the dialog opened: an Edit figure, an Edit crease-pattern selection, a Diagram step, Pose, Fold's Import CP. */
export type LayerOrderSurface = 'edit_figure' | 'edit_pattern' | 'diagram_step' | 'pose' | 'fold_import';

export type LayerOrderOutcome = 'applied' | 'cancelled';

/**
 * How `layer order dialog closed` says the dialog ended: Apply with a record
 * (`applied`) or with nothing to write (`unchanged`, D16); Cancel on an open
 * dialog (`cancelled`); or closed on an open the engine refused (`refused`,
 * with the refusal's code), on an engine that stopped (`crashed`), or on one
 * the browser couldn't load (`unavailable`: offline, say).
 */
export type LayerOrderClosedOutcome = 'applied' | 'unchanged' | 'cancelled' | 'refused' | 'crashed' | 'unavailable';

/** A refused open's code: an enum, never its details. */
export type LayerOrderRefusalCode = LayerRefusal['code'];

/** A figure's faces: a handful, a typical design, a large one, the iguana's class. */
export const LAYER_ORDER_FACE_COUNT_BUCKETS = [20, 50, 100, 200, 500, 1000, 2000] as const;

/** The constraints in the list: none, one, a few, many. */
export const LAYER_ORDER_CONSTRAINT_COUNT_BUCKETS = [0, 1, 2, 5, 10, 20] as const;

/** The solutions that fit: none, decided, a choice of two, a few, many. */
export const LAYER_ORDER_SOLUTIONS_BUCKETS = [0, 1, 2, 5, 10, 100, 1000] as const;

/** How long the dialog stayed open: a glance, a quick fix, a session. */
export const LAYER_ORDER_ELAPSED_MS_BUCKETS = [5_000, 15_000, 30_000, 60_000, 180_000, 600_000] as const;

/** How many saved constraints an edit left needing attention. */
export const LAYER_ORDER_BROKEN_COUNT_BUCKETS = [1, 2, 5, 10] as const;

/** A sentence's objects (D21): one, two, a few (3–5), many (6+). */
export const LAYER_ORDER_OBJECT_COUNT_BUCKETS = [1, 2, 5] as const;

/**
 * The solutions, as `solutions_bucket` sends them: `pending` until the count
 * arrives, `skipped` when it never runs (D7), a bucket when exact, and
 * `>=t` (the largest step of the ladder it reached) when it is only a lower
 * bound ("at least N").
 */
export type LayerOrderSolutionsBucket = string;

export function solutionsBucket(count: LayerTally | null, runs: boolean): LayerOrderSolutionsBucket {
  if (!runs) return 'skipped';
  if (!count) return 'pending';
  if (count.exact) return bucketCount(count.n, LAYER_ORDER_SOLUTIONS_BUCKETS);
  const reached = LAYER_ORDER_SOLUTIONS_BUCKETS.filter((step) => step <= count.n);
  return `>=${reached.length > 0 ? reached[reached.length - 1] : 0}`;
}

export type LayerOrderFact =
  | {
      readonly event: 'layer order dialog opened';
      readonly properties: {
        /** Left out when the host didn't say which it is (`LayerOrderRequest.surface` is optional). */
        readonly surface?: LayerOrderSurface;
        readonly face_count_bucket: string;
        readonly solutions_bucket: LayerOrderSolutionsBucket;
      };
    }
  | {
      readonly event: 'layer constraint added';
      readonly properties: {
        readonly verb: LayerVerb;
        readonly subject_origin: LayerPickOrigin;
        /** Where the sentence's first object was picked. */
        readonly object_origin: LayerPickOrigin;
        /** How many objects the sentence named: once per Add, however many constraints it made (D21). */
        readonly object_count_bucket: string;
      };
    }
  | {
      readonly event: 'layer constraint blocked';
      readonly properties: { readonly constraint_count_bucket: string; readonly object_count_bucket: string };
    }
  | {
      readonly event: 'layer order dialog closed';
      readonly properties: {
        readonly outcome: LayerOrderClosedOutcome;
        /** Only with `outcome: 'refused'`. */
        readonly refusal?: LayerOrderRefusalCode;
        readonly constraint_count_bucket: string;
        readonly solutions_bucket: LayerOrderSolutionsBucket;
        readonly elapsed_ms_bucket: string;
        /** Whether Rotate left the folded pane turned from the host's turn as it closed. Never the angle. */
        readonly rotated: boolean;
      };
    }
  | {
      readonly event: 'layer constraints need attention';
      readonly properties: { readonly surface: LayerOrderSurface; readonly broken_count_bucket: string };
    }
  | {
      readonly event: 'layer constraints dismissed';
      readonly properties: { readonly surface: LayerOrderSurface; readonly constraint_count_bucket: string };
    };

export function dialogOpenedFact(
  surface: LayerOrderSurface | null,
  faces: number,
  solutions: LayerOrderSolutionsBucket
): LayerOrderFact {
  return {
    event: 'layer order dialog opened',
    properties: {
      ...(surface === null ? {} : { surface }),
      face_count_bucket: bucketCount(faces, LAYER_ORDER_FACE_COUNT_BUCKETS),
      solutions_bucket: solutions,
    },
  };
}

/** One Add: the sentence's verb, where its faces were picked, and how many objects it named. */
export function constraintAddedFact(
  verb: LayerVerb,
  subjectOrigin: LayerPickOrigin,
  objectOrigin: LayerPickOrigin,
  objects: number
): LayerOrderFact {
  return {
    event: 'layer constraint added',
    properties: {
      verb,
      subject_origin: subjectOrigin,
      object_origin: objectOrigin,
      object_count_bucket: bucketCount(objects, LAYER_ORDER_OBJECT_COUNT_BUCKETS),
    },
  };
}

/**
 * A complete sentence that can't fit, so Add is disabled, once per sentence:
 * `constraints` is the list it was checked against, `objects` how many
 * objects the sentence named.
 */
export function constraintBlockedFact(constraints: number, objects: number): LayerOrderFact {
  return {
    event: 'layer constraint blocked',
    properties: {
      constraint_count_bucket: bucketCount(constraints, LAYER_ORDER_CONSTRAINT_COUNT_BUCKETS),
      object_count_bucket: bucketCount(objects, LAYER_ORDER_OBJECT_COUNT_BUCKETS),
    },
  };
}

export function dialogClosedFact(
  outcome: LayerOrderClosedOutcome,
  constraints: number,
  solutions: LayerOrderSolutionsBucket,
  elapsedMs: number,
  refusal: LayerOrderRefusalCode | null = null,
  rotated = false
): LayerOrderFact {
  return {
    event: 'layer order dialog closed',
    properties: {
      outcome,
      ...(outcome === 'refused' && refusal !== null ? { refusal } : {}),
      constraint_count_bucket: bucketCount(constraints, LAYER_ORDER_CONSTRAINT_COUNT_BUCKETS),
      solutions_bucket: solutions,
      elapsed_ms_bucket: bucketCount(Math.max(0, elapsedMs), LAYER_ORDER_ELAPSED_MS_BUCKETS),
      rotated,
    },
  };
}

/** The hosts' event after a refold or an edit (H4, H7): `broken` saved constraints not applied. */
export function needsAttentionFact(
  surface: LayerOrderSurface,
  broken: number
): Extract<LayerOrderFact, { event: 'layer constraints need attention' }> {
  return {
    event: 'layer constraints need attention',
    properties: { surface, broken_count_bucket: bucketCount(broken, LAYER_ORDER_BROKEN_COUNT_BUCKETS) },
  };
}

/** A host's detached record let go (Dismiss): how many constraints it held, by the dialog's ladder. */
export function dismissedFact(
  surface: LayerOrderSurface,
  constraints: number
): Extract<LayerOrderFact, { event: 'layer constraints dismissed' }> {
  return {
    event: 'layer constraints dismissed',
    properties: { surface, constraint_count_bucket: bucketCount(constraints, LAYER_ORDER_CONSTRAINT_COUNT_BUCKETS) },
  };
}
