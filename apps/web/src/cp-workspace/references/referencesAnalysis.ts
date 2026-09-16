/**
 * The CP-wide analysis: which of a pattern's references are hard.
 *
 * Closure first — the planner constructs most of a real design from the bare
 * sheet, and a line it reaches needs no query at all — then ReferenceFinder for
 * only the remainder. That ordering is the whole cost argument: a 641-segment
 * component has ~95 distinct lines and typically two or three of them survive
 * the closure, so a typical analysis is one or two queries rather than ninety.
 *
 * Each line comes back with one of four verdicts: constructible in the closure,
 * exact at rank *r*, approximate with error ε, or unsolved. Nothing is folded
 * and nothing is written; this is a reading of the pattern, not a plan for it.
 *
 * React-free like `precreasePlan.ts`, over the same planner interface.
 */
import type { ReferenceFinderClient, ReferenceFinderLineRequest } from './referenceFinder/client';
import type { ExtractedSolution } from './referenceFinder/extractor';
import { EXACT_ERROR } from './referenceFinder/protocol';
import type { RfPoint } from './referenceFinder/solution';
import type { PrecreasePlannerHandle } from './precreasePlan';
import {
  chosenWitness,
  decodeRemaining,
  type PrecreasePlanLine,
  type PrecreaseSequence,
} from './precreaseSequence';

/** What the analysis concluded about one distinct line of the pattern. */
export type ReferencesLineVerdict =
  | { kind: 'closure'; stepId: number; axiom: number }
  | { kind: 'exact'; rank: number; foldCount: number }
  | { kind: 'approximate'; rank: number; foldCount: number; err: number }
  | { kind: 'unsolved' }
  | { kind: 'error'; message: string };

export interface ReferencesAnalysisLine {
  /** The editor's 1-based crease ids on this merged line. */
  cpLineIds: number[];
  line: PrecreasePlanLine;
  verdict: ReferencesLineVerdict;
}

export interface ReferencesAnalysisSummary {
  lines: number;
  closure: number;
  exact: number;
  approximate: number;
  unsolved: number;
  /** Lines coinciding with the sheet outline: free, never folded. */
  free: number;
}

export interface ReferencesAnalysisProgress {
  phase: 'closing' | 'querying' | 'done';
  closed: number;
  remaining: number;
  queried: number;
  queryTotal: number;
}

export interface ReferencesAnalysisOptions {
  computedAtRevision: string;
  client: ReferenceFinderClient;
  closeChunkMs?: number;
  /** Whole-run ceiling; 0 is unbounded. */
  totalBudgetMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ReferencesAnalysisProgress) => void;
  now?: () => number;
}

export interface ReferencesAnalysis {
  computedAtRevision: string;
  component: number;
  lines: ReferencesAnalysisLine[];
  summary: ReferencesAnalysisSummary;
  /** The Stop landed, or the budget ran out; `lines` is what was reached. */
  partial: boolean;
  durationMs: number;
}

const DEFAULT_CLOSE_CHUNK_MS = 250;
const DEFAULT_TOTAL_BUDGET_MS = 30_000;

/**
 * Analyse one component. Always resolves: a Stop keeps the partial findings
 * (plan: "Stop … keeps partial findings"), and a line the core refuses is one
 * `error` verdict rather than a failed analysis.
 */
