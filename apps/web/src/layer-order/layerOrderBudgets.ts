/**
 * How much the Layer order dialog shows and counts on a large figure
 * (`implementation-plans/layer-order-dialog.md`, decision D7 and phase gate
 * 2): the label cap the panes read (U8) and the inspector's hint names (U10),
 * and when the dialog's worker counts the solutions and in what slices (U6).
 *
 * Set by census 2 (row E8, `scripts/layer-order-census.mjs`): the dialog's
 * calls through the built Fold bridge in Node 22, over the 475 cpoogle
 * designs the source admits, the fixtures and iguana-c0, one at a time on an
 * Apple Silicon Mac. The numbers below are that run's; the test beside this
 * module holds them and checks each value against them.
 */
import type { LayerOrderLimits } from './engine/layerOrderEngine';
import type { LayerOrderEngineRole } from './engine/layerOrderRuntime';

/**
 * D7's label cap: once a subject is picked, the hovered face plus the
 * nearest this many of its open objects keep their letters, and the hint
 * names how many are tinted ("Pick one of the 87 tinted faces").
 *
 * Over the corpus's 34,397 pickable subjects, a subject offers 8 open
 * objects at the median, 34 at p90, 46 at p95, 87 at p99 and 306 at most.
 * With 50, 96% of subjects show every object's letter, and on 89% of
 * designs no subject reaches the cap. iguana-c0's subjects offer 132 at the
 * median and up to 432.
 */
export const LAYER_ORDER_LABEL_CAP = 50;

/**
 * Above this many open pairs, the dialog does not start the count: the
 * status line has no total and the stepper steps with none (D7).
 *
 * Every corpus design is under it (16,352 open pairs at most). Its counts
 * end within 30 s of slicing on all but 5, which read "at least", and no
 * call of the count took more than 59 ms. iguana-c0, with 65,851, shows no
 * more than "at least 1" after 30 s, and its calls run to 454 ms (its start
 * 143 ms, and 644 ms once three constraints are committed), each a wait for
 * the preview behind it. A slice overruns its 30 ms deadline by about what
 * setting up a component costs, which grows with the component: 27 to 29 ms
 * on the corpus's two largest, 424 ms on the iguana. A straight line between the
 * two puts a call at 20,000 open pairs near 90 ms; no design measured lies
 * between them.
 */
export const LAYER_ORDER_COUNT_MAX_OPEN_PAIRS = 20_000;

/**
 * One slice of the count, advanced between the worker's other calls. Over
 * the corpus's 12,385 slices, one took 30 ms at the median, 34 ms at p95
 * and 59 ms at most, so a preview waits at most about that behind it.
 */
export const LAYER_ORDER_COUNT_SLICE = {
  maxNodes: 1_000,
  fastNodes: 128,
  deadlineMs: 30,
} as const satisfies LayerOrderLimits;

/**
 * Whether the dialog starts the solution count on a session that leaves
 * `openPairs` pairs open: at open, and again after each commit.
 */
export function layerOrderCountStarts(openPairs: number): boolean {
  return openPairs <= LAYER_ORDER_COUNT_MAX_OPEN_PAIRS;
}

/**
 * Whether a step also counts on (E9's `countInSteps`, a tenth of its limits
 * held back for the count), on a cursor started over `openPairs` open pairs
 * by a worker in `role`. Only a host's: nothing else advances its count, and
 * only where the count starts at all. The dialog counts in slices of its own
 * (`LAYER_ORDER_COUNT_SLICE`), or chose not to count, so its steps spend all
 * their limits on the step.
 */
export function layerOrderStepsCount(role: LayerOrderEngineRole, openPairs: number): boolean {
  return role === 'host' && layerOrderCountStarts(openPairs);
}
