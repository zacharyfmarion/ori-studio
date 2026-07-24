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

interface PersistedProgress {
  completedLessonIds: string[];
  lastLessonId: string | null;
}

const EMPTY_PROGRESS: PersistedProgress = { completedLessonIds: [], lastLessonId: null };

function readProgress(): PersistedProgress {
  const stored = readJson<PersistedProgress>(PROGRESS_KEY, EMPTY_PROGRESS);
  // Tolerate a hand-edited or older payload rather than throwing on load.
  return {
    completedLessonIds: Array.isArray(stored.completedLessonIds) ? stored.completedLessonIds : [],
    lastLessonId: typeof stored.lastLessonId === 'string' ? stored.lastLessonId : null,
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
  activeLessonId: string | null;
  /**
   * The lesson whose starting pattern the practice canvas currently holds.
   * Tracked separately from `activeLessonId` so that leaving a lesson and coming
   * back does not wipe work in progress, while *switching* lessons does load the
   * new one's starting pattern.
   */
  practiceLessonId: string | null;
  stepIndex: number;
  stepStatus: StepStatus;
  feedback: StepFeedback | null;
  completedLessonIds: string[];
  lastLessonId: string | null;

  openLesson: (lessonId: string) => void;
  closeLesson: () => void;
  goToStep: (index: number) => void;
  nextStep: () => void;
  previousStep: () => void;
  /** Report a check result for the active step. */
  reportStepResult: (satisfied: boolean, feedback: StepFeedback | null) => void;
  /** Record that the practice canvas now holds `lessonId`'s starting pattern. */
  markPracticeDocumentFor: (lessonId: string) => void;
  /** Escape hatch so a stuck user is never trapped on a step. */
  skipStep: () => void;
  markLessonComplete: (lessonId: string) => void;
  resetProgress: () => void;
}

function initialStatusFor(step: LessonStep | undefined): StepStatus {
  if (!step) return 'not-applicable';
  return stepIsSelfAdvancing(step) ? 'pending' : 'not-applicable';
}

function persist(state: Pick<TutorialState, 'completedLessonIds' | 'lastLessonId'>): void {
  writeJson(PROGRESS_KEY, {
    completedLessonIds: state.completedLessonIds,
    lastLessonId: state.lastLessonId,
  } satisfies PersistedProgress);
}

export const useTutorialStore = create<TutorialState>()(
  devtools(
    (set, get) => ({
      activeLessonId: null,
      practiceLessonId: null,
      stepIndex: 0,
      stepStatus: 'not-applicable',
      feedback: null,
      ...readProgress(),

      openLesson: (lessonId) => {
        const lesson = lessonById(lessonId);
        if (!lesson) return;
        const next = {
          activeLessonId: lessonId,
          stepIndex: 0,
          stepStatus: initialStatusFor(lesson.steps[0]),
          feedback: null,
          lastLessonId: lessonId,
        };
        set(next);
        persist({ completedLessonIds: get().completedLessonIds, lastLessonId: lessonId });
      },

      closeLesson: () =>
        set({ activeLessonId: null, stepIndex: 0, stepStatus: 'not-applicable', feedback: null }),

      markPracticeDocumentFor: (lessonId) => set({ practiceLessonId: lessonId }),

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
        persist({ completedLessonIds: next, lastLessonId: get().lastLessonId });
      },

      resetProgress: () => {
        set({ completedLessonIds: [], lastLessonId: null });
        persist(EMPTY_PROGRESS);
      },
    }),
    { name: 'TutorialStore' }
  )
);
