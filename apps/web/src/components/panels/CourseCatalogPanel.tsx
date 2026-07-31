import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { useTutorialStore } from '../../store/tutorialStore';
import { LESSON_COURSES } from '../../tutorial/courses';
import { courseProgress, lessonById } from '../../tutorial/lessons';
import { coursePath, lessonPath } from '../../routing/paths';

/**
 * `/learn` — the course catalog.
 *
 * One card per course. Progress is asked of the registry rather than counted
 * from stored ids, so a completion left behind by a renamed lesson cannot make a
 * course read as further along than it has lessons.
 */
export function CourseCatalogPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const completedLessonIds = useTutorialStore((state) => state.completedLessonIds);
  const lastCourseId = useTutorialStore((state) => state.lastCourseId);
  const resumeByCourse = useTutorialStore((state) => state.resumeByCourse);

  const resumeLessonId = lastCourseId ? resumeByCourse[lastCourseId] : undefined;
  const resumeLesson = resumeLessonId ? lessonById(resumeLessonId) : undefined;

  return (
    <main className="course-catalog">
      <div className="course-catalog__content">
        <header className="course-catalog__header">
          <GraduationCap size={22} aria-hidden />
          <div>
            <h1 className="course-catalog__title">
              {t('panels:tutorial.catalogTitle', 'Learn Ori Studio')}
            </h1>
            <p className="course-catalog__blurb">
              {t(
                'panels:tutorial.catalogBlurb',
                'Short courses that teach the editor by having you draw in it. Your own work in the Edit workspace is untouched.'
              )}
            </p>
          </div>
        </header>

        {lastCourseId && resumeLesson ? (
          <button
            type="button"
            className="course-catalog__resume"
            onClick={() => navigate(lessonPath(lastCourseId, resumeLesson.id))}
          >
            {t('panels:tutorial.resumeLesson', 'Resume: {{lesson}}', { lesson: resumeLesson.title })}
          </button>
        ) : null}

        <ul className="course-catalog__courses">
          {LESSON_COURSES.map((course) => {
            const progress = courseProgress(course.id, completedLessonIds);
            const done = progress.total > 0 && progress.completed === progress.total;
            return (
              <li key={course.id}>
                <button
                  type="button"
                  className="course-card"
                  onClick={() => navigate(coursePath(course.id))}
                  data-complete={done ? '' : undefined}
                >
                  <span className="course-card__text">
                    <span className="course-card__title">{course.title}</span>
                    <span className="course-card__blurb">{course.blurb}</span>
                  </span>
                  <span className="course-card__progress">
                    {t('panels:tutorial.courseProgress', '{{completed}} / {{total}} lessons', {
                      completed: progress.completed,
                      total: progress.total,
                    })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
