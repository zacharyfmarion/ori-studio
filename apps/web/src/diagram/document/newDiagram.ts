import { createDiagram, defaultHanStyle, defaultTitleBlockContent } from './diagramDocument';
import { titleBlockDefaultWords } from './titleBlockWords';
import i18n from '../../i18n';

/**
 * The language the author is working in, for a new diagram's Han style. Read
 * from the document's `lang` — which the locale store keeps in step with the
 * interface — using the same locale as the rest of the author's document.
 */
function authorLocale(): string | null {
  return typeof document === 'undefined' ? null : document.documentElement.lang || null;
}

/**
 * The diagram a first edit brings into being: its Han style from the author's
 * language, and its title, "Add a title", and its title block's subtitle and
 * credits written in the app's (Zach, 2026-10-15), the author's own text from
 * then on.
 */
export function newDiagram() {
  const words = titleBlockWords();
  return createDiagram({ title: words.title, hanStyle: defaultHanStyle(authorLocale()), titleBlockContent: defaultTitleBlockContent(words) });
}

/** A title block's first words in the app's language: a new diagram's, and those its toggle writes. */
export function titleBlockWords() {
  return titleBlockDefaultWords((key, english) => i18n.t(key, english));
}

