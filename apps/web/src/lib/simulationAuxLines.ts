import type { FoldDocument } from '../engine/types';

/**
 * What a simulation makes of a crease pattern's aux lines.
 *
 * An aux line is a reference mark. Nothing folds it (Oriedita folds only its
 * border, mountain and valley lines), so a simulation leaves it out of the
 * paper and draws it on top, carried beside the mesh under `AUX_LINES_KEY`.
 *
 * The exception is a file whose `F` lines are facets: lines an Origami
 * Simulator designer drew to say where the paper may bend. FOLD spells both
 * with the one letter and the kernel imports both as aux lines, so a document
 * says which it holds. By default the file's own creator decides; the user's
 * choice, once made, is saved with the document.
 */

/** The FOLD key that says outright whether a file's `F` lines are facets. */
export const AUX_LINES_ARE_FACETS_KEY = 'oristudio:aux_lines_are_facets';

/**
 * Whether a FOLD file's `F` lines are facets by its own account: the key when
 * it states one, and otherwise its creator. Origami Simulator's exports, and
 * the FOLDs `scripts/svg-to-fold.mjs` makes from its SVGs, mean facets.
 */
export function foldAuxLinesAreFacets(fold: FoldDocument | null | undefined): boolean {
  const stated = fold?.[AUX_LINES_ARE_FACETS_KEY];
  if (typeof stated === 'boolean') return stated;
  const creator = fold?.file_creator;
  return (
    typeof creator === 'string' &&
    (creator.startsWith('Origami Simulator') || creator === 'Ori Studio svg-to-fold')
  );
}

/** The crease pattern's extensions key its simulation choices are saved under. */
export const SIMULATION_EXTENSION_KEY = 'oristudio.simulation';

/** The user's choice for a document, or null when they have not made one. */
export function chosenAuxLinesAreFacets(extensions: Record<string, unknown>): boolean | null {
  const saved = extensions[SIMULATION_EXTENSION_KEY];
  if (!saved || typeof saved !== 'object') return null;
  const chosen = (saved as Record<string, unknown>).auxLinesAreFacets;
  return typeof chosen === 'boolean' ? chosen : null;
}

/** The extensions with the user's choice recorded. */
export function withChosenAuxLinesAreFacets(
  extensions: Record<string, unknown>,
  auxLinesAreFacets: boolean
): Record<string, unknown> {
  const saved = extensions[SIMULATION_EXTENSION_KEY];
  const kept = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  return { ...extensions, [SIMULATION_EXTENSION_KEY]: { ...kept, auxLinesAreFacets } };
}

/** Whether a document's aux lines are facets: the user's choice, else its source FOLD's. */
export function documentAuxLinesAreFacets(
  extensions: Record<string, unknown>,
  sourceFold: FoldDocument | null | undefined
): boolean {
  return chosenAuxLinesAreFacets(extensions) ?? foldAuxLinesAreFacets(sourceFold);
}

/**
 * FOLD text that says what the document's aux lines are wherever the file
 * would otherwise say the other thing — a file whose creator or stated key
 * already agrees is returned exactly as it was — so the choice survives a
 * FOLD round trip.
 */
export function foldTextStatingAuxLines(text: string, auxLinesAreFacets: boolean): string {
  const fold = JSON.parse(text) as FoldDocument;
  if (foldAuxLinesAreFacets(fold) === auxLinesAreFacets) return text;
  return JSON.stringify({ ...fold, [AUX_LINES_ARE_FACETS_KEY]: auxLinesAreFacets }, null, 2);
}
