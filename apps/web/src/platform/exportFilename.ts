import type { TFunction } from 'i18next';
import { untitledTitle } from '../i18n/documentNames';
import { identityTranslate } from '../i18n/identityTranslate';
import { ensureExtension } from './fileService';

/**
 * A document title as a safe suggested filename.
 *
 * One rule for every exporter: two of them producing differently-mangled names
 * from the same title is the kind of inconsistency nobody reports but everybody
 * notices.
 *
 * "Safe" means letters, marks and digits from any script, plus `.`, `_` and
 * `-`; every other run becomes one hyphen. It used to mean ASCII, which made a
 * project named "鶴" or "Übung" save as `Untitled.osf` and `bung.osf` — and
 * would have done the same to a localized "Untitled" the moment the default
 * title stopped being English. A filesystem is happy with Unicode names; what
 * it objects to (`/`, `:`, `?`, `*`, quotes) is punctuation, and the hyphen
 * rule still catches all of it.
 *
 * `t` names a title that is blank or all punctuation; a pure caller may leave
 * it to the English default. That name takes the same rule as a title — a
 * locale's "Sans titre" becomes `Sans-titre.osf`.
 */
export function exportFilename(
  title: string,
  extension: string,
  t: TFunction = identityTranslate
): string {
  const safe = sanitize(title) || sanitize(untitledTitle(t));
  return ensureExtension(safe, extension);
}

function sanitize(name: string): string {
  return name.replace(/[^\p{L}\p{M}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '');
}
