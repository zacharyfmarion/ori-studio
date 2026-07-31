import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, CircleDashed, ListChecks, SkipForward } from 'lucide-react';
import { useTutorialStore } from '../../store/tutorialStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { courseIdForLesson, lessonById, nextLesson } from '../../tutorial/lessons';
import { courseById } from '../../tutorial/courses';
import { CoursePanel } from './CoursePanel';
import { lessonTarget } from '../../tutorial/targets';
import blankPracticeCp from '../../tutorial/targets/blank-sheet.cp?raw';
import { targetGeometry } from '../../tutorial/runtime/targetGeometry';
import { useLessonCheck } from '../../tutorial/runtime/useLessonCheck';
import { useLessonAction } from '../../tutorial/runtime/useLessonAction';
import {
  stepIsSelfAdvancing,
  type Lesson,
  type LessonDrawStep,
  type LessonStep,
} from '../../tutorial/types';
import { cpActionById } from '../../lib/oristudioCpActions';
import { cpCommandByOperation } from '../../lib/oristudioCpCommands';
import { LEARN_PATH, coursePath, lessonPath } from '../../routing/paths';
import { TargetCpPreview } from '../tutorial/TargetCpPreview';
import type { OristudioCpModel } from '../../engine/oristudioCpTypes';

/** A lesson with no starting pattern practises on a plain sheet of paper. */
const BLANK_PRACTICE_CP = blankPracticeCp;

/**
 * The tutorial's lesson pane. Sits beside the real crease-pattern editor and
 * drives it: prose on the left, the user's actual drawing on the right.
 *
 * This is the surface that *provisions* the practice document — routes only
 * establish which lesson is open, matching how every other workspace works.
 */
