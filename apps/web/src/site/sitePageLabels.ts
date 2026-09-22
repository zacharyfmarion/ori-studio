import type { TFunction } from 'i18next';
import type { SitePageId } from './sitePages';

/**
 * The strings a page is known by: its name in the nav, its `<title>`, its description.
 *
 * Switches of literal `t()` calls rather than fields on the registry, because the i18next
 * parser only sees calls whose key and default are literals: a table keyed by id — the
 * obvious shape — would extract nothing, and the English catalog would silently lose these
 * strings. Same reason `desktopBuildLabels.ts` is written this way.
 *
 * The title and description used to be English constants on the registry, on the theory
 * that a localized runtime title would overwrite the prerendered one. Putting the locale in
 * the URL is what dissolved that: on `/zh-CN/download/` both come from the same key with the
 * same catalog loaded. The English defaults here are still what `index.html` serves, and
 * `siteMeta.ts` keeps `SITE_TITLE` for it — it has to stay a leaf for the share Worker — so
 * a test holds the two copies equal.
 */

/**
 * A page's name in the nav.
 *
 * Short, because they are also what a search result's sitelinks would be labelled with if
 * Google chose to show any, and a sitelink is one or two words.
 */
export function sitePageLabel(t: TFunction, id: SitePageId): string {
  switch (id) {
    case 'landing':
      return t('site:nav.home', 'Home');
    case 'getting-started':
      return t('site:nav.gettingStarted', 'Getting started');
    case 'download':
      return t('site:nav.download', 'Download');
    case 'oriedita':
      return t('site:nav.oriedita', 'Oriedita');
    case 'faq':
      return t('site:nav.faq', 'FAQ');
  }
}

/**
 * A page's `<title>`, and the subject of its `<h1>`.
 *
 * Written for the result, not the brand — a searcher sees this line and nothing else of
 * the page — and kept under 60 Latin characters, or a result cuts it mid-phrase (there
 * is a test). The translations are written for their own language's query, not
 * translated from this: a Chinese title has to say 折纸 where a Chinese searcher would.
 */
export function sitePageTitle(t: TFunction, id: SitePageId): string {
  switch (id) {
    case 'landing':
      return t('site:landing.title', 'Ori Studio — Origami Design Workspace');
    case 'getting-started':
      return t('site:gettingStarted.pageTitle', 'Getting started with Ori Studio');
    case 'download':
      return t('site:download.pageTitle', 'Download Ori Studio for macOS, Windows and Linux');
    case 'oriedita':
      return t('site:oriedita.pageTitle', 'Oriedita in your browser — Ori Studio');
    case 'faq':
      return t('site:faq.pageTitle', 'Ori Studio FAQ — files, saving, offline, privacy');
  }
}

/** A page's `<meta name="description">`, and its card description. */
export function sitePageDescription(t: TFunction, id: SitePageId): string {
  switch (id) {
    case 'landing':
      return t(
        'site:landing.description',
        'Ori Studio is a free, open-source workspace for origami design: draw and edit crease patterns, design from a tree structure or a box-pleating grid, and fold the result in the simulator. Runs in your browser, or as a desktop app for macOS, Windows and Linux.'
      );
    case 'download':
      return t(
        'site:download.description',
        'Get the Ori Studio desktop app for macOS, Windows and Linux — the same free, open-source origami workspace as the browser version, with native menus, file dialogs and updates. Or open it in your browser with nothing to install.'
      );
    case 'getting-started':
      return t(
        'site:gettingStarted.description',
        'The shortest path from opening Ori Studio to a crease pattern you can fold: the three ways in, the Edit, Design and Simulate workspaces, which files it opens and exports, how saving works, and the keyboard.'
      );
    case 'oriedita':
      return t(
        'site:oriedita.description',
        'Ori Studio’s crease-pattern editor is a port of Oriedita that runs in your browser: the same tools and foldability checks, .ori and .orh files in both directions, and your Oriedita keyboard shortcuts imported from an .oriconfig file.'
      );
    case 'faq':
      return t(
        'site:faq.description',
        'Answers to the questions people ask about Ori Studio: whether it is free, what files it opens and exports, where your work is saved, whether it works offline and on a phone, what it collects, and how it relates to Oriedita, TreeMaker and Box Pleating Studio.'
      );
  }
}
