import type {
  FoldChoices,
  FoldModelLine,
  FoldOp,
  FoldOpKind,
  FoldRepeatEntry,
  FoldRepeatOp,
  SheetPoint,
} from '../document/foldSequenceDocument';
import type { FoldEngineCalls } from '../engine/foldEngineCalls';
import type { FoldEngineCompoundCalls } from '../engine/foldEngineCompoundCalls';
import type { FoldRefusalBody } from '../engine/foldEngineWire';
import { foldReturnHistory } from '../document/foldReturn';
import { FoldSearchStopped, runFoldSearch, type FoldSearch } from '../engine/foldSearch';
import { insideConvex, toPoint } from '../canvas/foldCanvasGeometry';
import type { FoldEngineCompoundOp } from '../engine/foldEngineCompoundWire';
import type { FoldScene } from '../engine/foldEngineWire';
import { reflection, REPEAT_TOL, RepeatFailure, sheetRing, verifiedSymmetry, type RepeatSide } from './repeatGeometry';
import { mirrorOperation, otherDirection, type RepeatMirrored } from './repeatOperation';
import { movingWitnesses, verifyMaterial } from './repeatVerification';

export interface RepeatSourceStep {
  id: string;
  before: number;
  after: number;
  op: FoldOp;
  choices?: FoldChoices;
}
export interface RepeatRequest {
  parent: number;
  source: FoldRepeatOp['source'];
  steps: readonly RepeatSourceStep[];
  axis: FoldModelLine;
  /** Document node immediately before the source range; null is the sheet. */
  baseline?: string | null;
  /** Fingerprints explicitly accepted at a previous ambiguity in this preparation. */
  selections?: Readonly<Record<number, string>>;
}
export type RepeatPrepared =
  /**
   * `matched`: per source operation, which way of its mirror passed — 0 the
   * predicted one, else the one `mirrorVariants` lists at that index.
   */
  | { status: 'ready'; op: FoldRepeatOp; matched: readonly number[] }
  | { status: 'choice'; step: number; prefix: FoldRepeatOp; candidates: FoldRepeatEntry[] }
  /**
   * Stopped at source step `step`: by Repeat's own code, or by the engine's
   * refusal of that step's mirror — the refusal, and the kind of step it was,
   * so Repeat's window words it as the folding tool's window would.
   */
  | { status: 'blocked'; step: number; code: string; refusal?: FoldRefusalBody; op?: FoldOpKind; prefix?: FoldRepeatOp };

/**
 * How long a preparation may run. Every range of the design fixtures
 * prepares within 0.11 s (1,082 ranges, `engine/foldSearchTiming.wasm.test.ts`);
 * a synthetic range of sixteen precreases on a 136-face model takes 1.1 s,
 * and the longest the caps allow, 128 turn-overs of a 256-face grid, 11.7 s,
 * nearly all of it this module's own geometry. Five seconds is over four
 * times the slowest realistic range; past it the range is refused as too
 * long, whose words say to try a shorter one.
 */
export const REPEAT_PREPARATION_MS = 5000;

/** Transactional preparation, run to the end within {@link REPEAT_PREPARATION_MS}: for the synchronous calls. */
export function prepareRepeat(
  engine: FoldEngineCalls & FoldEngineCompoundCalls,
  request: RepeatRequest,
): RepeatPrepared {
  return runFoldSearch(prepareRepeatSearch(engine, request), REPEAT_PREPARATION_MS);
}

/**
 * Transactional preparation, as a search (`engine/foldSearch.ts`) that yields
 * between engine calls. The caller owns source states; this owns and
 * releases all trial states, however it ends. Out of time, it is blocked as
 * too long (`repeat_limit`) at the source operation it had reached.
 */