export function LessonPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const activeCourseId = useTutorialStore((state) => state.activeCourseId);
  const activeLessonId = useTutorialStore((state) => state.activeLessonId);
  const stepIndex = useTutorialStore((state) => state.stepIndex);
  const stepStatus = useTutorialStore((state) => state.stepStatus);
  const goToNextStep = useTutorialStore((state) => state.nextStep);
  const goToPreviousStep = useTutorialStore((state) => state.previousStep);
  const skipStep = useTutorialStore((state) => state.skipStep);
  const markLessonComplete = useTutorialStore((state) => state.markLessonComplete);

  const lesson = activeLessonId ? lessonById(activeLessonId) : undefined;
  const step: LessonStep | undefined = lesson?.steps[stepIndex];
  const lessonCourseId = lesson ? courseIdForLesson(lesson.id) : undefined;

  useLessonPracticeDocument(lesson, step);
  useArmedTool(step);

  const drawStep = step?.kind === 'draw' ? step : null;
  const actionStep = step?.kind === 'action' ? step : null;
  const comparison = useLessonCheck(drawStep);
  const actionSatisfied = useLessonAction(actionStep);
  const [target, setTarget] = useState<OristudioCpModel | null>(null);

  useEffect(() => {
    if (!drawStep) {
      setTarget(null);
      return;
    }
    let cancelled = false;
    void targetGeometry(drawStep.targetId).then((geometry) => {
      if (!cancelled) setTarget(geometry);
    });
    return () => {
      cancelled = true;
    };
  }, [drawStep]);

  const isLastStep = lesson ? stepIndex >= lesson.steps.length - 1 : false;
  const canAdvance = !step || !stepIsSelfAdvancing(step) || stepStatus === 'satisfied';

  /**
   * Leaving a finished lesson: record it, then go on.
   *
   * Both "Finish lesson" and Skip-from-the-last-step end here. They used not to:
   * the store's `skipStep` marked the lesson complete and stopped, because
   * navigation lived only in this component — so skipping the final step
   * silently completed the lesson and left the reader sitting on it, looking at
   * a button that appeared to do nothing.
   *
   * `nextLesson` is course-scoped, so the end of a course lands on the course
   * rather than silently starting an unrelated one.
   */
  const finishLesson = useCallback(() => {
    if (!lesson) return;
    markLessonComplete(lesson.id);
    const following = nextLesson(lesson.id);
    const courseId = courseIdForLesson(lesson.id);
    if (following && courseId) navigate(lessonPath(courseId, following.id));
    else navigate(courseId ? coursePath(courseId) : LEARN_PATH);
  }, [lesson, markLessonComplete, navigate]);

  const handleNext = useCallback(() => {
    if (!lesson) return;
    if (isLastStep) finishLesson();
    else goToNextStep();
  }, [finishLesson, goToNextStep, isLastStep, lesson]);

  const handleSkip = useCallback(() => {
    if (isLastStep) finishLesson();
    else skipStep();
  }, [finishLesson, isLastStep, skipStep]);

  // One pane, two states. With no lesson open it shows the course that lesson
  // belongs to, so choosing one changes only this column and the editor stays
  // put beside it — only the catalog at `/learn` is a page of its own.
  //
  // Null rather than a redirect when neither is set: `LessonRoute` opens the
  // lesson from an effect, so the first render after navigating has no active
  // lesson, and redirecting here raced that effect and bounced every lesson
  // back to the catalog. Validating the URL is the route's job.
  if (!lesson || !step) {
    const course = activeCourseId ? courseById(activeCourseId) : undefined;
    return course ? <CoursePanel course={course} /> : null;
  }

  return (
    <div className="lesson-panel">
      <header className="lesson-panel__header">
        <button
          type="button"
          className="lesson-panel__back"
          onClick={() => navigate(lessonCourseId ? coursePath(lessonCourseId) : LEARN_PATH)}
          aria-label={t('panels:tutorial.allLessons', 'All lessons')}
        >
          <ListChecks size={14} aria-hidden />
        </button>
        <div>
          <h2 className="lesson-panel__title">{lesson.title}</h2>
          <p className="lesson-panel__progress">
            {t('panels:tutorial.stepCounter', 'Step {{current}} of {{total}}', {
              current: stepIndex + 1,
              total: lesson.steps.length,
            })}
          </p>
        </div>
      </header>

      <div className="lesson-panel__body">
        <h3 className="lesson-panel__step-title">{step.title}</h3>
        {step.body.map((paragraph) => (
          <p key={paragraph.slice(0, 48)} className="lesson-panel__paragraph">
            {paragraph}
          </p>
        ))}

        {step.bullets ? (
          <ul className="lesson-panel__bullets">
            {step.bullets.map((bullet) => (
              <li key={bullet.slice(0, 48)}>{bullet}</li>
            ))}
          </ul>
        ) : null}

        {step.image ? (
          <img className="lesson-panel__image" src={step.image.src} alt={step.image.alt} />
        ) : null}

        {step.link ? (
          <button
            type="button"
            className="lesson-panel__link"
            onClick={() => navigate(step.link?.to ?? LEARN_PATH)}
          >
            {step.link.label}
            <ArrowRight size={14} aria-hidden />
          </button>
        ) : null}

        {actionStep ? (
          <section className="lesson-panel__target">
            <p
              className={
                actionSatisfied
                  ? 'lesson-panel__feedback lesson-panel__feedback--ok'
                  : 'lesson-panel__feedback'
              }
            >
              {actionSatisfied ? (
                <>
                  <Check size={13} aria-hidden />{' '}
                  {t('panels:tutorial.actionDone', 'Done — that worked.')}
                </>
              ) : (
                <>
                  <CircleDashed size={13} aria-hidden />{' '}
                  {t('panels:tutorial.actionPending', 'Waiting for you to try it…')}
                </>
              )}
            </p>
            {!actionSatisfied && actionStep.hint ? (
              <p className="lesson-panel__hint">{actionStep.hint}</p>
            ) : null}
          </section>
        ) : null}

        {drawStep ? (
          <section className="lesson-panel__target">
            <h4 className="lesson-panel__target-heading">
              {t('panels:tutorial.targetHeading', 'Draw this')}
            </h4>
            <TargetCpPreview geometry={target} highlight={undefined} />
            <CheckFeedback comparison={comparison} step={drawStep} />
          </section>
        ) : null}
      </div>

      <footer className="lesson-panel__footer">
        <button
          type="button"
          className="lesson-panel__nav"
          onClick={goToPreviousStep}
          disabled={stepIndex === 0}
        >
          <ArrowLeft size={14} aria-hidden /> {t('panels:tutorial.back', 'Back')}
        </button>
        {stepIsSelfAdvancing(step) && stepStatus !== 'satisfied' ? (
          <button type="button" className="lesson-panel__skip" onClick={handleSkip}>
            <SkipForward size={14} aria-hidden /> {t('panels:tutorial.skip', 'Skip')}
          </button>
        ) : null}
        <button
          type="button"
          className="lesson-panel__nav lesson-panel__nav--primary"
          onClick={handleNext}
          disabled={!canAdvance}
        >
          {isLastStep
            ? t('panels:tutorial.finish', 'Finish lesson')
            : t('panels:tutorial.next', 'Next')}{' '}
          <ArrowRight size={14} aria-hidden />
        </button>
      </footer>
    </div>
  );
}

