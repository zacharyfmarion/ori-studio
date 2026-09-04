/**
 * Rebuilding a region's solver input from **the document as it stands now**.
 *
 * A detection publishes one `ExactSolveInput` and attaches it to the region at
 * import. For as long as that attachment was the only thing a re-solve could
 * consume, every repair the user made afterwards was invisible to the solver:
 * a merged degree-2 vertex, two corners joined into one, a crease recoloured
 * from valley to auxiliary. The solve then reported blockers about vertices
 * that were no longer there, with nothing on screen to point at — which is the
 * shape all three of the reported "it says N errors but I fixed them" bugs took.
 *
 * So the input is rebuilt from the live creases instead. The kernel planarizes
 * them into a FOLD, and the compiler's own adapter turns that into an input;
 * neither step is reimplemented here, and this module is only the seam between
 * them.
 *
 * **What comes back with it is the frame.** The solver works in the unit square
 * and the document does not, so an answer has to be carried back. That used to
 * be a *hypothesis* — assume a shift and a uniform scale, apply it, then look
 * for the solver's vertices among the crease ends to see whether the guess held
 * — which could not describe a rotated pattern at all and refused instead. The
 * Rust now hands over the similarity it actually used, so the mapping is known
 * rather than guessed, and rotation is just another transform.
 *
 * Its own short-lived session rather than the solve's: `runCpExactSolve` opens
 * one per solve and binds Stop to it before its first await, and threading a
 * rebuild through that would either put a second job on the terminable worker's
 * critical path or make this module wait on a session it does not own. The
 * spawn is a wasm instantiation and nothing else — no ONNX runtime, no detector
 * model — which is the same argument `cpExactSolveWorker` already makes for
 * spawning one per solve.
 */
import { openCpExactSolveSession } from './cpExactSolveSession';
import type { CpExactSolveInputFromFold } from './cpExactSolveTypes';

/**
 * The rebuild could not run. Carries the compiler's own words, which name the
 * geometry rather than the failure — "paper is not a 4-corner quadrilateral",
 * "non-square paper is not yet supported" — so a caller can say something true
 * about the pattern instead of "solve failed".
 */
export class CpExactSolveInputRebuildError extends Error {
  readonly code = 'cp_exact_solve_input_rebuild';

  constructor(readonly reason: string) {
    super(reason);
    this.name = 'CpExactSolveInputRebuildError';
  }
}

/** Rebuild an `ExactSolveInput` and its frame from a FOLD crease pattern. */
export async function rebuildCpExactSolveInput(
  foldJson: string
): Promise<CpExactSolveInputFromFold> {
  const session = openCpExactSolveSession();
  try {
    const solver = await session.solver;
    if (!solver.exactSolveInputFromFold) {
      throw new CpExactSolveInputRebuildError('This build cannot rebuild a solver input.');
    }
    return await solver.exactSolveInputFromFold(foldJson);
  } catch (error) {
    throw asRebuildError(error);
  } finally {
    session.dispose();
  }
}

/**
 * The bridge rejects with a `{ code, message }` envelope, and the message is the
 * compiler's refusal string. Anything else is passed through unchanged — a
 * worker that died is not a statement about the pattern.
 */
function asRebuildError(error: unknown): unknown {
  if (error instanceof CpExactSolveInputRebuildError) return error;
  const envelope = error as { code?: unknown; message?: unknown } | null;
  if (
    envelope &&
    typeof envelope === 'object' &&
    envelope.code === 'unsupported_pattern' &&
    typeof envelope.message === 'string'
  ) {
    return new CpExactSolveInputRebuildError(envelope.message);
  }
  return error;
}
