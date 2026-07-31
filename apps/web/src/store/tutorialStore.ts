/**
 * Tutorial state: which lesson and step are open, whether the current step's
 * check is satisfied, and which lessons the user has finished.
 *
 * Deliberately separate from `workspaceStore`. Nothing here belongs to a
 * document — it is progress through content — so folding it into the workspace
 * store would put non-document state in the slot bundle's neighbourhood and
 * blur a boundary that is currently sharp.
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { readJson, storageKey, writeJson, STORAGE_KEYS } from '../lib/storage';
import { lessonById } from '../tutorial/lessons';
import { stepIsSelfAdvancing, type LessonStep } from '../tutorial/types';

const PROGRESS_KEY = storageKey(STORAGE_KEYS.tutorialProgress);

/**
 * What survives a reload.
 *
 * `completedLessonIds` is flat: lesson ids are globally unique, so a lesson that
 * moves between courses keeps its completion, and no stored id ever needs
 * rewriting. Progress is *derived* from this against the registry
 * (`courseProgress`) rather than counted, so a completion left behind by a
 * renamed lesson cannot inflate a course.
 *
 * Resume is per course, not global — each course card has to answer "where was I
 * in *this* course", which a single last-lesson field cannot.
 *
 * No step index, on purpose. The practice document is not persisted, so resuming
 * mid-lesson would put the reader on a step whose check refers to work that is
 * no longer on the canvas — and a `camv-clean` step passes on a blank sheet,
 * handing out a completion for something never done. Resume means the top of the
 * lesson. Do not "fix" this without persisting the canvas too.
 */
interface PersistedProgress {
  completedLessonIds: string[];
  /** Which course the catalog's resume button points at. */
  lastCourseId: string | null;
  /** courseId → the lesson to resume in it. */
  resumeByCourse: Record<string, string>;
}

const EMPTY_PROGRESS: PersistedProgress = {
  completedLessonIds: [],
  lastCourseId: null,
  resumeByCourse: {},
};

/**
 * Field-by-field, with a fallback each. That tolerance is what let courses land
 * without a migration: an older payload keeps its completions and simply has no
 * resume until the next lesson is opened.
 */
function readProgress(): PersistedProgress {
  const stored = readJson<PersistedProgress>(PROGRESS_KEY, EMPTY_PROGRESS);
  const resume = stored.resumeByCourse;
  return {
    completedLessonIds: Array.isArray(stored.completedLessonIds)
      ? stored.completedLessonIds.filter((id): id is string => typeof id === 'string')
      : [],
    lastCourseId: typeof stored.lastCourseId === 'string' ? stored.lastCourseId : null,
    resumeByCourse:
      resume && typeof resume === 'object' && !Array.isArray(resume)
        ? Object.fromEntries(
            Object.entries(resume).filter(([, lessonId]) => typeof lessonId === 'string')
          )
        : {},
  };
}

/**
 * How the active step is progressing. `satisfied` means a draw/action step's
 * check has passed; prose and explore steps are `not-applicable`.
 */
export type StepStatus = 'not-applicable' | 'pending' | 'satisfied';

export interface StepFeedback {
  /** Creases the target has that the user's pattern is missing. */
  missing: number;
  /** Creases the user has that the target does not. */
  extra: number;
  /** Right place, wrong fold type. */
  wrongAssignment: number;
  /** Creases matched so far. */
  matched: number;
  /** Total the target expects. */
  expected: number;
}

interface TutorialState {
  /**
   * The course whose page the lesson pane shows when no lesson is open. Set by
   * both the course route and the lesson route, so the pane can render a course
   * overview without knowing the URL — it is inside Dockview, not under the
   * route that carries the param.
   */
  activeCourseId: string | null;
  activeLessonId: string | null;
  /**
   * The lesson whose starting pattern the practice canvas currently holds.
   * Tracked separately from `activeLessonId` so that leaving a lesson and coming
   * back does not wipe work in progress, while *switching* lessons does load the
   * new one's starting pattern.
   */
  practiceLessonId: string | null;
  /** Which target the practice canvas currently holds, when a step chose one. */
  practiceSourceId: string | null;
  stepIndex: number;
  stepStatus: StepStatus;
  feedback: StepFeedback | null;
  completedLessonIds: string[];
  lastCourseId: string | null;
  resumeByCourse: Record<string, string>;

  openLesson: (lessonId: string, courseId: string) => void;
  /** Show a course's overview: no lesson open, but the pane knows the course. */
  openCourse: (courseId: string) => void;
  closeLesson: () => void;
  goToStep: (index: number) => void;
  nextStep: () => void;
  previousStep: () => void;
  /** Report a check result for the active step. */
  reportStepResult: (satisfied: boolean, feedback: StepFeedback | null) => void;
  /** Record that the practice canvas now holds `lessonId`'s starting pattern. */
  markPracticeDocumentFor: (lessonId: string, sourceId?: string | null) => void;
  /** Escape hatch so a stuck user is never trapped on a step. */
  skipStep: () => void;
  markLessonComplete: (lessonId: string) => void;
  resetProgress: () => void;
}