export function* prepareRepeatSearch(
  engine: FoldEngineCalls & FoldEngineCompoundCalls,
  request: RepeatRequest,
): FoldSearch<RepeatPrepared> {
  const owned: number[] = [];
  let index = 0;
  let recipe: FoldRepeatOp | undefined;
  const entries: FoldRepeatEntry[] = [];
  /** Per source operation, the variant of its mirror that passed: 0 the predicted one (`mirrorVariants`). */
  const matched: number[] = [];
  try {
    if (!request.steps.length || request.steps.length > 128) throw new RepeatFailure('repeat_limit');
    const symmetry = verifiedSymmetry(engine.scene(request.steps[0]!.before), request.axis);
    if (!symmetry) throw new RepeatFailure('repeat_axis');
    const { side } = symmetry;
    const map = reflection(request.axis);
    recipe = {
      kind: 'repeat',
      axis: request.axis,
      // Said, never folded: the steps are mirrored already.
      ...(side === 'behind' ? { side } : {}),
      source: request.source,
      parentState: engine.fingerprint(request.parent),
      steps: [],
    };
    const preparedStates: number[] = [];
    let current = request.parent;
    for (index = 0; index < request.steps.length; index++) {
      yield;
      const item = request.steps[index]!;
      const before = engine.scene(item.before),
        after = engine.scene(item.after),
        target = engine.scene(current);
      if (item.op.kind === 'unfold-to') {
        const returnTarget = item.op.target;
        const targetIndex =
          item.op.target === request.baseline
            ? 0
            : request.steps.slice(0, index).findIndex((step) => step.id === returnTarget) + 1;
        if (targetIndex === 0 && item.op.target !== request.baseline)
          throw new RepeatFailure('repeat_return_target');
        const states = [request.parent, ...preparedStates];
        const targetState = states[targetIndex]!;
        const returned = engine.returnTo(current, targetState, foldReturnHistory(states, targetIndex));
        if (returned.status !== 'ok') throw RepeatFailure.refused(returned.refusal);
        owned.push(returned.state);
        verifyMaterial(before, after, target, engine.scene(returned.state), map, side);
        matched.push(0);
        entries.push({
          op: {
            ...item.op,
            source: {
              path: request.source.revision,
              state: engine.fingerprint(current),
              targetState: engine.fingerprint(targetState),
            },
          },
          returnTo: targetIndex,
          expect: returned.fingerprint,
          sourceStep: item.id,
        });
        current = returned.state;
        preparedStates.push(current);
        continue;
      }
      let material: SheetPoint[] = movingWitnesses(before, after);
      if (
        item.op.kind === 'valley' ||
        item.op.kind === 'mountain' ||
        item.op.kind === 'precrease' ||
        item.op.kind === 'unfold' ||
        item.op.kind === 'refold'
      ) {
        const analysis = engine.analyse(item.before, item.op, item.choices);
        if (analysis.status !== 'ok') throw RepeatFailure.refused(analysis.refusal);
        material = [...new Set([...analysis.analysis.picked, ...analysis.analysis.added])].map(
          (f) => analysis.analysis.flaps[f]!.witness,
        );
      }
      // The mirror as predicted, then the ways it could turn as the viewer
      // sees it: each is folded and tested (`verifyMaterial`), and only one
      // way may pass.
      const variants = mirrorVariants(engine, current, target, mirrorOperation(item.op, item.choices, before, target, map, side, material), side);
      const candidates: { entry: FoldRepeatEntry; state: number; variant: number }[] = [];
      /** Why the predicted mirror failed: the reason a refusal gives. */
      let predictedReason: RepeatFailure | null = null;
      for (const [variant, mapped] of variants.entries()) {
        let reason = new RepeatFailure('repeat_order');
        let unresolved = false;
        const tryCandidate = (op: FoldOp, choices?: FoldChoices) => {
          const result = engine.step(current, op, choices);
          if (result.status !== 'ok') {
            reason = RepeatFailure.refused(result.refusal);
            // Native replay refuses unresolved choices; it never chooses an order.
            unresolved =
              (result.refusal.code === 'choice_needed' && result.refusal.choice === 'completion') ||
              (result.refusal.code === 'choice_broken' && result.refusal.broken === 'not_unique');
            return;
          }
          owned.push(result.state);
          try {
            verifyMaterial(before, after, target, engine.scene(result.state), map, side);
          } catch (error) {
            if (error instanceof RepeatFailure) {
              reason = error;
              engine.release([result.state]);
              owned.pop();
              return;
            }
            throw error;
          }
          if (!candidates.some((c) => c.entry.expect === result.fingerprint))
            candidates.push({
              state: result.state,
              variant,
              entry: { op, ...(choices ? { choices } : {}), expect: result.fingerprint, sourceStep: item.id },
            });
          else {
            engine.release([result.state]);
            owned.pop();
          }
        };
        // The landing/opening already chosen in the source is part of the
        // operation. A successful native replay has a unique result under those
        // choices. Do not enumerate alternate tuck positions or moving sets.
        // The other ways of the mirror are folded in the predicted one's slice.
        if (variant === 0) yield;
        tryCandidate(mapped.op, mapped.choices);
        if (!candidates.some((c) => c.variant === variant) && unresolved) {
          // Inserted M/V is resolved by the bridge through this same public tuck
          // operation. Query its remaining orders with the saved targets fixed;
          // the general M/V authoring query intentionally searches all landings.
          const queryOp: FoldOp =
            (mapped.op.kind === 'valley' || mapped.op.kind === 'mountain') &&
            mapped.op.landing?.kind === 'against'
              ? {
                  kind: 'tuck',
                  direction: mapped.op.kind,
                  line: mapped.op.line,
                  seed: mapped.op.seed,
                  moving: mapped.op.moving,
                  target: mapped.op.landing.targets[0]!,
                  additionalTargets: mapped.op.landing.targets.slice(1),
                }
              : mapped.op;
          let first = engine.orderSelection(current, queryOp, mapped.choices, { index: 0, batch: 0 });
          for (let batch = 1; first.status === 'ok' && !first.count.exact && batch <= 8; batch++) {
            yield;
            first = engine.orderSelection(current, queryOp, mapped.choices, { index: 0, batch });
          }
          // This way of the mirror has no order: it does not land.
          if (first.status !== 'ok') reason = RepeatFailure.refused(first.refusal);
          // Orders past the cap could hold a match: no way of the mirror can be ruled in or out.
          else if (!first.count.exact || first.count.orders > 64) throw new RepeatFailure('repeat_order_limit');
          else
            for (let n = 0; n < first.count.orders; n++) {
              yield;
              const order =
                n === 0 ? first : engine.orderSelection(current, queryOp, mapped.choices, { index: n, batch: 8 });
              if (order.status !== 'ok') throw RepeatFailure.refused(order.refusal);
              const choices: FoldChoices = {
                ...mapped.choices,
                ...(order.completion ? { completion: order.completion } : {}),
              };
              tryCandidate(mapped.op.kind === 'pleat' && order.pleat ? { ...mapped.op, resolved: order.pleat } : mapped.op, Object.keys(choices).length ? choices : undefined);
            }
        }
        engine.releaseOrderSearch?.(current);
        if (variant === 0) predictedReason = reason;
      }
      if (!candidates.length) throw predictedReason ?? new RepeatFailure('repeat_order');
      // Two ways of turning the mirror both pass, landing differently: which
      // one the source means is not known, and Repeat does not guess.
      if (new Set(candidates.map((c) => c.variant)).size > 1) throw new RepeatFailure('repeat_ambiguous');
      matched.push(candidates[0]!.variant);
      const selected = candidates.find((c) => c.entry.expect === request.selections?.[index]);
      if (candidates.length > 1 && !selected)
        return {
          status: 'choice',
          step: index,
          prefix: { ...recipe, steps: entries },
          candidates: candidates.map((c) => c.entry),
        };
      const chosen = selected ?? candidates[0]!;
      for (const candidate of candidates)
        if (candidate !== chosen) {
          engine.release([candidate.state]);
          owned.splice(owned.indexOf(candidate.state), 1);
        }
      entries.push(chosen.entry);
      current = chosen.state;
      preparedStates.push(current);
    }
    // Every step its own mirror — a precrease along the axis — leaves the model as it was: nothing to add.
    if (entries.at(-1)?.expect === recipe.parentState) throw new RepeatFailure('repeat_nothing');
    return { status: 'ready', op: { ...recipe, steps: entries }, matched };
  } catch (error) {
    const failure = error instanceof FoldSearchStopped && error.reason === 'budget' ? new RepeatFailure('repeat_limit') : error;
    if (failure instanceof RepeatFailure)
      return {
        status: 'blocked',
        step: index,
        code: failure.code,
        ...(failure.refusal ? { refusal: failure.refusal, op: request.steps[index]?.op.kind } : {}),
        ...(recipe && entries.length ? { prefix: { ...recipe, steps: entries } } : {}),
      };
    throw error;
  } finally {
    engine.releaseOrderSearch?.(request.parent);
    engine.release(owned);
  }
}

