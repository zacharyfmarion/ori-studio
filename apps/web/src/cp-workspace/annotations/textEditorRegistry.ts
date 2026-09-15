import type { LexicalEditor } from 'lexical';

/**
 * The live Lexical editor per text box under edit, reachable by id.
 *
 * The editor is created inside `CpTextEditor`'s composer and was reachable
 * only from plugins mounted in it. The Properties pane edits a box's
 * alignment, block style and colour *while it is being edited* by driving
 * that editor — a JSON transform on the stored doc would be overwritten by
 * the editor's next keystroke — so the editor registers itself here for the
 * life of the edit, through a one-line plugin beside `EscapeExitPlugin`.
 */
const editors = new Map<string, LexicalEditor>();

export function registerTextEditor(id: string, editor: LexicalEditor): () => void {
  editors.set(id, editor);
  return () => {
    if (editors.get(id) === editor) editors.delete(id);
  };
}

export function textEditorFor(id: string): LexicalEditor | null {
  return editors.get(id) ?? null;
}

/** Tests only. */
export function resetTextEditorRegistryForTests(): void {
  editors.clear();
}
