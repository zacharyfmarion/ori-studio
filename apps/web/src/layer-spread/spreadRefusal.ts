/**
 * A layer spread refused by design: the model is past one of the budgets a
 * Default spread keeps to, so its layers are not spread.
 *
 * - `resource_limit`: the solve's own limits — too many vertices, overlap
 *   pairs or regions (`SpreadError::Limit` in `oristudio-layer-spread`, which
 *   the bridge rejects with as {@link BRIDGE_LIMIT_CODE}).
 * - `time_budget`: a stage ran past its time — the solve's
 *   (`SpreadService`), the preparation's (`prepareConnected`) or the
 *   bitmap's (`rasterConnected`).
 * - `preparation_budget`: too many faces to prepare at all
 *   (`connectedSpreadSource`).
 *
 * A refusal is no fault, and no surface reports it: each draws the state
 * unspread and says so its own way. Everything else a spread throws —
 * geometry the solve finds inconsistent, a result that does not validate, a
 * worker that died — is not a refusal, and stays an error.
 *
 * An error's class does not survive `postMessage`, so a worker posts a
 * refusal by its reason ({@link spreadUnavailable}) and the main thread makes
 * it a {@link SpreadRefusal} again ({@link spreadUnavailableError}).
 */

export const SPREAD_REFUSAL_REASONS = ['resource_limit', 'time_budget', 'preparation_budget'] as const;
export type SpreadRefusalReason = (typeof SPREAD_REFUSAL_REASONS)[number];

/** The code the bridge rejects with for `SpreadError::Limit` (`oristudio-layer-spread-wasm`). */
export const BRIDGE_LIMIT_CODE = 'spread_limit';

export class SpreadRefusal extends Error {
  readonly reason: SpreadRefusalReason;

  constructor(reason: SpreadRefusalReason, message: string) {
    super(message);
    this.name = 'SpreadRefusal';
    this.reason = reason;
  }
}

/** Why a spread was refused, or null for a failure that is not a refusal. */
export function spreadRefusalOf(error: unknown): SpreadRefusalReason | null {
  return error instanceof SpreadRefusal ? error.reason : null;
}

/** What a spread worker posts of a failure: its message, and its reason when it is a refusal. */
export interface SpreadUnavailable {
  message: string;
  refusal?: SpreadRefusalReason;
}

/** The bridge's rejection, `{ code, message }`: the code names the solve's `SpreadError`. */
function bridgeRejection(error: unknown): { code: string; message: string } | null {
  if (!error || typeof error !== 'object' || error instanceof Error) return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string' ? { code, message } : null;
}

/** A failure in a spread worker, as the worker posts it. */
export function spreadUnavailable(error: unknown): SpreadUnavailable {
  const rejected = bridgeRejection(error);
  if (rejected) {
    return rejected.code === BRIDGE_LIMIT_CODE
      ? { message: rejected.message, refusal: 'resource_limit' }
      : { message: rejected.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  const refusal = spreadRefusalOf(error);
  return refusal ? { message, refusal } : { message };
}

/** A worker's failure as the error its lease rejects with: a {@link SpreadRefusal} for a refusal. */
export function spreadUnavailableError({ message, refusal }: SpreadUnavailable): Error {
  return refusal !== undefined && SPREAD_REFUSAL_REASONS.includes(refusal)
    ? new SpreadRefusal(refusal, message)
    : new Error(message);
}