/**
 * The ways a source step's mirror may be folded, the predicted one first
 * (`mirrorOperation`): then the other direction, as the viewer sees it
 * (`otherDirection`); and behind, a reverse fold's or crimp's openings by the
 * upper block the target's analysis lists over the mirrored source's (in the
 * model, the source's upper block is the lower one behind). The preparation
 * folds each and keeps the one Repeat's test passes.
 */
export function mirrorVariants(
  engine: FoldEngineCompoundCalls,
  state: number,
  target: FoldScene,
  predicted: RepeatMirrored,
  side: RepeatSide,
): RepeatMirrored[] {
  const variants = [predicted];
  const other = otherDirection(predicted);
  if (other) variants.push(other);
  if (side === 'behind') {
    const lowered = openingsBehind(engine, state, target, predicted);
    if (lowered) variants.push(lowered);
  }
  return variants;
}

/**
 * A reverse fold's or crimp's openings behind: per opening stored, the one
 * opening of the target's whose lower block holds the mirrored witnesses of
 * the source's upper block, and whose upper block holds none; null when the
 * step stores none, or any has no such opening, or more than one.
 */
function openingsBehind(
  engine: FoldEngineCompoundCalls,
  state: number,
  target: FoldScene,
  mirrored: RepeatMirrored,
): RepeatMirrored | null {
  const { op, choices } = mirrored;
  if (!choices?.opening?.length || (op.kind !== 'inside-reverse' && op.kind !== 'outside-reverse' && op.kind !== 'crimp')) return null;
  const { opening: stored, ...rest } = choices;
  const asked = engine.compoundAnalysis(state, op as FoldEngineCompoundOp, Object.keys(rest).length ? rest : undefined);
  if (asked.status !== 'ok') return null;
  const flaps = asked.family === 'reverse' ? asked.analysis.flaps : asked.family === 'crimp' ? asked.analysis.tip.flaps : null;
  if (!flaps) return null;
  const at = new Map(target.lineage.map((face, index) => [face.id, index]));
  const holds = (faces: readonly number[], point: SheetPoint) =>
    faces.some((id) => {
      const index = at.get(id);
      return index !== undefined && insideConvex(sheetRing(target, index), toPoint(point), REPEAT_TOL);
    });
  const openings = flaps.flatMap((flap) => flap.openings);
  const lowered = [];
  for (const { upper } of stored ?? []) {
    const matching = openings.filter((each) => upper.every((p) => holds(each.lower, p)) && !upper.some((p) => holds(each.upper, p)));
    if (matching.length !== 1) return null;
    lowered.push(matching[0]!.stored);
  }
  return { op, choices: { ...rest, opening: lowered } };
}