/** Progress line for a draw step: what matches, what is missing, what is wrong. */
function CheckFeedback({
  comparison,
  step,
}: {
  comparison: ReturnType<typeof useLessonCheck>;
  step: LessonDrawStep;
}) {
  const { t } = useTranslation();
  if (!comparison) {
    return (
      <p className="lesson-panel__feedback">
        <CircleDashed size={13} aria-hidden />{' '}
        {t('panels:tutorial.checking', 'Waiting for your drawing…')}
      </p>
    );
  }

  if (comparison.satisfied) {
    return (
      <p className="lesson-panel__feedback lesson-panel__feedback--ok">
        <Check size={13} aria-hidden /> {t('panels:tutorial.matched', 'That matches. Nice.')}
      </p>
    );
  }

  const notes: string[] = [];
  if (comparison.wrongAssignment.length > 0) {
    notes.push(
      t('panels:tutorial.wrongAssignment', {
        defaultValue_one: '{{count}} crease is in the right place but the wrong fold type',
        defaultValue_other: '{{count}} creases are in the right place but the wrong fold type',
        count: comparison.wrongAssignment.length,
      })
    );
  }
  if (comparison.missing.length > 0) {
    notes.push(
      t('panels:tutorial.missing', {
        defaultValue_one: '{{count}} crease still to draw',
        defaultValue_other: '{{count}} creases still to draw',
        count: comparison.missing.length,
      })
    );
  }
  if (comparison.extra.length > 0 && step.check.mode === 'exact') {
    notes.push(
      t('panels:tutorial.extra', {
        defaultValue_one: '{{count}} crease that is not in the target',
        defaultValue_other: '{{count}} creases that are not in the target',
        count: comparison.extra.length,
      })
    );
  }

  return (
    <div className="lesson-panel__feedback">
      <p>
        {t('panels:tutorial.matchProgress', '{{matched}} of {{expected}} creases match', {
          matched: comparison.matched.length,
          expected: comparison.expected,
        })}
      </p>
      {notes.length > 0 ? (
        <ul className="lesson-panel__feedback-notes">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      {step.hint ? <p className="lesson-panel__hint">{step.hint}</p> : null}
    </div>
  );
}

/**
 * Seed the practice canvas — from the lesson's starting pattern when it has one,
 * otherwise a blank sheet.
 *
 * Reseeding is keyed on *which lesson* the canvas holds, not merely on whether a
 * document exists. Presence alone is not enough: moving from one lesson to the
 * next would leave the previous lesson's pattern in place, so a lesson that
 * starts from a populated pattern would silently open on the wrong one. Keying on
 * the lesson also means leaving a lesson and coming back preserves work in
 * progress, because the id still matches.
 */
function useLessonPracticeDocument(lesson: Lesson | undefined, step: LessonStep | undefined): void {
  const document = useWorkspaceStore((state) => state.oristudioCpDocument);
  const practiceLessonId = useTutorialStore((state) => state.practiceLessonId);
  const practiceSourceId = useTutorialStore((state) => state.practiceSourceId);
  const markPracticeDocumentFor = useTutorialStore((state) => state.markPracticeDocumentFor);

  const lessonId = lesson?.id;
  const startTargetId = lesson?.startTargetId;
  const stepTargetId = step?.loadsTargetId;

  /**
   * What we last *started* loading, as opposed to what has arrived.
   *
   * The effect re-runs whenever the document changes, and one of its conditions
   * is `!document` — so a load that fails, or has not resolved yet, leaves that
   * condition true and the effect fires again on the very re-render its own
   * `markPracticeDocumentFor` caused. That is an infinite loop, and it is
   * reachable: cold-load a lesson URL before the CP engine is up and the first
   * load rejects. Keyed by intent rather than outcome, so each intent is
   * attempted once.
   */
  const startedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!lessonId) return;

    // A step that names its own pattern replaces whatever is on the canvas —
    // that is the point of it, walking the user through one example per idea.
    // A step that names none leaves the canvas alone, so work in progress
    // survives moving between steps.
    const wantsStepPattern = Boolean(stepTargetId) && practiceSourceId !== stepTargetId;
    const wantsLessonPattern = !document || practiceLessonId !== lessonId;
    if (!wantsStepPattern && !wantsLessonPattern) return;

    const targetId = wantsStepPattern ? stepTargetId : startTargetId;
    const intent = `${lessonId}|${wantsStepPattern ? (stepTargetId ?? '') : ''}`;
    if (startedRef.current === intent) return;
    startedRef.current = intent;

    const target = targetId ? lessonTarget(targetId) : undefined;
    markPracticeDocumentFor(lessonId, wantsStepPattern ? (stepTargetId ?? null) : null);
    void useWorkspaceStore
      .getState()
      .loadPracticeCreasePattern(
        target?.text ?? BLANK_PRACTICE_CP,
        targetId ?? lessonId,
        target?.format ?? 'cp'
      );
  }, [
    document,
    lessonId,
    markPracticeDocumentFor,
    practiceLessonId,
    practiceSourceId,
    startTargetId,
    stepTargetId,
  ]);
}

/**
 * Arm the tool a draw step is teaching, so the user starts in the right mode
 * rather than hunting the rail. They remain free to pick anything else.
 *
 * Tools that work on a selection are deliberately *not* armed. Their order is
 * select first, then pick the tool — so arming one up front drops the user into
 * a tool that cannot do anything yet, which teaches the wrong sequence. The
 * command definitions already say which those are (`selectionRequirement`), so
 * this reads that rather than making each lesson opt out.
 */
function useArmedTool(step: LessonStep | undefined): void {
  const requestOristudioCpAction = useWorkspaceStore((state) => state.requestOristudioCpAction);

  const teaches = step?.teaches;
  const armed = useMemo(() => (teaches ? cpActionById(teaches) : undefined), [teaches]);

  useEffect(() => {
    if (!armed || armed.kind === 'line-type') return;
    if (cpCommandByOperation(armed.operationId)?.selectionRequirement) return;
    requestOristudioCpAction(armed.operationId);
  }, [armed, requestOristudioCpAction]);
}
