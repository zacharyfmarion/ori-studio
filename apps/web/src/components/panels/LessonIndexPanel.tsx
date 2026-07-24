import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Check, GraduationCap } from 'lucide-react';
import { useTutorialStore } from '../../store/tutorialStore';
import { LESSON_CHAPTERS, lessonsInChapter } from '../../tutorial/lessons';
import { lessonPath } from '../../routing/paths';

/**
 * `/learn` — the lesson index. Chapters in teaching order, with what the user
 * has already finished marked.
 */
export function LessonIndexPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const completedLessonIds = useTutorialStore((state) => state.completedLessonIds);
  const lastLessonId = useTutorialStore((state) => state.lastLessonId);

  return (
    <div className="lesson-index">
      <header className="lesson-index__header">
        <GraduationCap size={20} aria-hidden />
        <div>
          <h1 className="lesson-index__title">{t('panels:tutorial.indexTitle', 'Learn Ori Studio')}</h1>
          <p className="lesson-index__blurb">
            {t(
              'panels:tutorial.indexBlurb',
              'Short lessons that teach the editor by having you draw in it. Your own work in the Edit workspace is untouched.'
            )}
          </p>
        </div>
      </header>

      {lastLessonId ? (
        <button
          type="button"
          className="lesson-index__resume"
          onClick={() => navigate(lessonPath(lastLessonId))}
        >
          {t('panels:tutorial.resume', 'Resume where you left off')}
        </button>
      ) : null}

      {LESSON_CHAPTERS.map((chapter) => (
        <section key={chapter.id} className="lesson-index__chapter">
          <h2 className="lesson-index__chapter-title">{chapter.title}</h2>
          <p className="lesson-index__chapter-blurb">{chapter.blurb}</p>
          <ul className="lesson-index__lessons">
            {lessonsInChapter(chapter.id).map((lesson) => {
              const done = completedLessonIds.includes(lesson.id);
              return (
                <li key={lesson.id}>
                  <button
                    type="button"
                    className="lesson-index__lesson"
                    onClick={() => navigate(lessonPath(lesson.id))}
                    data-complete={done ? '' : undefined}
                  >
                    <span className="lesson-index__lesson-check" aria-hidden>
                      {done ? <Check size={13} /> : null}
                    </span>
                    <span>
                      <span className="lesson-index__lesson-title">{lesson.title}</span>
                      <span className="lesson-index__lesson-blurb">{lesson.blurb}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
