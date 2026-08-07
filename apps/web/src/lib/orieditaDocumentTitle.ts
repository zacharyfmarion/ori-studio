/**
 * Oriedita's placeholder for "this document has no title".
 *
 * `FoldLineSet.getSave(save)` writes it literally
 * (`third_party/oriedita/origami/src/main/java/origami/crease_pattern/FoldLineSet.java:213`),
 * so it is what real `.ori` files carry — 7 of the 11 in the local test corpus.
 */
const ORIEDITA_PLACEHOLDER_TITLE = '_';

/**
 * A crease pattern's `title` field as a name to show a user, or null if it has none.
 *
 * **The field is not a document name upstream.** Oriedita's window title is
 * `FileModel.determineFrameTitle()` — its version plus the *filename*, plus `*`
 * when dirty — and it never reads the saved `title` at all. What that slot
 * actually holds is `CreasePattern_Worker_Impl.s_title`, which undo/redo
 * overwrite with history memos (`setMemo_for_redo_undo`), and which defaults to
 * the placeholder above. So a `.ori` saying `"title": "_"` is saying nothing,
 * and showing it verbatim puts "_ - Ori Studio" in the title bar.
 *
 * Returning null rather than a filename keeps the decision with the caller: every
 * read site already ends in `|| basenameWithoutProjectExtension(filename)` or an
 * equivalent, which lands on the filename — matching what Oriedita shows.
 *
 * The kernel deliberately still reports `Some("_")`: it is reporting the file
 * faithfully, and the `.ori` writer round-trips `None` back to `"_"`, which the
 * oracle parity tests pin. This is the product boundary, not the format one.
 */
export function orieditaDocumentTitle(title: string | null | undefined): string | null {
  const trimmed = title?.trim() ?? '';
  if (trimmed === '' || trimmed === ORIEDITA_PLACEHOLDER_TITLE) return null;
  return trimmed;
}
