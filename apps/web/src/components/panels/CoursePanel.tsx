import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import { useTutorialStore } from '../../store/tutorialStore';
import type { LessonCourse } from '../../tutorial/types';
import { chaptersInCourse, courseProgress, lessonsInChapter } from '../../tutorial/lessons';
import { LEARN_PATH, lessonPath } from '../../routing/paths';

/**
 * `/learn/:courseId` — one course: its chapters in teaching order, each with its
 * lessons, and what has already been finished marked.
 *
 * Full width, outside the workspace shell — there is no practice document until
 * a lesson is opened.
 */
export function CoursePanel({ course }: { course: LessonCourse }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const completedLessonIds = useTutorialStore((state) => state.completedLessonIds);
  const resumeByCourse = useTutorialStore((state) => state.resumeByCourse);

  const progress = courseProgress(course.id, completedLessonIds);
  const resumeLessonId = resumeByCourse[course.id];

  return (
    <main className="course-page">
      <div className="course-page__content">
        <button type="button" className="course-page__back" onClick={() => navigate(LEARN_PATH)}>
          <ArrowLeft size={14} aria-hidden />
          {t('panels:tutorial.allCourses', 'All courses')}
        </button>

        <header className="course-page__header">
          <h1 className="course-page__title">{course.title}</h1>
          <p className="course-page__blurb">{course.blurb}</p>
          <p className="course-page__progress">
            {t('panels:tutorial.courseProgress', '{{completed}} / {{total}} lessons', {
              completed: progress.completed,
              total: progress.total,
            })}
          </p>
        </header>

        {resumeLessonId ? (
          <button
            type="button"
            className="course-page__resume"
            onClick={() => navigate(lessonPath(course.id, resumeLessonId))}
          >
            {t('panels:tutorial.resume', 'Resume where you left off')}
          </button>
        ) : null}

        {chaptersInCourse(course.id).map((chapter) => (
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
                      onClick={() => navigate(lessonPath(course.id, lesson.id))}
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
    </main>
  );
}
