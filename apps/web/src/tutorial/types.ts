/**
 * The tutorial's content model.
 *
 * A lesson is a short document — prose, an optional image, and often a target
 * crease pattern — paired with the real crease-pattern editor. The user works in
 * the actual editor with the actual tools; the lesson watches their document and
 * says when it matches.
 *
 * Lessons are typed data, not Markdown, so the prose flows through the same
 * `i18n:extract` / `i18n:check` gate as every other user-facing string (see
 * `src/i18n/tutorialVocab.ts`). English here is the source of truth.
 */
import type { OristudioCpActionId } from '../lib/oristudioCpActions';
import type { OristudioCpOperationId } from '../lib/oristudioCpCommands';

/** An illustration beside a step's prose. */
export interface LessonImage {
  /** Imported asset URL, so Vite fingerprints and bundles it. */
  src: string;
  /** Alt text. Required — a lesson image always carries meaning. */
  alt: string;
}

/**
 * How strictly the user's pattern must match the target.
 *
 * `exact` — nothing missing, nothing extra.
 * `subset` — nothing missing; extra creases are tolerated. Use when the lesson
 *   starts from a populated pattern and asks for an addition.
 */
export type LessonMatchMode = 'exact' | 'subset';

export interface LessonCheckSpec {
  mode: LessonMatchMode;
  /**
   * Compare geometry only, reporting a right-place/wrong-type crease as a
   * mismatched assignment rather than a plain failure — so the lesson can say
   * "right line, wrong fold type" instead of just "no".
   */
  ignoreAssignment?: boolean;
  /**
   * Accept the target under any of the square's 8 symmetries. Use for lessons
   * where "a diagonal" genuinely means either diagonal.
   */
  allowSymmetry?: boolean;
  /**
   * Include auxiliary (construction) lines in the comparison. Off by default:
   * most lessons care about creases and should ignore scaffolding.
   */
  includeAuxiliary?: boolean;
  /**
   * Endpoint match tolerance as a fraction of the paper's width. Defaults to
   * a grid-friendly 1/64.
   */
  tolerance?: number;
}

/** A state predicate a non-drawing step can wait on. */
export type LessonStatePredicate =
  /** At least one folded figure exists. */
  | 'folded-figure-exists'
  /** The always-on CAMV diagnostics report no violations. */
  | 'camv-clean';

interface LessonStepBase {
  /** Stable within its lesson; used for progress and i18n keys. */
  id: string;
  title: string;
  /** Paragraphs. Rich prose is intentional — lessons teach concepts, not just clicks. */
  body: readonly string[];
  image?: LessonImage;
}

/** Read and continue. */
export interface LessonProseStep extends LessonStepBase {
  kind: 'prose';
}

/** Copy the target pattern using a specific tool. */
export interface LessonDrawStep extends LessonStepBase {
  kind: 'draw';
  /** Key into `LESSON_TARGETS` — the pattern to reproduce. */
  targetId: string;
  check: LessonCheckSpec;
  /** The tool this step is about; armed for the user when the step opens. */
  teaches?: OristudioCpActionId;
  /** Extra nudge shown once the user has been on the step a while. */
  hint?: string;
}

/** Perform an app action (fold, run a check) rather than draw. */
export interface LessonActionStep extends LessonStepBase {
  kind: 'action';
  expect: LessonStatePredicate;
  /** Command to arm, when the step is about a specific one. */
  runs?: OristudioCpOperationId;
  hint?: string;
}

/** Free play; the user says when they are done. */
export interface LessonExploreStep extends LessonStepBase {
  kind: 'explore';
}

export type LessonStep =
  | LessonProseStep
  | LessonDrawStep
  | LessonActionStep
  | LessonExploreStep;

export interface Lesson {
  id: string;
  chapterId: string;
  title: string;
  /** One line, shown in the lesson index. */
  blurb: string;
  /**
   * Key into `LESSON_TARGETS` for the document the practice canvas starts from.
   * Omitted means a blank sheet.
   */
  startTargetId?: string;
  steps: readonly LessonStep[];
}

export interface LessonChapter {
  id: string;
  title: string;
  blurb: string;
}

/**
 * A crease-pattern document referenced by a lesson, as raw text.
 *
 * `.fold` is the format to author in. It carries the *topology* — the vertices
 * where creases meet, and the boundary split at those points — which `.cp` does
 * not: a `.cp` is only a list of segments, so two creases written as whole lines
 * cross without meeting, and the foldability checker rightly objects to the
 * result. Export a pattern you drew in the editor rather than writing coordinates
 * by hand, and that problem cannot arise.
 */
export interface LessonTarget {
  id: string;
  /** Raw document text, imported `?raw`. Parsed by the engine, never by hand. */
  text: string;
  format: 'cp' | 'fold';
}

/** Whether a step advances on a button or on a satisfied check. */
export function stepIsSelfAdvancing(step: LessonStep): boolean {
  return step.kind === 'draw' || step.kind === 'action';
}
