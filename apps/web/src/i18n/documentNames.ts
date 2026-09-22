import type { TFunction } from 'i18next';

/**
 * The names a document carries until someone names it.
 *
 * Every default name lives here as a literal `t()` key — the extractor cannot
 * see a dynamic one — so the store, the file writers and the window title all
 * spell "Untitled" the same way in every language. Same shape as
 * `enumLabels.ts`: the caller supplies the translator, whether that is the
 * app instance's `i18n.t`, a component's `useTranslation` `t`, or the
 * `identityTranslate` a pure module defaults to.
 *
 * A default is resolved at the moment the document is made, in the language
 * the app is in then, and from that point on it is the document's title —
 * data, saved into the `.osf` like any name the user typed. Switching
 * language later does not rename an open document, any more than it would
 * rename one the user had named.
 */

/** A project with no name yet — the window title and the `.osf` workspace title. */
export function untitledTitle(t: TFunction): string {
  return t('common:documentName.untitled', 'Untitled');
}

/** A blank crease pattern, as `/edit` and File › New Crease Pattern seed one. */
export function untitledCpTitle(t: TFunction): string {
  return t('common:documentName.untitledCp', 'Untitled CP');
}

/** A new design tab; a duplicate takes a numeric suffix (see `uniqueDesignTitle`). */
export function untitledDesignTitle(t: TFunction): string {
  return t('common:documentName.untitledDesign', 'Untitled Design');
}

/** A box-pleat project whose file carries no title, as New Box Pleat makes one. */
export function untitledBpTitle(t: TFunction): string {
  return t('common:documentName.untitledBp', 'Untitled BP');
}

/** A crease pattern imported from a file whose name has no stem to borrow. */
export function untitledCreasePatternTitle(t: TFunction): string {
  return t('common:documentName.untitledCreasePattern', 'Untitled crease pattern');
}

/** A tree snapshot that already carries creases but was given no title. */
export function generatedCreasePatternTitle(t: TFunction): string {
  return t('common:documentName.generatedCreasePattern', 'Generated crease pattern');
}

/**
 * The crease pattern built from a tree, named after it: "Crane CP".
 *
 * Interpolated rather than concatenated so a locale can put the qualifier where
 * its grammar wants it; a tree with no title of its own gets `generatedCpTitle`.
 */
export function creasePatternOfTitle(t: TFunction, treeTitle: string): string {
  return t('common:documentName.creasePatternOf', '{{title}} CP', { title: treeTitle });
}

/** The crease pattern built from a tree that has no title to lend it. */
export function generatedCpTitle(t: TFunction): string {
  return t('common:documentName.generatedCp', 'Generated CP');
}