export async function analyzeReferences(
  planner: PrecreasePlannerHandle,
  options: ReferencesAnalysisOptions
): Promise<ReferencesAnalysis> {
  const now = options.now ?? (() => Date.now());
  const started = now();
  const chunkMs = options.closeChunkMs ?? DEFAULT_CLOSE_CHUNK_MS;
  const budgetMs = options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
  const { signal, onProgress } = options;
  const info = await planner.info();

  let partial = false;
  const progress = (
    phase: ReferencesAnalysisProgress['phase'],
    closed: number,
    remaining: number,
    queried = 0,
    queryTotal = 0
  ) => onProgress?.({ phase, closed, remaining, queried, queryTotal });

  if (info.refused) {
    return {
      computedAtRevision: options.computedAtRevision,
      component: info.component,
      lines: [],
      summary: { lines: 0, closure: 0, exact: 0, approximate: 0, unsolved: 0, free: 0 },
      partial: true,
      durationMs: now() - started,
    };
  }

  // The closure, chunked so a long one stays interruptible.
  let remaining = info.remaining;
  let closedFolded = 0;
  while (!signal?.aborted) {
    const outOfTime = budgetMs > 0 && now() - started >= budgetMs;
    const chunk = await planner.close(outOfTime ? 1 : chunkMs);
    closedFolded += chunk.folded;
    remaining = chunk.remaining;
    progress('closing', closedFolded, remaining);
    if (chunk.fixpoint || remaining === 0) break;
    if (outOfTime && chunk.folded === 0) {
      partial = true;
      break;
    }
  }
  if (signal?.aborted) partial = true;

  const sequence = await planner.sequence(false);
  const lines: ReferencesAnalysisLine[] = closureLines(sequence);

  // Only what the closure could not reach is queried.
  const unreachable = decodeRemaining(await planner.remaining());
  const keys = await planner.lineKeys();
  if (unreachable.length > 0 && !signal?.aborted) {
    const requests: ReferenceFinderLineRequest[] = unreachable.map((entry, i) => ({
      a: entry.segment[0] as RfPoint,
      b: entry.segment[1] as RfPoint,
      key: keys[i] ?? `${entry.line.n[0]},${entry.line.n[1]},${entry.line.d}`,
    }));
    progress('querying', closedFolded, remaining, 0, requests.length);
    const outcome = await options.client.batchLines(
      requests,
      (done, total) => progress('querying', closedFolded, remaining, done, total),
      signal
    );
    if (outcome.aborted) partial = true;
    // `findings` is parallel to `remaining()` only in what it covers, not in
    // order, so the line itself is the join — matched on the canonical triple
    // the crate produced for both.
    const findingIds = new Map<string, number[]>();
    for (const finding of sequence.findings) {
      findingIds.set(lineKey(finding.line), finding.cp_line_ids);
    }
    unreachable.forEach((entry, i) => {
      const result = outcome.results[i];
      lines.push({
        cpLineIds: findingIds.get(lineKey(entry.line)) ?? [],
        line: entry.line,
        verdict: result === undefined ? { kind: 'unsolved' } : verdictFor(result),
      });
    });
  }

  progress('done', closedFolded, remaining, 0, 0);
  return {
    computedAtRevision: options.computedAtRevision,
    component: info.component,
    lines,
    summary: summarize(lines, sequence.totals.free_lines),
    partial,
    durationMs: now() - started,
  };
}

function lineKey(line: PrecreasePlanLine): string {
  const q = (v: number) => Math.round(v * 1e9);
  return `${q(line.n[0])},${q(line.n[1])},${q(line.d)}`;
}

/** Every CP line the closure folded, in presentation order. */
function closureLines(sequence: PrecreaseSequence): ReferencesAnalysisLine[] {
  return sequence.steps
    .filter((step) => step.kind === 'cp')
    .map((step) => ({
      cpLineIds: step.cp_line_ids,
      line: step.line,
      verdict: {
        kind: 'closure' as const,
        stepId: step.id,
        axiom: chosenWitness(step)?.axiom ?? 0,
      },
    }));
}

function verdictFor(
  result: { solutions: ExtractedSolution[] } | { error: { message: string } }
): ReferencesLineVerdict {
  if ('error' in result) return { kind: 'error', message: result.error.message };
  if (result.solutions.length === 0) return { kind: 'unsolved' };
  const exact = result.solutions.filter((solution) => solution.err <= EXACT_ERROR);
  if (exact.length > 0) {
    const best = exact.reduce((a, b) => (b.rank < a.rank ? b : a));
    return { kind: 'exact', rank: best.rank, foldCount: best.foldCount };
  }
  const best = result.solutions.reduce((a, b) => (b.err < a.err ? b : a));
  return { kind: 'approximate', rank: best.rank, foldCount: best.foldCount, err: best.err };
}

export function summarize(
  lines: readonly ReferencesAnalysisLine[],
  free: number
): ReferencesAnalysisSummary {
  const summary: ReferencesAnalysisSummary = {
    lines: lines.length,
    closure: 0,
    exact: 0,
    approximate: 0,
    unsolved: 0,
    free,
  };
  for (const line of lines) {
    switch (line.verdict.kind) {
      case 'closure':
        summary.closure += 1;
        break;
      case 'exact':
        summary.exact += 1;
        break;
      case 'approximate':
        summary.approximate += 1;
        break;
      default:
        summary.unsolved += 1;
    }
  }
  return summary;
}