function initialStatusFor(step: LessonStep | undefined): StepStatus {
  if (!step) return 'not-applicable';
  return stepIsSelfAdvancing(step) ? 'pending' : 'not-applicable';
}

function persist(
  state: Pick<TutorialState, 'completedLessonIds' | 'lastCourseId' | 'resumeByCourse'>
): void {
  writeJson(PROGRESS_KEY, {
    completedLessonIds: state.completedLessonIds,
    lastCourseId: state.lastCourseId,
    resumeByCourse: state.resumeByCourse,
  } satisfies PersistedProgress);
}

export const useTutorialStore = create<TutorialState>()(
  devtools(
    (set, get) => ({
      activeCourseId: null,
      activeLessonId: null,
      practiceLessonId: null,
      practiceSourceId: null,
      stepIndex: 0,
      stepStatus: 'not-applicable',
      feedback: null,
      ...readProgress(),

      openLesson: (lessonId, courseId) => {
        const lesson = lessonById(lessonId);
        if (!lesson) return;
        const resumeByCourse = { ...get().resumeByCourse, [courseId]: lessonId };
        set({
          activeCourseId: courseId,
          activeLessonId: lessonId,
          stepIndex: 0,
          stepStatus: initialStatusFor(lesson.steps[0]),
          feedback: null,
          lastCourseId: courseId,
          resumeByCourse,
        });
        persist({
          completedLessonIds: get().completedLessonIds,
          lastCourseId: courseId,
          resumeByCourse,
        });
      },

      openCourse: (courseId) =>
        set({
          activeCourseId: courseId,
          activeLessonId: null,
          stepIndex: 0,
          stepStatus: 'not-applicable',
          feedback: null,
        }),

      // Leaves `activeCourseId` alone: closing a lesson goes *up* to its course
      // overview, which the pane still has to render.
      closeLesson: () =>
        set({ activeLessonId: null, stepIndex: 0, stepStatus: 'not-applicable', feedback: null }),

      markPracticeDocumentFor: (lessonId, sourceId = null) =>
        set({ practiceLessonId: lessonId, practiceSourceId: sourceId }),

      goToStep: (index) => {
        const lesson = lessonById(get().activeLessonId ?? '');
        if (!lesson) return;
        const clamped = Math.max(0, Math.min(index, lesson.steps.length - 1));
        set({
          stepIndex: clamped,
          stepStatus: initialStatusFor(lesson.steps[clamped]),
          feedback: null,
        });
      },

      nextStep: () => {
        const { activeLessonId, stepIndex } = get();
        const lesson = lessonById(activeLessonId ?? '');
        if (!lesson) return;
        if (stepIndex >= lesson.steps.length - 1) {
          get().markLessonComplete(lesson.id);
          return;
        }
        get().goToStep(stepIndex + 1);
      },

      previousStep: () => get().goToStep(get().stepIndex - 1),

      reportStepResult: (satisfied, feedback) => {
        const { stepStatus } = get();
        // Prose/explore steps never take a check result.
        if (stepStatus === 'not-applicable') return;
        set({ stepStatus: satisfied ? 'satisfied' : 'pending', feedback });
      },

      skipStep: () => {
        const { stepIndex } = get();
        const lesson = lessonById(get().activeLessonId ?? '');
        if (!lesson) return;
        if (stepIndex >= lesson.steps.length - 1) {
          get().markLessonComplete(lesson.id);
          return;
        }
        get().goToStep(stepIndex + 1);
      },

      markLessonComplete: (lessonId) => {
        const { completedLessonIds } = get();
        if (completedLessonIds.includes(lessonId)) return;
        const next = [...completedLessonIds, lessonId];
        set({ completedLessonIds: next });
        persist({
          completedLessonIds: next,
          lastCourseId: get().lastCourseId,
          resumeByCourse: get().resumeByCourse,
        });
      },

      resetProgress: () => {
        set({ completedLessonIds: [], lastCourseId: null, resumeByCourse: {} });
        persist(EMPTY_PROGRESS);
      },
    }),
    { name: 'TutorialStore' }
  )
);

if (import.meta.env.DEV && typeof window !== 'undefined') {
  // Mirrors the workspace store's dev handle. Lesson progress is otherwise only
  // observable through rendered text, which makes walking the lessons to check
  // they are all completable far more awkward than it needs to be.
  const debugWindow = window as Window & { __oristudioTutorialStore?: typeof useTutorialStore };
  debugWindow.__oristudioTutorialStore = useTutorialStore;
}
